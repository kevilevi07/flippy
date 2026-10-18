import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionUserId, userById } from "@/lib/auth";
import { keys, redis } from "@/lib/redis";
import CopyRow from "./CopyRow";
import LogoutButton from "./LogoutButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const uid = await sessionUserId();
  if (!uid) redirect("/login");
  const user = await userById(uid);
  if (!user) redirect("/login");

  const r = redis();
  const rawTids = await r.smembers(keys.userTunnels(uid));
  const live: string[] = [];
  for (const t of rawTids) {
    if ((await r.exists(keys.tunnel(t))) === 1) live.push(t);
  }

  const base =
    (process.env.FLIPPY_PUBLIC_URL ?? "https://flippy.vercel.app").replace(/\/$/, "");

  return (
    <>
      <nav>
        <div className="brand"><Link href="/" style={{ color: "inherit" }}>flippy</Link></div>
        <div className="links">
          <Link href="/download">Download</Link>
          <LogoutButton />
        </div>
      </nav>
      <div className="container">
        <h1>Dashboard</h1>
        <p className="muted">Signed in as {user.email}</p>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Your flippy token</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Paste this when you run <code>flippy login</code>. Treat it like a
            password — it authorizes any CLI to open tunnels as you.
          </p>
          <CopyRow value={user.flippy_token} />
        </div>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>One-command install (with your token)</h2>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Copy and paste. Installs the CLI and logs you in — no extra steps.
          </p>

          <h3 style={{ marginBottom: "0.25rem" }}>Windows (PowerShell)</h3>
          <CopyRow
            value={`$env:FLIPPY_TOKEN='${user.flippy_token}'; irm ${base}/install.ps1 | iex`}
          />

          <h3 style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
            macOS / Linux / Termux
          </h3>
          <CopyRow
            value={`curl -sSL ${base}/install.sh | bash -s -- ${user.flippy_token}`}
          />

          <p className="muted" style={{ fontSize: "0.85rem", marginTop: "1rem" }}>
            Then open a new terminal and run:{" "}
            <code>flippy http 3000 --name my-app</code>
          </p>
        </div>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Live tunnels</h2>
          {live.length === 0 ? (
            <p className="muted">No active tunnels. Start one with the CLI.</p>
          ) : (
            <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
              {live.map((t) => (
                <li key={t} style={{ marginBottom: "0.5rem" }}>
                  <a href={`${base}/app/${t}`} target="_blank" rel="noreferrer">
                    {base}/app/{t}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
