// Postgres-backed kv/sets/pub-sub, same shape as the in-memory store.
// Backed by Vercel's Marketplace Neon Postgres (free tier, no card).
// Pub/sub uses `LISTEN`/`NOTIFY` on a dedicated long-lived Client so it
// works across different Vercel Function instances.

import { Client, Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  neonConfig.webSocketConstructor = ws as any;
}

// Pool is used for one-shot queries; it may ride Neon's connection pooler.
function pooledUrl(): string {
  const u =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;
  if (!u) throw new Error("DATABASE_URL / POSTGRES_URL is not set");
  return u;
}

// Dedicated Client is used for LISTEN; MUST bypass the pooler because
// LISTEN/NOTIFY requires a stable session which pgBouncer-style poolers
// break.
function unpooledUrl(): string {
  const u =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL_NO_SSL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;
  if (!u) throw new Error("DATABASE_URL / POSTGRES_URL is not set");
  return u;
}

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: pooledUrl() });
  return _pool;
}

let _schemaReady: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      const p = pool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS kv (
          k           TEXT PRIMARY KEY,
          v           TEXT NOT NULL,
          expires_at  TIMESTAMPTZ
        );
      `);
      await p.query(
        `CREATE INDEX IF NOT EXISTS kv_expires_idx ON kv(expires_at) WHERE expires_at IS NOT NULL;`,
      );
      await p.query(`
        CREATE TABLE IF NOT EXISTS kv_set (
          k       TEXT NOT NULL,
          member  TEXT NOT NULL,
          PRIMARY KEY (k, member)
        );
      `);
    })().catch((e) => {
      _schemaReady = null;
      throw e;
    });
  }
  await _schemaReady;
}

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) {
  await ensureSchema();
  return pool().query<T>(sql, params);
}

export const kv = {
  async get(key: string): Promise<string | null> {
    const r = await q<{ v: string }>(
      `SELECT v FROM kv WHERE k = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [key],
    );
    return r.rows[0]?.v ?? null;
  },
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec && ttlSec > 0) {
      await q(
        `INSERT INTO kv(k, v, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3::int))
         ON CONFLICT (k) DO UPDATE
           SET v = EXCLUDED.v, expires_at = EXCLUDED.expires_at`,
        [key, value, ttlSec],
      );
    } else {
      await q(
        `INSERT INTO kv(k, v, expires_at)
         VALUES ($1, $2, NULL)
         ON CONFLICT (k) DO UPDATE
           SET v = EXCLUDED.v, expires_at = NULL`,
        [key, value],
      );
    }
  },
  async delete(key: string): Promise<void> {
    await q(`DELETE FROM kv WHERE k = $1`, [key]);
  },
  async exists(key: string): Promise<boolean> {
    const r = await q<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM kv WHERE k = $1 AND (expires_at IS NULL OR expires_at > now())) AS exists`,
      [key],
    );
    return !!r.rows[0]?.exists;
  },
  async expire(key: string, ttlSec: number): Promise<void> {
    await q(
      `UPDATE kv
         SET expires_at = now() + make_interval(secs => $2::int)
       WHERE k = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [key, ttlSec],
    );
  },
};

export const sets = {
  async add(key: string, member: string): Promise<void> {
    await q(
      `INSERT INTO kv_set(k, member) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [key, member],
    );
  },
  async remove(key: string, member: string): Promise<void> {
    await q(`DELETE FROM kv_set WHERE k = $1 AND member = $2`, [key, member]);
  },
  async members(key: string): Promise<string[]> {
    const r = await q<{ member: string }>(
      `SELECT member FROM kv_set WHERE k = $1`,
      [key],
    );
    return r.rows.map((row) => row.member);
  },
  async removeKey(key: string): Promise<void> {
    await q(`DELETE FROM kv_set WHERE k = $1`, [key]);
  },
};

function pgChannel(name: string): string {
  return name
    .toLowerCase()
    .replace(/:/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export const pubsub = {
  async publish(channel: string, payload: string): Promise<void> {
    await q(`SELECT pg_notify($1, $2)`, [pgChannel(channel), payload]);
  },
  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    await ensureSchema();
    const client = new Client({ connectionString: unpooledUrl() });
    await client.connect();
    const chan = pgChannel(channel);
    client.on("notification", (msg) => {
      if (msg.channel === chan && typeof msg.payload === "string") {
        try { handler(msg.payload); } catch { /* swallow */ }
      }
    });
    await client.query(`LISTEN "${chan}"`);
    return async () => {
      try { await client.query(`UNLISTEN "${chan}"`); } catch { /* ignore */ }
      try { await client.end(); } catch { /* ignore */ }
    };
  },
};

export const keys = {
  tunnel: (tid: string) => `tunnel:${tid}`,
  userTunnels: (uid: string) => `user:${uid}:tunnels`,
  reqChan: (tid: string) => `req:${tid}`,
  respChan: (tid: string, rid: string) => `resp:${tid}:${rid}`,
  wsChan: (tid: string, rid: string) => `ws:${tid}:${rid}`,
};

export const TUNNEL_TTL_SECONDS = 120;
