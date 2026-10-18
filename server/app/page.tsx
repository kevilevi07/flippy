export default function Home() {
  return (
    <>
      <nav>
        <div className="brand">flippy</div>
      </nav>

      <section className="hero">
        <h1>A web terminal, reachable from anywhere.</h1>
        <p className="lead">
          A tiny Rust binary that opens a live web terminal on your machine —
          and, with one flag, forwards it to a public URL on this server.
        </p>
      </section>

      <div className="container">
        <pre className="block">{`# Local terminal only
flippy
# -> http://localhost:8090 (same machine or LAN)

# Local terminal + public URL (shared machine or world)
flippy login --server https://<your-fly-app>.fly.dev --token <your-cli-token>
flippy --tunnel --name myterm
# -> share https://<your-fly-app>.fly.dev/t/myterm/`}</pre>

        <div className="grid3">
          <div className="card feature">
            <h3>Web terminal, your shell</h3>
            <p>PowerShell on Windows, bash on Linux/Termux, zsh on macOS — in a browser.</p>
          </div>
          <div className="card feature">
            <h3>Self-hosted tunnel</h3>
            <p>Public URL served by your own Fly.io app. No middleman, no third-party service.</p>
          </div>
          <div className="card feature">
            <h3>Zero storage</h3>
            <p>No database. State lives in-process. One admin token, set as an env var.</p>
          </div>
        </div>
      </div>
    </>
  );
}
