// WebSocket endpoint that holds a persistent connection from the Rust CLI.
//
// Auth: single `CLI_TOKEN` env var — set when you deploy. The CLI sends it
// as `Authorization: Bearer <token>`. One token = one admin = you.
//
// Cross-instance state (tunnel registry + request/response bridging) lives
// in Vercel Marketplace Postgres (Neon), via lib/db.ts.

import { upgradeWebSocket } from "@vercel/functions";
import type { WebSocket } from "ws";
import type { Frame } from "@/lib/proto";
import { newId } from "@/lib/proto";
import { keys, kv, pubsub, TUNNEL_TTL_SECONDS } from "@/lib/db";
import { isValidName } from "@/lib/names";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(provided: string): boolean {
  const expected = (process.env.CLI_TOKEN ?? "").trim();
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !tokenOk(token)) {
    return new Response("invalid or missing bearer token", { status: 401 });
  }

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
    tid = requested;
  } else {
    tid = newId(8);
  }

  const publicBase = (process.env.PUBLIC_URL ?? url.origin).replace(/\/$/, "");
  const publicUrl = `${publicBase}/${tid}`;

  return upgradeWebSocket(async (ws: WebSocket) => {
    await kv.set(keys.tunnel(tid), "1", TUNNEL_TTL_SECONDS);
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
      await kv.delete(keys.tunnel(tid));
    });
  });
}

function sendFrame(ws: WebSocket, frame: Frame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch { /* socket may be closing */ }
}
