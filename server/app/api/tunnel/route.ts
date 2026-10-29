// WebSocket endpoint that holds a persistent connection from the Rust CLI.
//
// No auth: this server is single-user, and the admin dashboard is already
// gated by ADMIN_USERNAME/PASSWORD. If a requested tunnel name is already
// live we auto-suffix with a short random string so there are no clashes.
//
// Cross-instance state (tunnel registry + request/response bridging) lives
// in Vercel Marketplace Postgres (Neon), via lib/db.ts.

import { upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import type { Frame } from "@/lib/proto";
import { newId } from "@/lib/proto";
import { keys, kv, pubsub, TUNNEL_TTL_SECONDS } from "@/lib/db";
import { isValidName } from "@/lib/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requested = url.searchParams.get("name") ?? url.searchParams.get("tid");
  const hostname = (url.searchParams.get("hostname") ?? "").slice(0, 64);

  // Single-user server: if a valid name is requested, we always honour it
  // (even if a stale record exists from a previous Function instance). This
  // keeps the public URL stable across Vercel's ~5-minute Function recycles
  // — the CLI reconnects with the same name and the record is overwritten.
  let tid: string;
  if (requested) {
    const name: string = String(requested);
    const stem = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "");
    tid = isValidName(name) ? name : (stem || `term-${newId(4)}`);
  } else {
    tid = newId(8);
  }
  // Instance id so a stale close-handler on an older Function doesn't
  // delete the record a newer connection has claimed.
  const instanceId = newId(10);

  const publicBase = (process.env.TRUPX_PUBLIC_URL ?? url.origin)
    .replace(/^[﻿​\s]+/, "")
    .replace(/[\s﻿​]+$/, "")
    .replace(/\/+$/, "");
  const publicUrl = `${publicBase}/${tid}`;

  return upgradeWebSocket(async (ws: WebSocket) => {
    const rec = JSON.stringify({
      hostname,
      created_at: Date.now(),
      instance_id: instanceId,
    });
    await kv.set(keys.tunnel(tid), rec, TUNNEL_TTL_SECONDS);
    sendFrame(ws, { type: "ready", tunnel_id: tid, public_url: publicUrl });

    const closeSub = await pubsub.subscribe(keys.reqChan(tid), (payload) => {
      try {
        const frame = JSON.parse(payload) as Frame;
        sendFrame(ws, frame);
      } catch { /* ignore malformed */ }
    });

    const ttlTimer: NodeJS.Timeout = setInterval(() => {
      // Re-write the full record so a stale instance can't win the key by
      // re-expiring an older row. Also keeps hostname fresh.
      void kv.set(keys.tunnel(tid), rec, TUNNEL_TTL_SECONDS);
    }, 30_000);

    ws.on("message", async (data) => {
      let text: string;
      if (typeof data === "string") text = data;
      else if (Buffer.isBuffer(data)) text = data.toString("utf8");
      else text = Buffer.from(data as ArrayBuffer).toString("utf8");

      let frame: Frame;
      try {
        frame = JSON.parse(text) as Frame;
      } catch {
        return;
      }

      switch (frame.type) {
        case "ping":
          sendFrame(ws, { type: "pong" });
          await kv.expire(keys.tunnel(tid), TUNNEL_TTL_SECONDS);
          return;
        case "pong":
          return;
        case "response":
        case "error":
          await pubsub.publish(
            keys.respChan(tid, frame.req_id),
            JSON.stringify(frame),
          );
          return;
        case "ws_frame":
        case "ws_close":
          await pubsub.publish(keys.wsChan(tid, frame.req_id), JSON.stringify(frame));
          return;
        default:
          return;
      }
    });

    ws.on("close", async () => {
      clearInterval(ttlTimer);
      await closeSub();
      // Intentionally DO NOT delete the tunnel record here. Vercel recycles
      // this Function at its duration cap (~5 min) and the CLI immediately
      // reconnects with the same name; deleting on close would make the
      // public URL 404 during that sub-second gap — which is exactly the
      // "tunnel not found or offline" the user hit. The record carries a short
      // TTL (TUNNEL_TTL_SECONDS), so if the CLI genuinely goes away it expires
      // on its own within a couple of minutes.
    });
  });
}

function sendFrame(ws: WebSocket, frame: Frame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch { /* socket may be closing */ }
}
