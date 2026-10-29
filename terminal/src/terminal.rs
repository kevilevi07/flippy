//! Trupx local web terminal server. This module is a library used by
//! `main.rs`; it has no `fn main()` of its own.

use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::State,
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use rand::{distributions::Alphanumeric, Rng};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::sync::{broadcast, Mutex, RwLock};

/// Max bytes of recent PTY output retained so a reconnecting browser can be
/// caught up to the current screen state. ~256 KB is plenty to reconstruct a
/// full-screen TUI plus a healthy scrollback.
const SCROLLBACK_CAP: usize = 256 * 1024;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../public/"]
struct Assets;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ControlMsg {
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
}

#[derive(Clone)]
struct AppState {
    user: String,
    pass: String,
    shell: String,
    sessions: Arc<RwLock<HashSet<String>>>,
    // The single persistent terminal session (PTY + shell). Kept alive across
    // browser WebSocket reconnects so a dropped socket (e.g. when the Vercel
    // tunnel Function recycles ~every 60s) does NOT kill the user's shell.
    term: Arc<Mutex<Option<Arc<TermSession>>>>,
}

/// A long-lived PTY + shell that outlives individual WebSocket connections.
/// Browser clients attach and detach; the shell keeps running. A scrollback
/// ring buffer lets a reconnecting client repaint the current screen, and a
/// broadcast channel fans live output out to whichever client(s) are attached.
struct TermSession {
    writer: StdMutex<Box<dyn Write + Send>>,
    master: StdMutex<Box<dyn MasterPty + Send>>,
    scroll: Arc<StdMutex<VecDeque<u8>>>,
    tx: broadcast::Sender<Vec<u8>>,
    alive: Arc<AtomicBool>,
    // Held only to keep the child process (and thus the PTY) from being reaped
    // when no client is attached.
    _child: StdMutex<Box<dyn Child + Send + Sync>>,
}

impl TermSession {
    fn spawn(shell: &str) -> std::io::Result<Arc<TermSession>> {
        fn ioerr<E: std::fmt::Display>(e: E) -> std::io::Error {
            std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
        }

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(ioerr)?;

        let mut cmd = CommandBuilder::new(shell);
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            cmd.cwd(home);
        }
        let child = pair.slave.spawn_command(cmd).map_err(ioerr)?;

        let mut reader = pair.master.try_clone_reader().map_err(ioerr)?;
        let writer = pair.master.take_writer().map_err(ioerr)?;

        let (tx, _rx) = broadcast::channel::<Vec<u8>>(1024);
        let scroll = Arc::new(StdMutex::new(VecDeque::<u8>::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // PTY -> scrollback + broadcast. Runs for the whole life of the shell,
        // independent of any attached WebSocket.
        {
            let tx = tx.clone();
            let scroll = scroll.clone();
            let alive = alive.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let chunk = buf[..n].to_vec();
                            if let Ok(mut sb) = scroll.lock() {
                                sb.extend(chunk.iter().copied());
                                while sb.len() > SCROLLBACK_CAP {
                                    sb.pop_front();
                                }
                                // Publish under the scrollback lock so a client
                                // that subscribes under the same lock gets an
                                // exact snapshot/live boundary — no gap, no dup.
                                let _ = tx.send(chunk);
                            }
                        }
                        Err(_) => break,
                    }
                }
                alive.store(false, Ordering::SeqCst);
                let _ = tx.send(Vec::new()); // empty chunk = "shell exited" sentinel
            });
        }

        Ok(Arc::new(TermSession {
            writer: StdMutex::new(writer),
            master: StdMutex::new(pair.master),
            scroll,
            tx,
            alive,
            _child: StdMutex::new(child),
        }))
    }
}

#[derive(Deserialize)]
struct LoginReq {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct LoginResp {
    ok: bool,
}

// ---------- public helpers ----------

pub fn pid_file() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push("trupx.pid");
    p
}

pub fn log_file() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push("trupx.log");
    p
}

pub fn append_log(line: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log_file()) {
        let _ = writeln!(f, "[{}] {}", chrono_now(), line);
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("ts={}", secs)
}

