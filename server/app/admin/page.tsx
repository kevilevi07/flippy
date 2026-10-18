import Link from "next/link";
import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/admin-auth";
import { listAllUsers } from "@/lib/auth";
import { keys, kv, sets } from "@/lib/db";
import AdminTable from "./AdminTable";
import AdminLogoutButton from "./AdminLogoutButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  if (!adminConfigured()) {
    return (
      <div className="container">
        <h1>Admin</h1>
        <p className="muted">
          Admin is disabled: set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code>
          {" "}env vars in Vercel and redeploy.
        </p>
      </div>
    );
  }
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }

  const users = await listAllUsers();

  // Count live tunnels + attach each user's active tunnel ids.
  const augmented = await Promise.all(
    users.map(async (u) => {
      const ids: string[] = await sets.members(keys.userTunnels(u.id));
      const live: string[] = [];
      for (const t of ids) {
        if (await kv.exists(keys.tunnel(t))) live.push(t);
      }
      return { ...u, tunnels: live };
    }),
  );
  const liveTotal = augmented.reduce((n, u) => n + u.tunnels.length, 0);

  return (
    <>
      <nav>
        <div className="brand"><Link href="/" style={{ color: "inherit" }}>flippy · admin</Link></div>
        <div className="links">
          <AdminLogoutButton />
        </div>
      </nav>
      <div className="container">
        <h1>Admin</h1>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0 2rem" }}>
          <div className="card" style={{ flex: 1, minWidth: 180 }}>
            <div className="muted" style={{ fontSize: "0.85rem" }}>USERS</div>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{users.length}</div>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180 }}>
            <div className="muted" style={{ fontSize: "0.85rem" }}>LIVE TUNNELS</div>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{liveTotal}</div>
          </div>
        </div>
        <AdminTable users={augmented} />
      </div>
    </>
  );
}
