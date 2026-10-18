// Bundler-safe import: ioredis's default export sometimes trips Next's
// esModuleInterop transform ("d is not a constructor") when minified.
import * as IoRedisNS from "ioredis";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Redis: typeof import("ioredis").Redis =
  (IoRedisNS as unknown as { default?: typeof import("ioredis").Redis }).default ??
  (IoRedisNS as unknown as { Redis: typeof import("ioredis").Redis }).Redis;

// We keep two separate connections: one for commands, one for subscriber.
// (ioredis forbids issuing commands on a subscribed client.)
type RedisClient = InstanceType<typeof import("ioredis").Redis>;
let _cmd: RedisClient | null = null;
let _sub: RedisClient | null = null;

function url(): string {
  const u = process.env.REDIS_URL ?? process.env.KV_URL ?? process.env.UPSTASH_REDIS_URL;
  if (!u) throw new Error("REDIS_URL is not set");
  return u;
}

export function redis(): RedisClient {
  if (!_cmd) _cmd = new Redis(url(), { lazyConnect: false, maxRetriesPerRequest: 2 });
  return _cmd;
}

export function subscriber(): RedisClient {
  if (!_sub) _sub = new Redis(url(), { lazyConnect: false, maxRetriesPerRequest: null });
  return _sub;
}

export const keys = {
  tunnel: (tid: string) => `tunnel:${tid}`,
  userTunnels: (uid: string) => `user:${uid}:tunnels`,
  reqChan: (tid: string) => `req:${tid}`,
  respChan: (tid: string, rid: string) => `resp:${tid}:${rid}`,
  /// WebSocket per-session channel: CLI -> public gateway for a given req_id.
  wsChan: (tid: string, rid: string) => `ws:${tid}:${rid}`,
};

export const TUNNEL_TTL_SECONDS = 120;
