"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "signup failed");
      router.push("/dashboard");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <nav>
        <div className="brand"><Link href="/" style={{ color: "inherit" }}>flippy</Link></div>
        <div className="links"><Link href="/login">Sign in</Link></div>
      </nav>
      <form className="card form-card" onSubmit={submit}>
        <h1 style={{ marginTop: 0 }}>Create account</h1>
        {err && <div className="error">{err}</div>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password <span className="muted">(min 8 chars)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Creating..." : "Create account"}
        </button>
        <div className="footer">Already have an account? <Link href="/login">Sign in</Link></div>
      </form>
    </>
  );
}
