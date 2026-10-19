# Trupx

**A web terminal reachable from anywhere via your own Vercel app.**
One tiny native binary — download, run, done. ngrok-style.

- `trupx` opens a live web-terminal on your machine and tunnels it to a public URL
- No local port exposure. No third-party tunnel service. Your Vercel app is the entire backend.
- Prebuilt binaries for **Windows x64**, **Linux x64**, **Linux arm64**, **Termux (Android arm64)**
- **UPX-compressed** to ~1.3–1.5 MB each

```
┌──────────────┐   outbound WSS    ┌──────────────────┐   HTTPS/WSS    ┌─────────┐
│  trupx       │ ────────────────▶ │  Vercel app      │ ◀───────────── │ browser │
│  (your box)  │ ◀──────────────── │  (your account)  │                │ anywhere│
└──────────────┘   HTTP + WS proxy └──────────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ Neon        │
                                    │ (pub/sub)   │
                                    └─────────────┘
```

---

## Install (one command)

Open **https://trupx.vercel.app** → log in → the **Install trupx** card has copy-ready commands for every platform. Here are the one-liners:

### Windows

```powershell
# Install only (runs until reboot)
iwr https://trupx.vercel.app/install.ps1 -useb | iex

# Install + auto-start at every login (Task Scheduler)
iwr https://trupx.vercel.app/setup.ps1 -useb | iex
```

### Linux / Termux

```sh
# Install only (runs until reboot)
curl -fsSL https://trupx.vercel.app/install.sh | sh

# Install + auto-start at every boot (systemd on Linux, Termux:Boot on Android)
curl -fsSL https://trupx.vercel.app/setup.sh | sh
```

