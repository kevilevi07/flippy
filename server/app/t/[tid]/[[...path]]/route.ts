// Public catch-all. Any request to /t/<tid>/<rest> is forwarded through
// Postgres pub/sub to the Function instance holding the CLI's WebSocket.
//
// WebSocket upgrades: when the incoming request wants to upgrade to WS, we
// upgrade on this side, allocate a req_id and pump bidirectional data via
// LISTEN/NOTIFY on `ws:<tid>:<req_id>`, bridged to WsFrame / WsClose protocol
// frames on the CLI side.

import { upgradeWebSocket } from "@vercel/functions";
import type { WebSocket as NodeWebSocket } from "ws";
import type { Frame } from "@/lib/proto";
import { newId } from "@/lib/proto";
import { keys, kv, pubsub } from "@/lib/store";
import { injectShim } from "@/lib/html-shim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPLY_TIMEOUT_MS = 55_000; // under Vercel Hobby 60s route cap
const WS_SESSION_TIMEOUT_MS = 290_000; // under Vercel Hobby 300s function cap

type Ctx = { params: Promise<{ tid: string; path?: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { tid, path } = await ctx.params;

  const alive = await kv.exists(keys.tunnel(tid));
  if (!alive) {
    return new Response(`tunnel ${tid} not found or offline`, {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  const forwardPath =
    "/" + (path ?? []).join("/") + (new URL(req.url).search || "");

  const upgrade = req.headers.get("upgrade")?.toLowerCase();
  if (upgrade === "websocket") {
    return handleWsUpgrade(req, tid, forwardPath);
  }

  const reqId = newId(10);

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    const kl = k.toLowerCase();
    if (kl === "host" || kl === "connection") return;
    headers[k] = v;
  });

  const bodyBuf = req.body ? await req.arrayBuffer() : new ArrayBuffer(0);
  const body_b64 = Buffer.from(bodyBuf).toString("base64");

  const outbound: Frame = {
    type: "request",
    req_id: reqId,
    method: req.method,
    path: forwardPath,
    headers,
    body_b64,
  };

  // Subscribe BEFORE publishing to avoid missing the reply.
  const chan = keys.respChan(tid, reqId);
  let resolveReply: ((f: Frame) => void) | null = null;
  let rejectReply: ((e: Error) => void) | null = null;
  const waiter = new Promise<Frame>((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  });
  const closeSub = await pubsub.subscribe(chan, (payload) => {
    try {
      const f = JSON.parse(payload) as Frame;
      resolveReply?.(f);
    } catch (e) {
      rejectReply?.(e as Error);
    }
  });
  const timer = setTimeout(() => rejectReply?.(new Error("timeout")), REPLY_TIMEOUT_MS);

  await pubsub.publish(keys.reqChan(tid), JSON.stringify(outbound));

  let reply: Frame;
  try {
    reply = await waiter;
  } catch {
    clearTimeout(timer);
    await closeSub();
    return new Response("tunnel timeout", { status: 504 });
  }
  clearTimeout(timer);
  await closeSub();

  if (reply.type === "error") {
    return new Response(`local app error: ${reply.message}`, { status: 502 });
  }
  if (reply.type !== "response") {
    return new Response("bad tunnel reply", { status: 502 });
  }

  const resHeaders = new Headers();
  let contentType = "";
  let contentEncoding = "";
  for (const [k, v] of Object.entries(reply.headers)) {
    const kl = k.toLowerCase();
    if (kl === "transfer-encoding" || kl === "connection" || kl === "content-length") {
      continue;
    }
    if (kl === "content-type") contentType = v;
    if (kl === "content-encoding") contentEncoding = v;

    // Rewrite redirect targets so a local "/login" redirect from the app
    // stays inside the tunnel.
    let value = v;
    if (kl === "location" && value.startsWith("/") && !value.startsWith("//")) {
      const prefix = `/t/${tid}`;
      if (value !== prefix && !value.startsWith(prefix + "/")) {
        value = prefix + value;
      }
    }

    try {
      resHeaders.set(k, value);
    } catch {
      /* ignore invalid header name */
    }
  }

  const encodingOk = !contentEncoding || /^identity$/i.test(contentEncoding);
  const isHtml = /^text\/html\b/i.test(contentType);

  let bodyBytes: Uint8Array;
  if (isHtml && encodingOk) {
    const html = Buffer.from(reply.body_b64, "base64").toString("utf8");
    const injected = injectShim(html, tid);
    bodyBytes = new Uint8Array(Buffer.from(injected, "utf8"));
    resHeaders.delete("content-length");
  } else {
    bodyBytes = new Uint8Array(Buffer.from(reply.body_b64, "base64"));
  }
  return new Response(bodyBytes as BodyInit, {
    status: reply.status,
    headers: resHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;

// ---------- WebSocket proxy ----------
function handleWsUpgrade(req: Request, tid: string, forwardPath: string): Promise<Response> {
  const reqId = newId(12);

  const hdrs: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    const kl = k.toLowerCase();
    if (
      kl === "host" ||
      kl === "connection" ||
      kl === "upgrade" ||
      kl === "sec-websocket-key" ||
      kl === "sec-websocket-version" ||
      kl === "sec-websocket-accept" ||
      kl === "sec-websocket-extensions"
    ) return;
    hdrs[k] = v;
  });

  return upgradeWebSocket(async (ws: NodeWebSocket) => {
    let closed = false;
    let closeSub: (() => Promise<void>) | null = null;
    let sessionTimer: NodeJS.Timeout | null = null;

    const closeAll = async () => {
      if (closed) return;
      closed = true;
      try { ws.close(); } catch { /* already closing */ }
      if (closeSub) {
        try { await closeSub(); } catch { /* ignore */ }
      }
      if (sessionTimer) clearTimeout(sessionTimer);
    };

    closeSub = await pubsub.subscribe(keys.wsChan(tid, reqId), (payload) => {
      let frame: Frame;
      try { frame = JSON.parse(payload) as Frame; } catch { return; }
      if (frame.type === "ws_frame") {
        try {
          const data = Buffer.from(frame.data_b64, "base64");
          if (frame.binary) {
            ws.send(data);
          } else {
            ws.send(data.toString("utf8"));
          }
        } catch { /* socket may be closing */ }
      } else if (frame.type === "ws_close" || frame.type === "error") {
        void closeAll();
      }
    });

    // Ask the CLI to open the local WS.
    await pubsub.publish(
      keys.reqChan(tid),
      JSON.stringify({ type: "ws_open", req_id: reqId, path: forwardPath, headers: hdrs } satisfies Frame),
    );

    ws.on("message", async (data, isBinary) => {
      let buf: Buffer;
      if (typeof data === "string") buf = Buffer.from(data, "utf8");
      else if (Buffer.isBuffer(data)) buf = data;
      else if (Array.isArray(data)) buf = Buffer.concat(data);
      else buf = Buffer.from(data as ArrayBuffer);
      const outFrame: Frame = {
        type: "ws_frame",
        req_id: reqId,
        binary: !!isBinary,
        data_b64: buf.toString("base64"),
      };
      await pubsub.publish(keys.reqChan(tid), JSON.stringify(outFrame)).catch(() => {});
    });

    ws.on("close", async () => {
      const outFrame: Frame = { type: "ws_close", req_id: reqId, code: 1000 };
      await pubsub.publish(keys.reqChan(tid), JSON.stringify(outFrame)).catch(() => {});
      await closeAll();
    });

    sessionTimer = setTimeout(() => { void closeAll(); }, WS_SESSION_TIMEOUT_MS);
  });
}
