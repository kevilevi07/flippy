// WebSocket endpoint that holds a persistent connection from the Rust CLI.
//
// Protocol:
//   1. CLI connects with `Authorization: Bearer <fly_...>`.
//   2. We validate the token against our DB -> user id.
//   3. Mint (or reuse via ?name=) a tunnel id. Store {tid -> user_id} in kv.
//   4. Subscribe to `req:<tid>` via Postgres LISTEN. Each notification is an
//      HTTP request or WsOpen that arrived on the public catch-all route;
//      forward to the CLI as a Frame.
//   5. When CLI sends `response`/`error`/`ws_frame`/`ws_close`, publish via
//      pg_notify back to the gateway.
//   6. Refresh tunnel TTL on each ping.

import { upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import type { Frame } from "@/lib/proto";
import { newId } from "@/lib/proto";
import { keys, kv, pubsub, sets, TUNNEL_TTL_SECONDS } from "@/lib/db";
import { userIdFromToken } from "@/lib/auth";
import { isValidName } from "@/lib/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return new Response("missing bearer token", { status: 401 });

  const userId = await userIdFromToken(token);
  if (!userId) return new Response("invalid flippy token", { status: 401 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("name") ?? url.searchParams.get("tid");

  let tid: string;
  if (requested) {
    if (!isValidName(requested)) {
      return new Response(
        "invalid app name: use 3-32 chars, lowercase a-z 0-9 and hyphens, " +
          "and avoid reserved words (api, _next, oauth, dashboard, login, ...)",
        { status: 400 },
      );
    }
    const existing = await kv.get(keys.tunnel(requested));
    if (existing) {
      try {
        const rec = JSON.parse(existing) as { user_id: string };
        if (rec.user_id !== userId) {
          return new Response(
            `app name "${requested}" is in use by another account`,
            { status: 409 },
          );
        }
      } catch {
        /* overwrite */
      }
    }
    tid = requested;
  } else {
    tid = newId(8);
  }

  const publicBase = (process.env.FLIPPY_PUBLIC_URL ?? url.origin).replace(/\/$/, "");
  const publicUrl = `${publicBase}/t/${tid}`;

  return upgradeWebSocket(async (ws: WebSocket) => {
    await claimTunnel(tid, userId);
    sendFrame(ws, { type: "ready", tunnel_id: tid, public_url: publicUrl });

    const closeSub = await pubsub.subscribe(keys.reqChan(tid), (payload) => {
      try {
        const frame = JSON.parse(payload) as Frame;
        sendFrame(ws, frame);
      } catch { /* ignore malformed */ }
    });

    const ttlTimer: NodeJS.Timeout = setInterval(() => {
      void kv.expire(keys.tunnel(tid), TUNNEL_TTL_SECONDS);
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
      // Tunnel key expires via TTL; a reconnect with ?name= resumes it.
    });
  });
}

async function claimTunnel(tid: string, userId: string): Promise<void> {
  const rec = JSON.stringify({ user_id: userId, created_at: Date.now() });
  await kv.set(keys.tunnel(tid), rec, TUNNEL_TTL_SECONDS);
  await sets.add(keys.userTunnels(userId), tid);
}

function sendFrame(ws: WebSocket, frame: Frame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch { /* socket may be closing */ }
}
