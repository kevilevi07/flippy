# Flippy

**A web terminal, with a self-hosted tunnel for worldwide access — all in one tiny binary.**

- `flippy` opens a live, browser-based terminal on your machine (ttyd-style)
- `flippy --tunnel` exposes that terminal to the world through *your* Vercel app (no ngrok, no middleman)
- **One ~3 MB native binary.** Windows, Linux, macOS, Termux (Android).

```
┌──────────────┐    outbound WS    ┌───────────────────┐    HTTPS/WSS   ┌─────────┐
│ flippy.exe   │  ──────────────▶  │  flippy on Vercel │  ◀───────────  │ browser │
│ (your PC)    │  ◀──────────────  │  (your account)   │                │ anywhere│
└──────────────┘   HTTP/WS proxy   └───────────────────┘                └─────────┘
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
├─ server/        ← Next.js app deployed to Vercel: public ingress + dashboard
│  ├─ app/
│  │  ├─ page.tsx                 ← landing page
│  │  ├─ login/ signup/ dashboard/ admin/ download/
│  │  ├─ api/tunnel/              ← WS endpoint for the CLI
│  │  ├─ api/auth/* api/me/ api/admin/*
│  │  └─ t/[tid]/[[...path]]/     ← public catch-all (HTTP + WS)
│  ├─ lib/           — proto.ts, redis.ts, auth.ts, html-shim, …
│  ├─ middleware.ts
│  └─ vercel.ts
├─ public/
│  └─ index.html     ← terminal frontend (embedded into the Rust binary at build)
├─ dist/             ← built binaries land here
├─ build.bat         ← Windows build
└─ build.sh          ← Linux / macOS / Termux build
```

---

## Build

### Windows

```cmd
build.bat
```
→ `dist\flippy.exe` (~3 MB)

### Linux / Termux (Android) / macOS

```sh
# Linux:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Termux: pkg install rust clang
./build.sh
```
→ `dist/flippy` (~3 MB native binary)

---

## Run — local only

```cmd
flippy                        REM port 8090, login admin / @dmin1.@
flippy -p 8080 -c u:pw        REM custom port and credentials
```
Open **http://localhost:8090** in a browser.

**Terminal controls:** select to copy · double-click to paste · Ctrl+Shift+C/V · right-click paste · F11 fullscreen.

---

## Run — worldwide via your Vercel

### 1. Deploy the server (once)

```sh
cd server
npm install
vercel link                     # create a new project called "flippy"
vercel integration add upstash-redis
vercel env add FLIPPY_PUBLIC_URL production     # https://flippy-<yours>.vercel.app
vercel env add ADMIN_USERNAME production
vercel env add ADMIN_PASSWORD production
vercel deploy --prod
```

### 2. Create an account & grab a token

Open your deployed URL → **Sign up** → the dashboard shows a `fly_...` token.

### 3. Point the CLI at the server & tunnel

```cmd
flippy login --token fly_your_token_here --server https://flippy-xxx.vercel.app
flippy --tunnel --name myterm
```

Open **https://flippy-xxx.vercel.app/t/myterm/** from any phone or laptop in the world. Login with your terminal credentials. You're now in your home shell.

---

## CLI reference

```
flippy                    # local terminal (default port 8090)
flippy --tunnel [--name <id>]
                          # local terminal + outbound tunnel
flippy stop               # kill the running daemon
flippy status             # daemon + tunnel config
flippy login [--token X]  # save server URL + wbr-style token
flippy logout             # clear token
```

---

## Tech

- **CLI**: Rust 2021, `axum` 0.7, `portable-pty` 0.8, `tokio-tungstenite`, `reqwest` (rustls), `rust-embed`, `clap`, `hickory-resolver` (DoH fallback for Termux)
- **Server**: Next.js 15 App Router, `@vercel/functions` `upgradeWebSocket`, `ioredis` on Upstash Redis
- **Transport**: single outbound WebSocket from the CLI; multiplexed JSON frames (`request`/`response`/`ws_open`/`ws_frame`/`ws_close`/`ping`) over Redis pub/sub

## Limitations

- **WebSocket session lifespan**: capped by Vercel Function duration (Hobby: 300s, Pro: 800s). The CLI auto-reconnects with the same tunnel id, so public URLs are stable, but a *browser* WebSocket into the tunnel disconnects at that boundary. The frontend reconnects automatically — the shell survives.
- Request/response body cap: 4.5 MB (Vercel platform limit).
- No raw TCP — only HTTP(S) + WebSocket over the tunnel.
