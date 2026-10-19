import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { listLiveTunnels } from "@/lib/tunnels";
import LogoutButton from "./LogoutButton";
import CopyCommand from "./CopyCommand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!(await isAdmin())) redirect("/");

  const live = await listLiveTunnels();
  const base = (process.env.TRUPX_PUBLIC_URL ?? "")
    .replace(/^[﻿​\s]+/, "")
    .replace(/[\s﻿​]+$/, "")
    .replace(/\/+$/, "");
  const server = base || "https://trupx.vercel.app";

  return (
    <>
      <nav>
        <div className="brand">trupx · admin</div>
        <div><LogoutButton /></div>
      </nav>

      <div className="container">
        {/* ---- Stats row ---- */}
        <div className="stat-row">
          <div className="stat">
            <div className="label">Live sessions</div>
            <div className={`value ${live.length > 0 ? "ok" : ""}`}>{live.length}</div>
            <div className="sub">tunnels currently connected</div>
          </div>
          <div className="stat">
            <div className="label">Server</div>
            <div className="mono" style={{ fontSize: "1rem", marginTop: "0.6rem", wordBreak: "break-all" }}>
              {server}
            </div>
          </div>
        </div>

        {/* ---- Open tunnels ---- */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="section-head">
            <h2>Open tunnels</h2>
            <p>{live.length} active</p>
          </div>

          {live.length === 0 ? (
            <div className="card-pressed" style={{ padding: "1.5rem", borderRadius: 16, textAlign: "center", color: "var(--muted)" }}>
              No active tunnels. Install trupx on a machine and run it — it&apos;ll appear here.
            </div>
          ) : (
            <table className="clay-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>URL slug</th>
                  <th>Public URL</th>
                </tr>
              </thead>
              <tbody>
                {live.map((t) => (
                  <tr key={t.name}>
                    <td>{t.hostname || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                    <td>{t.name}</td>
                    <td>
                      <a href={`${server}/${t.name}/`} target="_blank" rel="noreferrer">
                        {server}/{t.name}/
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ---- Download / install ---- */}
        <div className="card">
          <div className="section-head">
            <h2>Install trupx</h2>
            <p>one binary · copy, paste, run</p>
          </div>

          <CopyCommand
            label="Windows · install only"
            command={`iwr ${server}/install.ps1 -useb | iex`}
          />
          <CopyCommand
            label="Windows · install + auto-start on login"
            command={`iwr ${server}/setup.ps1 -useb | iex`}
          />
          <CopyCommand
            label="Linux / Termux · install only"
            command={`curl -fsSL ${server}/install.sh | sh`}
          />
          <CopyCommand
            label="Linux / Termux · install + auto-start on boot"
            command={`curl -fsSL ${server}/setup.sh | sh`}
          />

          <div style={{ marginTop: "1.5rem", opacity: 0.65, fontSize: "0.9rem" }}>
            Each command downloads the single binary, installs it, and starts a tunnel in the background.
            Setup variants also register the OS auto-start hook (Task Scheduler / systemd / Termux:Boot).
            Remove everything with <code>trupx uninstall</code>.
          </div>
        </div>
      </div>
    </>
  );
}
