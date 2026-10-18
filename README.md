# Flippy

**A web terminal, reachable from anywhere via your own Fly.io app.**

- `flippy` opens a live browser terminal on your machine (ttyd-style)
- `flippy --tunnel` exposes that terminal to the world through *your* Fly.io app
- **One ~3 MB native binary.** Windows, Linux, macOS, Termux (Android).
- **No database.** No credit card. State lives in the server process.

```
┌──────────────┐    outbound WS    ┌──────────────────┐    HTTPS/WSS   ┌─────────┐
│ flippy.exe   │ ────────────────▶ │  Fly.io app      │ ◀───────────── │ browser │
│ (your PC)    │ ◀──────────────── │  (your account)  │                │ anywhere│
└──────────────┘   HTTP + WS proxy └──────────────────┘                └─────────┘
```

---

## Project layout

```
flippy/
├─ terminal/      ← Rust CLI (`flippy` binary): local web terminal + tunnel client
│  ├─ Cargo.toml
│  └─ src/
│     ├─ main.rs      — unified CLI dispatcher
│     ├─ terminal.rs  — local HTTP + WS server, PTY, auth
│     ├─ tunnel.rs    — outbound tunnel; forwards HTTP + WS to local
│     ├─ proto.rs     — wire protocol (shared with server/lib/proto.ts)
│     ├─ login.rs
│     └─ config.rs
├─ server/        ← Next.js app deployed to Fly.io
│  ├─ app/
│  │  ├─ page.tsx                 ← landing page
│  │  ├─ api/tunnel/              ← CLI's WS endpoint (bearer token)
│  │  └─ t/[tid]/[[...path]]/     ← public catch-all (HTTP + WS proxy)
│  ├─ lib/           — store.ts (in-memory), proto.ts, html-shim, names
│  ├─ Dockerfile
│  ├─ fly.toml
│  ├─ next.config.ts
│  └─ package.json
├─ public/
│  └─ index.html     ← terminal frontend (embedded into the Rust binary at build)
├─ dist/
├─ build.bat         ← Windows build
└─ build.sh          ← Linux / macOS / Termux build
```

---

## Build the CLI

### Windows

```cmd
build.bat
```
→ `dist\flippy.exe` (~3 MB)

### Linux / Termux / macOS

```sh
# Linux:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Termux: pkg install rust clang
./build.sh
```
→ `dist/flippy` (~3 MB native binary)

---

## Run — local only

```cmd
flippy                        REM port 8090, admin / @dmin1.@
flippy -p 8080 -c u:pw        REM custom port and credentials
```

Open **http://localhost:8090** in a browser. Keyboard: **select = copy, double-click = paste, F11 = fullscreen.**

---

## Deploy the server to Fly.io

### 1. Install flyctl

```sh
# macOS / Linux / Termux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Sign up and launch

```sh
cd server
fly auth signup           # browser opens; signup is free, no card
fly launch --name flippy  # pick region, accept the Dockerfile detected
```

### 3. Set the CLI token

Pick any long random string (treat as a password):

```sh
fly secrets set CLI_TOKEN="<pick-a-long-random-string>"
```

### 4. Deploy

```sh
fly deploy
```

Fly.io prints your production URL — something like `https://flippy.fly.dev`.

---

## Run — worldwide via your Fly.io app

```cmd
flippy login --server https://flippy.fly.dev --token <same CLI_TOKEN>
flippy --tunnel --name myterm
```

Open **https://flippy.fly.dev/t/myterm/** from any phone or laptop → login screen → `admin / @dmin1.@` → your shell.

---

## CLI reference

```
flippy                    # local terminal (default port 8090)
flippy --tunnel [--name <id>]
                          # local terminal + outbound tunnel
flippy stop               # kill the running daemon
flippy status             # daemon + tunnel config
flippy login [--token X]  # save server URL + CLI token
flippy logout             # clear token
```

---

## Terminal controls (in the browser)

| Input | Action |
|---|---|
| Select text | Auto-copies to clipboard |
| Double-click | Paste from clipboard |
| Ctrl+V / Ctrl+Shift+V | Paste |
| Ctrl+Shift+C | Explicit copy |
| Ctrl+C with selection | Copy; without → SIGINT |
| Right-click | Copy selection, or paste if none |
| Middle-click | Paste |
| F11 | Toggle fullscreen |

---

## Tech

- **CLI**: Rust 2021 · `axum` 0.7 · `portable-pty` 0.8 · `tokio-tungstenite` · `reqwest` (rustls) · `rust-embed` · `clap` · `hickory-resolver` (DoH fallback for Termux)
- **Server**: Next.js 15 App Router · `@vercel/functions` `upgradeWebSocket` · in-memory `Map` + `EventEmitter` (no database)
- **Deploy**: Fly.io — single always-on 256 MB container, free tier

## Limitations

- Flashes a reconnect only when the Fly.io machine restarts (deploys, scale events) — otherwise the WS connection stays stable; no 300 s cap like Vercel.
- HTTP(S) + WebSocket only; no raw TCP (SSH, Postgres, etc.) over the tunnel.
- Server is single-instance by default. Scale by running your own cluster, but you'd then need shared state (Redis / Postgres).
