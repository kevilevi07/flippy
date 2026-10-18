# Flippy

**A web terminal, reachable from anywhere via your own Vercel app.**

- `flippy` opens a live browser terminal on your machine (ttyd-style)
- `flippy --tunnel` exposes that terminal to the world through *your* Vercel app
- **One ~3 MB native binary.** Windows, Linux, macOS, Termux (Android).
- Uses Vercel's built-in **Neon Postgres** (free tier via Marketplace, no card).

```
┌──────────────┐    outbound WS    ┌──────────────────┐    HTTPS/WSS   ┌─────────┐
│ flippy.exe   │ ────────────────▶ │  Vercel app      │ ◀───────────── │ browser │
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
├─ server/        ← Next.js app deployed to Vercel
│  ├─ app/
│  │  ├─ page.tsx                 ← landing page
│  │  ├─ api/tunnel/              ← CLI's WS endpoint (bearer token)
│  │  └─ t/[tid]/[[...path]]/     ← public catch-all (HTTP + WS proxy)
│  ├─ lib/           — db.ts (Neon-backed), proto.ts, html-shim, names
│  ├─ vercel.ts
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

## Deploy the server to Vercel

### 1. Install Vercel CLI

```sh
npm i -g vercel
```

### 2. Create the project

```sh
cd server
vercel link           # create project `flippy` under your account
```

### 3. Add Neon Postgres (free tier)

```sh
vercel integration add neon
```

Click through the browser flow → pick **Free** → done. Vercel sets `DATABASE_URL`
automatically on the project.

### 4. Set the CLI token

```sh
vercel env add CLI_TOKEN production
# paste a long random string when prompted (treat as a password)
```

### 5. Deploy

```sh
vercel deploy --prod
```

Vercel prints your production URL — something like `https://flippy-abc.vercel.app`.

---

## Run — worldwide via your Vercel app

```cmd
flippy login --server https://flippy-abc.vercel.app --token <same CLI_TOKEN>
flippy --tunnel --name myterm
```

Open **https://flippy-abc.vercel.app/t/myterm/** from any phone or laptop → login screen → `admin / @dmin1.@` → your shell.

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
- **Server**: Next.js 15 App Router · `@vercel/functions` `upgradeWebSocket` · `@neondatabase/serverless` with Postgres `LISTEN/NOTIFY` for pub/sub
- **Deploy**: Vercel + Vercel Marketplace Neon Postgres (free tier)

## Limitations

- WebSocket session capped by Vercel Function duration (Hobby: 300s). The CLI reconnects with the same tunnel id automatically; the browser's WS reconnects transparently. The underlying shell survives.
- Request/response body cap: 4.5 MB (Vercel platform limit).
- HTTP(S) + WebSocket only; no raw TCP (SSH, Postgres, etc.) over the tunnel.
