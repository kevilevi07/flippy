// Postgres-backed replacement for the old ioredis layer.
// Uses the @neondatabase/serverless driver (WebSocket-based) so LISTEN/NOTIFY
// works inside Vercel Functions.
//
// The call-site API intentionally mirrors a minimal subset of ioredis:
//   kv.get / set (with optional TTL) / delete / exists / expire
//   sets.add / remove / members / removeKey
//   pubsub.publish / subscribe (returns an async unsubscribe function)

import { Client, Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Required for Node runtimes (Vercel Functions use Node by default now).
if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  neonConfig.webSocketConstructor = ws as any;
}

function url(): string {
  const u =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.REDIS_URL; // transitional: ignored unless it's actually postgres://
  if (!u) throw new Error("DATABASE_URL is not set");
  return u;
}

// --------- shared pool for short-lived HTTP routes ----------

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: url() });
  }
  return _pool;
}

// --------- schema bootstrap (idempotent, runs once per process) ----------

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
      _schemaReady = null; // retry on next call
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

// --------- Key/Value ----------

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
      `SELECT EXISTS(
         SELECT 1 FROM kv
         WHERE k = $1 AND (expires_at IS NULL OR expires_at > now())
       ) AS exists`,
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

  async sweep(): Promise<void> {
    // Best-effort cleanup; safe to swallow errors.
    try {
      await q(`DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= now()`);
    } catch { /* ignore */ }
  },
};

// --------- Sets ----------

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

// --------- Pub/Sub via LISTEN/NOTIFY ----------
//
// Postgres channel names are identifiers; we sanitize them (`:` → `_`,
// everything else lowercased and anything outside [a-z0-9_] stripped).
function pgChannel(name: string): string {
  return name
    .toLowerCase()
    .replace(/:/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export const pubsub = {
  async publish(channel: string, payload: string): Promise<void> {
    // NOTIFY needs a literal channel name; we use pg_notify() for safety.
    await q(`SELECT pg_notify($1, $2)`, [pgChannel(channel), payload]);
  },

  /**
   * Subscribe to a channel. Returns an async close function that both
   * UNLISTENs and ends the dedicated Client.
   */
  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    await ensureSchema();
    const client = new Client({ connectionString: url() });
    await client.connect();
    const chan = pgChannel(channel);
    client.on("notification", (msg) => {
      if (msg.channel === chan && typeof msg.payload === "string") {
        try {
          handler(msg.payload);
        } catch { /* swallow handler errors */ }
      }
    });
    // Identifiers can't be parameterized; chan is already sanitized above.
    await client.query(`LISTEN "${chan}"`);
    return async () => {
      try {
        await client.query(`UNLISTEN "${chan}"`);
      } catch { /* ignore */ }
      try {
        await client.end();
      } catch { /* ignore */ }
    };
  },
};

// --------- Namespaced key helpers (kept identical to the old redis.ts) ----------

export const keys = {
  tunnel: (tid: string) => `tunnel:${tid}`,
  userTunnels: (uid: string) => `user:${uid}:tunnels`,
  reqChan: (tid: string) => `req:${tid}`,
  respChan: (tid: string, rid: string) => `resp:${tid}:${rid}`,
  wsChan: (tid: string, rid: string) => `ws:${tid}:${rid}`,
};

export const TUNNEL_TTL_SECONDS = 120;
