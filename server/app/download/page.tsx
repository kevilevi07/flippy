import Link from "next/link";

const PLATFORMS = [
  { label: "Windows x86_64", asset: "flippy-windows-x64.exe", file: "flippy.exe" },
  { label: "Linux x86_64", asset: "flippy-linux-x64", file: "flippy" },
  { label: "Linux ARM64 / Termux", asset: "flippy-linux-arm64", file: "flippy" },
  { label: "macOS Intel", asset: "flippy-darwin-x64", file: "flippy" },
  { label: "macOS Apple Silicon", asset: "flippy-darwin-arm64", file: "flippy" },
];

export default function Download() {
  const base = (process.env.FLIPPY_PUBLIC_URL ?? "https://flippy.vercel.app").replace(/\/$/, "");
  return (
    <>
      <nav>
        <div className="brand"><Link href="/" style={{ color: "inherit" }}>flippy</Link></div>
        <div className="links">
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Sign up</Link>
        </div>
      </nav>
      <div className="container">
        <h1>Install flippy</h1>
        <p className="muted">A single native binary. ~2.5 MB. No runtime dependencies.</p>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Windows (PowerShell)</h2>
          <pre className="block">{`irm ${base}/install.ps1 | iex`}</pre>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Installs <code>flippy.exe</code> to <code>%USERPROFILE%\\.flippy\\bin\\</code>,
            adds it to your user PATH, and prompts for your token.
          </p>
        </div>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>macOS / Linux / Termux</h2>
          <pre className="block">{`curl -sSL ${base}/install.sh | bash`}</pre>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Installs <code>flippy</code> to <code>~/.flippy/bin/</code>, adds it to PATH
            (<code>.bashrc</code>, <code>.zshenv</code>, <code>.profile</code>), prompts
            for your token. Works on Termux (Android) without Rust.
          </p>
        </div>

        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Direct binary downloads</h2>
          <ul>
            {PLATFORMS.map((p) => (
              <li key={p.asset} style={{ marginBottom: "0.4rem" }}>
                <a href={`${base}/bin/${p.asset}`} rel="noreferrer">
                  {p.asset}
                </a>{" "}
                <span className="muted">— {p.label}</span>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            Download, rename to <code>flippy</code> (or <code>flippy.exe</code> on Windows),
            <code> chmod +x</code> on Unix, put it anywhere on your PATH.
          </p>
        </div>

        <div style={{ marginTop: "2rem" }}>
          <Link className="btn btn-primary" href="/signup">Get a token</Link>
          <Link className="btn btn-ghost" href="/login" style={{ marginLeft: "0.5rem" }}>
            Already registered
          </Link>
        </div>
      </div>
    </>
  );
}