All scripts:
- Download the right binary for your OS/arch
- Install to `~/.trupx/bin/` (or `%USERPROFILE%\.trupx\bin\`)
- Add to PATH (cmd AutoRun / shell rc / WindowsApps copy)
- Start a tunnel in the background
- `trupx uninstall` cleanly reverses everything

### Grab the raw binary (no install)

```sh
curl -fsSL https://trupx.vercel.app/trupx-linux-x64      -o trupx && chmod +x trupx && ./trupx
curl -fsSL https://trupx.vercel.app/trupx-linux-aarch64  -o trupx && chmod +x trupx && ./trupx
curl -fsSL https://trupx.vercel.app/trupx-termux-aarch64 -o trupx && chmod +x trupx && ./trupx
```

Downloads one file. Running `./trupx` self-installs to `~/.trupx/bin/`, patches shell rc, and detaches to background.

---

## CLI reference

```
trupx                    Start a tunnel. URL slug is random, hostname goes to the dashboard.
trupx <name>             Start a tunnel at /<name>/. Server adds a suffix if taken.
trupx stop               Stop the running daemon.
trupx status             Daemon + tunnel config.
trupx login              Save server URL + CLI token (if the server requires auth).
trupx logout             Clear saved token.
trupx uninstall          Password-prompt (admin: @dmin1.@), then fully remove trupx:
                           binary, config, PATH entries, shim, scheduled task
                           / systemd service / Termux:Boot script.
```

---

## Admin dashboard

**https://trupx.vercel.app** → sign in as `admin` → claymorphism dashboard:

- **Live sessions** count (tunnels currently connected)
- **Open tunnels** table — hostname, URL slug, clickable public URL
- **Install trupx** section — copy-button one-liners for every OS/mode
- One-click **Log out**

Credentials come from your Vercel env vars: `ADMIN_USERNAME`, `ADMIN_PASSWORD`.

---

## Project layout

```
trupx/
├─ terminal/              Rust CLI
│  ├─ Cargo.toml
│  └─ src/
│     ├─ main.rs          Unified CLI (start, stop, status, login, uninstall, daemon)
│     ├─ terminal.rs      Local axum HTTP+WS server, PTY via portable-pty
│     ├─ tunnel.rs        Outbound tunnel: HTTP+WS forwarding + hostname upload
│     ├─ proto.rs         Wire protocol (JSON frames — mirrored in server/lib/proto.ts)
│     ├─ login.rs
│     └─ config.rs
│
├─ server/                Next.js 15 app → Vercel
│  ├─ app/
│  │  ├─ page.tsx                     Login page (clay card)
│  │  ├─ dashboard/                   Admin dashboard
│  │  │  ├─ page.tsx
│  │  │  ├─ CopyCommand.tsx
│  │  │  └─ LogoutButton.tsx
│  │  ├─ api/admin/{login,logout}/    Env-based admin auth (HMAC-signed cookie)
│  │  ├─ api/tunnel/                  CLI's WS endpoint (no auth; name clash → suffix)
│  │  └─ [tid]/[[...path]]/           Public catch-all: HTTP + WebSocket proxy
│  ├─ lib/
│  │  ├─ db.ts                        Neon Postgres kv/sets/pubsub (poll-based)
│  │  ├─ tunnels.ts                   Live-tunnels listing for dashboard
│  │  ├─ admin.ts                     Admin session (stateless signed cookie)
│  │  ├─ proto.ts                     TypeScript Frame type (matches terminal/src/proto.rs)
│  │  ├─ html-shim.ts                 Injects path-prefix patcher into tunneled HTML
│  │  └─ names.ts                     Tunnel-name validation + reserved words
│  ├─ public/
│  │  ├─ trupx-windows-x64.exe
│  │  ├─ trupx-linux-x64
│  │  ├─ trupx-linux-aarch64
│  │  ├─ trupx-termux-aarch64
│  │  ├─ install.ps1 / install.sh
│  │  └─ setup.ps1  / setup.sh
│  ├─ vercel.ts
│  └─ next.config.ts
│
├─ public/
│  └─ index.html          Terminal UI (xterm.js) — embedded in each Rust binary via rust-embed
│
├─ dist/trupx.exe         Local Windows build output
├─ build.bat / build.sh   Dev build scripts (Rust)
└─ .github/workflows/     Optional CI builds
```

---

## Build from source

### Windows

```cmd
build.bat
```
Output: `dist\trupx.exe`

### Linux / macOS / Termux

```sh
# One-time: Rust toolchain
# Linux:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Termux: pkg install rust clang
./build.sh
```
Output: `dist/trupx`

### Cross-compile Linux + Termux from Windows (with zig)

```cmd
pip install --user ziglang
cargo install cargo-zigbuild
rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu aarch64-unknown-linux-musl
cd terminal
cargo zigbuild --release --target x86_64-unknown-linux-gnu
cargo zigbuild --release --target aarch64-unknown-linux-gnu
cargo zigbuild --release --target aarch64-unknown-linux-musl    REM Termux
```

Optional UPX compress for ~60% smaller binaries:
```
upx --best --lzma trupx-*
```

---

## Deploy your own server (Vercel)

1. **Create the project**
   ```sh
   cd server
   vercel link
   ```

2. **Add Neon Postgres** (free tier via Vercel Marketplace, no card)
   ```sh
   vercel integration add neon
   ```

3. **Set env vars**
   ```sh
   vercel env add TRUPX_PUBLIC_URL   production   # https://your-app.vercel.app
   vercel env add ADMIN_USERNAME     production   # admin
   vercel env add ADMIN_PASSWORD     production   # strong password
   ```

4. **Deploy**
   ```sh
   vercel deploy --prod
   ```

That's it. Open the deployment URL, log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, grab the install one-liners from the dashboard.

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

## Checking status

### Windows

```powershell
# Is the daemon running?
Get-Process trupx -ErrorAction SilentlyContinue

# Scheduled task (set up by setup.ps1)
Get-ScheduledTaskInfo -TaskName trupx-tunnel
```

### Linux / macOS

```sh
systemctl --user status trupx       # If set up by setup.sh
pgrep -a trupx                      # Any instance?
trupx status
```

### Termux

```sh
pgrep -a trupx
ls ~/.termux/boot/trupx             # Set up by setup.sh
```

### Any OS

The admin dashboard at `https://trupx.vercel.app/dashboard` shows every live hostname in real time.

---

## How it works

```
┌─────────── browser ───────────┐          ┌───── your trupx binary ─────┐
│  GET /myterm/                 │          │  axum terminal server       │
│  WS  /myterm/ws               │          │  (bound 127.0.0.1:random)   │
└───────────────┬───────────────┘          └──────────┬──────────────────┘
                │ HTTPS/WSS                           ▲ loopback
                ▼                                     │
┌──────────── Vercel app ─────────────────────────────┼───────────────────┐
│                                                     │                   │
│  /[tid]/[[...path]]/route.ts                        │                   │
│    ├─ HTTP: req → msg_queue INSERT (chan=req:<tid>) │                   │
│    │       response ← msg_queue SELECT (chan=resp:) │                   │
│    │                                                │                   │
│    └─ WS:  on upgrade, allocate req_id              │                   │
│            frames ↔ msg_queue (ws:<tid>:<req_id>)   │                   │
│                                                     │                   │
│  /api/tunnel/route.ts (long-lived, 300s on Hobby)   │                   │
│    ↕  CLI's outbound WebSocket                      │                   │
│    polls msg_queue for req:<tid>, forwards frames ──┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                       ┌─────────────────────┐
                       │ Neon Postgres       │
                       │ msg_queue + kv      │
                       │ (poll @ 5-25 ms)    │
                       └─────────────────────┘
```

- **No local port is exposed.** With `--tunnel` (the default), trupx binds `127.0.0.1` on a random OS-chosen port — not reachable from LAN or the user themselves. Only the tunnel forwarder (same process) connects over loopback.
- **Hostname goes to the dashboard, URL slug is random.** Prevents hostname leaking into public URLs.
- **No GitHub URLs** in any user-facing flow — binaries live at `trupx.vercel.app/trupx-<os>-<arch>`.

---

## Tech

- **CLI**: Rust 2021 · `axum` 0.7 · `portable-pty` 0.8 · `tokio-tungstenite` · `reqwest` (rustls) · `rust-embed` · `clap` · `hickory-resolver` (DoH fallback for Termux) · `rpassword` · UPX compression
- **Server**: Next.js 15 App Router · `@vercel/functions` `upgradeWebSocket` · `@neondatabase/serverless` · poll-based pub/sub for cross-instance delivery
- **UI**: Dark claymorphism — soft dual shadows, lavender/green accent, responsive
- **Deploy**: Vercel + Vercel Marketplace Neon Postgres (free tier)

## Limitations

- **Tunnel WebSocket resets every 300s** on Vercel Hobby. The CLI auto-reconnects with the same tunnel id; the browser's WS reconnects transparently. Shell processes survive.
- **4.5 MB** request/response body cap (Vercel platform limit).
- **HTTP(S) + WebSocket only** over the tunnel — no raw TCP.
- **Linux systemd** auto-start requires `loginctl enable-linger $USER` to survive logout — setup.sh attempts it best-effort.
- **Termux boot** auto-start requires the free Termux:Boot app from F-Droid.
