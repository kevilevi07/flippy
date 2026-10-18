import Link from "next/link";

export default function Home() {
  return (
    <>
      <nav>
        <div className="brand">flippy</div>
        <div className="links">
          <Link href="/download">Download</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Sign up</Link>
        </div>
      </nav>

      <section className="hero">
        <h1>A web terminal you can reach from anywhere.</h1>
        <p className="lead">
          Flippy is a tiny Rust binary that opens a live web terminal on your
          machine — and, with one flag, exposes it to the world through a public
          URL served by your own Vercel app.
        </p>
        <div className="cta">
          <Link className="btn btn-primary" href="/signup">Create an account</Link>
          <Link className="btn btn-ghost" href="/download">Install the CLI</Link>
        </div>
      </section>

      <div className="container">
        <pre className="block">{`# 1. Local terminal only
flippy
# -> open http://localhost:8090

# 2. Local terminal + public URL (login once with your token)
flippy login --token fly_...
flippy --tunnel --name myterm
# -> share https://flippy.vercel.app/t/myterm/`}</pre>

        <div className="grid3">
          <div className="card feature">
            <h3>Web terminal, your shell</h3>
            <p>PowerShell on Windows, bash on Linux/Termux, zsh on macOS — in a browser.</p>
          </div>
          <div className="card feature">
            <h3>Self-hosted tunnel</h3>
            <p>No ngrok, no middleman. The public URL lives on your Vercel account.</p>
          </div>
          <div className="card feature">
            <h3>One tiny binary</h3>
            <p>~2 MB native binary. Windows, Linux x64/arm64, macOS, Termux.</p>
          </div>
        </div>
      </div>
    </>
  );
}
