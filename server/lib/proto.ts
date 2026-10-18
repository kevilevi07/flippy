// Wire protocol between the Rust CLI and this server (JSON over WS text frames).
// Kept in sync with terminal/src/proto.rs.

export type Frame =
  | { type: "ready"; tunnel_id: string; public_url: string }

  // ---------- HTTP forwarding ----------
  | {
      type: "request";
      req_id: string;
      method: string;
      path: string;
      headers: Record<string, string>;
      body_b64: string;
    }
  | {
      type: "response";
      req_id: string;
      status: number;
      headers: Record<string, string>;
      body_b64: string;
    }

  // ---------- WebSocket forwarding ----------
  | {
      type: "ws_open";
      req_id: string;
      path: string;
      headers: Record<string, string>;
    }
  | {
      type: "ws_frame";
      req_id: string;
      binary?: boolean;
      data_b64: string;
    }
  | {
      type: "ws_close";
      req_id: string;
      code?: number;
    }

  // ---------- Errors / keep-alive ----------
  | { type: "error"; req_id: string; message: string }
  | { type: "ping" }
  | { type: "pong" };

export function newId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const alpha = "abcdefghijkmnopqrstuvwxyz23456789";
  return [...bytes].map((b) => alpha[b % alpha.length]).join("");
}