#[cfg(windows)]
pub fn message_box(title: &str, body: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    let t: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let b: Vec<u16> = body.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), b.as_ptr(), t.as_ptr(), MB_OK | MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
pub fn message_box(_: &str, _: &str) {}

pub fn default_shell() -> String {
    if let Ok(s) = std::env::var("TRUPX_SHELL") {
        return s;
    }
    if cfg!(windows) {
        "powershell.exe".into()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".into())
    }
}

/// Returns true if a running instance currently owns the pid file.
pub fn is_running() -> Option<u32> {
    let pid = fs::read_to_string(pid_file())
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())?;
    let mut s = sysinfo::System::new();
    s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    if s.process(sysinfo::Pid::from_u32(pid)).is_some() {
        Some(pid)
    } else {
        let _ = fs::remove_file(pid_file());
        None
    }
}

pub fn kill_running() -> (bool, Option<u32>) {
    let pf = pid_file();
    let Some(pid) = fs::read_to_string(&pf)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
    else {
        return (false, None);
    };
    let mut s = sysinfo::System::new();
    s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let killed = match s.process(sysinfo::Pid::from_u32(pid)) {
        Some(p) => p.kill(),
        None => false,
    };
    let _ = fs::remove_file(&pf);
    (killed, Some(pid))
}

/// Run the terminal HTTP + WS server, bound on the given address. Blocks the
/// caller until Ctrl+C or an error. Reports the actual bound port to the
/// optional `port_tx` channel — useful for `bind_addr`s with port 0 (OS-chosen).
pub async fn serve(
    user: String,
    pass: String,
    shell: String,
    bind_addr: SocketAddr,
    port_tx: Option<tokio::sync::oneshot::Sender<u16>>,
) {
    let state = AppState {
        user,
        pass,
        shell,
        sessions: Arc::new(RwLock::new(HashSet::new())),
        term: Arc::new(Mutex::new(None)),
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/login", post(login_handler))
        .route("/api/logout", post(logout_handler))
        .route("/api/me", get(me_handler))
        .fallback(static_handler)
        .with_state(state);

    match tokio::net::TcpListener::bind(bind_addr).await {
        Ok(listener) => {
            let actual = listener.local_addr().ok();
            append_log(&format!("listening on {:?}", actual));
            if let (Some(a), Some(tx)) = (actual, port_tx) {
                let _ = tx.send(a.port());
            }
            let server = axum::serve(listener, app);
            tokio::select! {
                r = server => { let _ = r; }
                _ = tokio::signal::ctrl_c() => {
                    append_log("received Ctrl+C, shutting down");
                }
            }
            let _ = fs::remove_file(pid_file());
        }
        Err(e) => {
            append_log(&format!("bind failed on {}: {}", bind_addr, e));
            message_box(
                "Trupx",
                &format!(
                    "Cannot bind to {}:\n{}\n\nIs another instance already running? Try `trupx stop`.",
                    bind_addr, e
                ),
            );
            let _ = fs::remove_file(pid_file());
            std::process::exit(1);
        }
    }
}

// ---------- auth ----------

fn new_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(40)
        .map(char::from)
        .collect()
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|p| {
            let p = p.trim();
            p.strip_prefix("trupx_sid=").map(|v| v.to_string())
        })
        .next()
}

async fn authed(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(tok) = cookie_token(headers) else {
        return false;
    };
    state.sessions.read().await.contains(&tok)
}

async fn login_handler(State(st): State<AppState>, Json(body): Json<LoginReq>) -> Response {
    let user_ok = body.username.as_bytes().ct_eq(st.user.as_bytes());
    let pass_ok = body.password.as_bytes().ct_eq(st.pass.as_bytes());
    let ok: bool = (user_ok & pass_ok).into();
    if !ok {
        return (StatusCode::UNAUTHORIZED, Json(LoginResp { ok: false })).into_response();
    }
    let token = new_token();
    st.sessions.write().await.insert(token.clone());
    let cookie = format!(
        "trupx_sid={}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400",
        token
    );
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(LoginResp { ok: true }),
    )
        .into_response()
}

