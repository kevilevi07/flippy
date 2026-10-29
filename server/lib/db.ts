// Postgres-backed kv/sets/pub-sub, same shape as the in-memory store.
// Backed by Vercel's Marketplace Neon Postgres (free tier, no card).
//
// Pub/sub is implemented as polling of a `msg_queue` table rather than
// LISTEN/NOTIFY. This is slower (adds ~100 ms of polling latency) but is
// fully reliable across Vercel Function instances and Neon pooling modes.

import { Pool, neonConfig } from "@neondatabase/serverless";
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
  // Use the unpooled URL so pg_notify() isn't dropped by pgBouncer.
  if (!_pool) _pool = new Pool({ connectionString: unpooledUrl() });
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
      await p.query(`
        CREATE TABLE IF NOT EXISTS msg_queue (
          id          BIGSERIAL PRIMARY KEY,
          chan        TEXT NOT NULL,
          payload     TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await p.query(
        `CREATE INDEX IF NOT EXISTS msg_queue_chan_idx ON msg_queue(chan, id);`,
      );
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

// Fast idle poll (when we've been quiet for a while) and burst poll (when a
// message just arrived — likely more are on the way for the same channel).
// Burst mode is super-tight so interactive keystrokes echo back fast.
const IDLE_POLL_MS = 12;
const BURST_POLL_MS = 2;
const BURST_WINDOW_MS = 4000;
// Drop messages older than this to keep the queue tiny.
const MSG_TTL_SECONDS = 60;

// Per-channel insert chains. Keystrokes and PTY output chunks are published
// back-to-back; if their INSERTs ran concurrently the BIGSERIAL ids (which
// subscribers order by) could be assigned out of order, reordering frames and
// scrambling the stream. Chaining each channel's inserts keeps them in call
// order so delivery order == send order.
const _pubChain = new Map<string, Promise<unknown>>();

export const pubsub = {
  async publish(channel: string, payload: string): Promise<void> {
    const prev = _pubChain.get(channel) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() =>
        q(`INSERT INTO msg_queue(chan, payload) VALUES ($1, $2)`, [
          channel,
          payload,
        ]),
      );
    _pubChain.set(channel, next);
    try {
      await next;
    } finally {
      if (_pubChain.get(channel) === next) _pubChain.delete(channel);
    }
  },

  async sweep(): Promise<void> {
    try {
      await pool().query(
        `DELETE FROM msg_queue WHERE created_at < now() - interval '${MSG_TTL_SECONDS} seconds'`,
      );
    } catch { /* ignore */ }
  },

  /**
   * Subscribe to a channel by polling. Only delivers messages inserted AFTER
   * subscribe() returns, so callers must subscribe before publishing their
   * matching outbound frame (same pattern as before).
   */
  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    await ensureSchema();
    // Watermark: start from the current max id so we never replay old rows.
    const r = await pool().query<{ max_id: string | null }>(
      `SELECT COALESCE(MAX(id), 0)::text AS max_id FROM msg_queue WHERE chan = $1`,
      [channel],
    );
    let lastId = BigInt(r.rows[0]?.max_id ?? "0");
    let stopped = false;

    // Start in burst mode so the first message after subscribe is caught at
    // BURST_POLL_MS rather than waiting a full idle interval.
    let lastHit = Date.now();
    const loop = async () => {
      while (!stopped) {
        try {
          const batch = await pool().query<{ id: string; payload: string }>(
            `SELECT id::text, payload FROM msg_queue
             WHERE chan = $1 AND id > $2
             ORDER BY id ASC
             LIMIT 200`,
            [channel, lastId.toString()],
          );
          if (batch.rows.length > 0) {
            lastHit = Date.now();
            for (const row of batch.rows) {
              lastId = BigInt(row.id);
              try { handler(row.payload); } catch { /* swallow */ }
            }
          }
        } catch { /* keep polling on transient errors */ }
        if (stopped) break;
        // Burst mode: if we had a hit recently, poll aggressively so
        // multi-chunk streams (PTY output, body bytes) flush fast.
        const burst = Date.now() - lastHit < BURST_WINDOW_MS;
        await new Promise((r) =>
          setTimeout(r, burst ? BURST_POLL_MS : IDLE_POLL_MS),
        );
      }
    };
    void loop();

    return async () => {
      stopped = true;
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
