"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "login failed");
      router.push("/admin");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <nav>
        <div className="brand"><Link href="/" style={{ color: "inherit" }}>flippy</Link></div>
      </nav>
      <form className="card form-card" onSubmit={submit}>
        <h1 style={{ marginTop: 0 }}>Admin sign in</h1>
        {err && <div className="error">{err}</div>}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </>
  );
}
