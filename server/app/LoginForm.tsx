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
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.85rem", opacity: 0.75 }}>Username</span>
        <input
          type="text"
          value={u}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
          required
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#111",
            color: "#eee",
            fontSize: "1rem",
          }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.85rem", opacity: 0.75 }}>Password</span>
        <input
          type="password"
          value={p}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
          required
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#111",
            color: "#eee",
            fontSize: "1rem",
          }}
        />
      </label>
      {err && <div style={{ color: "#ff6b6b", fontSize: "0.9rem" }}>{err}</div>}
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: "0.6rem 1rem",
          borderRadius: 6,
          border: "none",
          background: busy ? "#333" : "#ffb454",
          color: "#000",
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
          fontSize: "1rem",
        }}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
