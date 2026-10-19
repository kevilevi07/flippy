"use client";

import { useState } from "react";

export default function LoginForm() {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `login failed (${res.status})`);
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div className="field">
        <label htmlFor="u">Username</label>
        <input id="u" type="text" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="p">Password</label>
        <input id="p" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
      </div>
      {err && <div className="err">{err}</div>}
      <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: "0.6rem" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
