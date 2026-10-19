import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { listLiveTunnels } from "@/lib/tunnels";
import LogoutButton from "./LogoutButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!(await isAdmin())) redirect("/");

  const live = await listLiveTunnels();
  // Strip BOM + whitespace that sometimes sneaks in when env vars are pasted.
  const base = (process.env.TRUPX_PUBLIC_URL ?? "")
    .replace(/^[﻿​\s]+/, "")
    .replace(/[\s﻿​]+$/, "")
    .replace(/\/+$/, "");

  return (
    <>
      <nav>
        <div className="brand">trupx · admin</div>
        <div><LogoutButton /></div>
      </nav>

      <div className="container">
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0 2rem" }}>
          <div className="card" style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: "0.8rem", opacity: 0.6, letterSpacing: 1 }}>LIVE SESSIONS</div>
            <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#87d96c" }}>{live.length}</div>
          </div>
          <div className="card" style={{ flex: 2, minWidth: 320 }}>
            <div style={{ fontSize: "0.8rem", opacity: 0.6, letterSpacing: 1 }}>SERVER</div>
            <div style={{ fontSize: "1rem", fontFamily: "monospace", marginTop: "0.5rem" }}>
              {base || "(TRUPX_PUBLIC_URL not set)"}
            </div>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Open tunnels</h2>
          {live.length === 0 ? (
            <p style={{ opacity: 0.65 }}>No active tunnels. Start one with the CLI:</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.65 }}>
                  <th style={{ padding: "0.5rem" }}>Hostname</th>
                  <th style={{ padding: "0.5rem" }}>URL slug</th>
                  <th style={{ padding: "0.5rem" }}>Public URL</th>
                </tr>
              </thead>
              <tbody>
                {live.map((t) => (
                  <tr key={t.name} style={{ borderTop: "1px solid #222" }}>
                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>
                      {t.hostname || <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{t.name}</td>
                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>
                      {base ? (
                        <a href={`${base}/${t.name}/`} target="_blank" rel="noreferrer">
                          {base}/{t.name}/
                        </a>
                      ) : (
                        <span>/{t.name}/</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <pre className="block" style={{ marginTop: "1.5rem", fontSize: "0.85rem" }}>{`trupx login --server ${base || "https://trupx.vercel.app"} --token <CLI_TOKEN>
trupx start myapp`}</pre>
        </div>
      </div>
    </>
  );
}
