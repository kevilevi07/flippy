// In-process KV + pub/sub for the Fly.io deployment target.
//
// Why in-memory: Fly.io runs a single long-lived container by default, so
// every HTTP request + WebSocket lands on the same process. We don't need
// a shared database for the tunnel bridge — plain Maps and an EventEmitter
// are enough.
//
// Trade-off: state is lost on container restart. That's fine here because
// the only thing we store is live-tunnel registry entries (which have a
// 120 s TTL anyway and the CLI auto-reconnects). No user accounts.

import { EventEmitter } from "node:events";

type Entry = { v: string; expiresAt?: number };

const kvMap = new Map<string, Entry>();
const setMap = new Map<string, Set<string>>();
const bus = new EventEmitter();
bus.setMaxListeners(0); // many tunnels => many listeners; disable warning

function alive(e: Entry): boolean {
  return e.expiresAt == null || e.expiresAt > Date.now();
}

function sweepIfExpired(k: string, e: Entry | undefined): Entry | undefined {
  if (e && !alive(e)) {
    kvMap.delete(k);
    return undefined;
  }
  return e;
}

export const kv = {
  async get(key: string): Promise<string | null> {
    const e = sweepIfExpired(key, kvMap.get(key));
    return e?.v ?? null;
  },
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    kvMap.set(key, {
      v: value,
      expiresAt: ttlSec && ttlSec > 0 ? Date.now() + ttlSec * 1000 : undefined,
    });
  },
  async delete(key: string): Promise<void> {
    kvMap.delete(key);
  },
  async exists(key: string): Promise<boolean> {
    const e = sweepIfExpired(key, kvMap.get(key));
    return !!e;
  },
  async expire(key: string, ttlSec: number): Promise<void> {
    const e = kvMap.get(key);
    if (e && alive(e)) e.expiresAt = Date.now() + ttlSec * 1000;
  },
};

export const sets = {
  async add(key: string, member: string): Promise<void> {
    let s = setMap.get(key);
    if (!s) {
      s = new Set();
      setMap.set(key, s);
    }
    s.add(member);
  },
  async remove(key: string, member: string): Promise<void> {
    setMap.get(key)?.delete(member);
  },
  async members(key: string): Promise<string[]> {
    return Array.from(setMap.get(key) ?? []);
  },
  async removeKey(key: string): Promise<void> {
    setMap.delete(key);
  },
};

export const pubsub = {
  async publish(channel: string, payload: string): Promise<void> {
    bus.emit(channel, payload);
  },
  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    const wrapped = (p: string) => {
      try {
        handler(p);
      } catch { /* swallow handler errors */ }
    };
    bus.on(channel, wrapped);
    return async () => {
      bus.off(channel, wrapped);
    };
  },
};

export const keys = {
  tunnel: (tid: string) => `tunnel:${tid}`,
  userTunnels: (uid: string) => `user:${uid}:tunnels`, // kept for API parity
  reqChan: (tid: string) => `req:${tid}`,
  respChan: (tid: string, rid: string) => `resp:${tid}:${rid}`,
  wsChan: (tid: string, rid: string) => `ws:${tid}:${rid}`,
};

export const TUNNEL_TTL_SECONDS = 120;