async fn logout_handler(State(st): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(tok) = cookie_token(&headers) {
        st.sessions.write().await.remove(&tok);
    }
    (
        StatusCode::OK,
        [(header::SET_COOKIE, "trupx_sid=; Path=/; Max-Age=0".to_string())],
    )
        .into_response()
}

async fn me_handler(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let ok = authed(&st, &headers).await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "authenticated": ok,
            "user": if ok { st.user.clone() } else { String::new() }
        })),
    )
        .into_response()
}

// ---------- static ----------

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            // No-store so UI updates in a new binary are picked up immediately
            // instead of a stale copy being served from the browser cache.
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
                    (header::CACHE_CONTROL, "no-store, must-revalidate"),
                ],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

// ---------- websocket (auth required) ----------

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if !authed(&st, &headers).await {
        return (StatusCode::UNAUTHORIZED, "login required").into_response();
    }
    let session = match get_or_create_session(&st).await {
        Some(s) => s,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "cannot start shell").into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(socket, session))
}

/// Return the live persistent session, spawning (or respawning, if the shell
/// has exited) one as needed.
async fn get_or_create_session(st: &AppState) -> Option<Arc<TermSession>> {
    let mut slot = st.term.lock().await;
    if let Some(s) = slot.as_ref() {
        if s.alive.load(Ordering::SeqCst) {
            return Some(s.clone());
        }
    }
    match TermSession::spawn(&st.shell) {
        Ok(s) => {
            *slot = Some(s.clone());
            Some(s)
        }
        Err(e) => {
            append_log(&format!("spawn {} failed: {}", st.shell, e));
            None
        }
    }
}

async fn handle_socket(socket: WebSocket, session: Arc<TermSession>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Snapshot the scrollback and subscribe to live output under the same lock
    // the reader publishes with, so the boundary is exact (no missed or
    // duplicated bytes between the replay and the live stream).
    let (snapshot, mut rx) = {
        let sb = session.scroll.lock().unwrap();
        let rx = session.tx.subscribe();
        (sb.iter().copied().collect::<Vec<u8>>(), rx)
    };

    let pump_out = async {
        // Replay recent output first so a reconnecting client repaints the
        // current screen (the browser resets its terminal before this arrives).
        if !snapshot.is_empty() {
            let text = String::from_utf8_lossy(&snapshot).into_owned();
            if ws_tx.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
        loop {
            match rx.recv().await {
                Ok(chunk) => {
                    if chunk.is_empty() {
                        let _ = ws_tx
                            .send(Message::Text(
                                "\r\n\x1b[33m[trupx] shell exited\x1b[0m\r\n".to_string(),
                            ))
                            .await;
                        break;
                    }
                    let text = String::from_utf8_lossy(&chunk).into_owned();
                    if ws_tx.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                // Client fell behind the broadcast buffer; skip ahead and keep
                // streaming rather than tearing the socket down.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        let _ = ws_tx.close().await;
    };

    let session_in = session.clone();
    let pump_in = async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    if let Some(rest) = text.strip_prefix('\u{0001}') {
                        if let Ok(ctl) = serde_json::from_str::<ControlMsg>(rest) {
                            match ctl {
                                ControlMsg::Resize { cols, rows } => {
                                    if let Ok(m) = session_in.master.lock() {
                                        let _ = m.resize(PtySize {
                                            rows,
                                            cols,
                                            pixel_width: 0,
                                            pixel_height: 0,
                                        });
                                    }
                                }
                            }
                        }
                        continue;
                    }
                    if let Ok(mut w) = session_in.writer.lock() {
                        let _ = w.write_all(text.as_bytes());
                        let _ = w.flush();
                    }
                }
                Message::Binary(b) => {
                    if let Ok(mut w) = session_in.writer.lock() {
                        let _ = w.write_all(&b);
                        let _ = w.flush();
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    tokio::select! {
        _ = pump_in => {},
        _ = pump_out => {},
    }
    // Deliberately do NOT kill the shell here. The PTY session persists so a
    // reconnecting browser re-attaches to the same shell (with full scrollback)
    // instead of losing the session every time the socket drops.
}
