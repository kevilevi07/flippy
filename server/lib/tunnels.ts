// Helpers for the admin dashboard to list live tunnels.

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

if (typeof WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  neonConfig.webSocketConstructor = ws as any;
}

let _p: Pool | null = null;
function p(): Pool {
  if (!_p) {
    const u =
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL;
    if (!u) throw new Error("DATABASE_URL is not set");
    _p = new Pool({ connectionString: u });
  }
  return _p;
}

export type LiveTunnel = {
  name: string;
  hostname: string;
  expires_at: string | null;
};

export async function listLiveTunnels(): Promise<LiveTunnel[]> {
  try {
    const r = await p().query<{ k: string; v: string | null; expires_at: string | null }>(
      `SELECT k, v, expires_at FROM kv
       WHERE k LIKE 'tunnel:%'
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY k`,
    );
    return r.rows.map((row) => {
      let hostname = "";
      try {
        if (row.v && row.v.startsWith("{")) {
          const obj = JSON.parse(row.v) as { hostname?: string };
          hostname = (obj.hostname ?? "").trim();
        }
      } catch { /* legacy "1" record — no hostname */ }
      return {
        name: row.k.replace(/^tunnel:/, ""),
        hostname,
        expires_at: row.expires_at,
      };
    });
  } catch {
    return [];
  }
}
