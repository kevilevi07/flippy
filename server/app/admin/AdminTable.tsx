"use client";
import { useState } from "react";

type Row = {
  id: string;
  email: string;
  flippy_token: string;
  created_at: number;
  tunnels: string[];
};

export default function AdminTable({ users: initial }: { users: Row[] }) {
  const [users, setUsers] = useState<Row[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function resetUserToken(id: string) {
    if (!confirm("Reset this user's token? Their existing CLI will stop working.")) return;
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${id}/reset-token`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "failed");
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, flippy_token: body.flippy_token } : u)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteUserRow(id: string, email: string) {
    if (!confirm(`DELETE user ${email}? Their tunnels will be killed and their token revoked.`)) return;
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "failed");
      setUsers((us) => us.filter((u) => u.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Users</h2>
      {err && <div className="error">{err}</div>}
      {users.length === 0 ? (
        <p className="muted">No users yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.6rem 0.4rem" }}>Email</th>
                <th style={{ padding: "0.6rem 0.4rem" }}>Token</th>
                <th style={{ padding: "0.6rem 0.4rem" }}>Live tunnels</th>
                <th style={{ padding: "0.6rem 0.4rem" }}>Joined</th>
                <th style={{ padding: "0.6rem 0.4rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.6rem 0.4rem" }}>{u.email}</td>
                  <td style={{ padding: "0.6rem 0.4rem" }} className="mono" title={u.flippy_token}>
                    {u.flippy_token.slice(0, 16)}…
                  </td>
                  <td style={{ padding: "0.6rem 0.4rem" }}>
                    {u.tunnels.length === 0 ? <span className="muted">–</span> : u.tunnels.join(", ")}
                  </td>
                  <td style={{ padding: "0.6rem 0.4rem" }} className="muted">
                    {new Date(u.created_at).toISOString().slice(0, 10)}
                  </td>
                  <td style={{ padding: "0.6rem 0.4rem", textAlign: "right" }}>
                    <button
                      className="btn"
                      style={{ marginRight: "0.4rem" }}
                      onClick={() => resetUserToken(u.id)}
                      disabled={busy === u.id}
                    >
                      Reset token
                    </button>
                    <button
                      className="btn"
                      style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                      onClick={() => deleteUserRow(u.id, u.email)}
                      disabled={busy === u.id}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
