//! Trupx local web terminal server. This module is a library used by
//! `main.rs`; it has no `fn main()` of its own.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::State,
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use rand::{distributions::Alphanumeric, Rng};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::sync::{mpsc, Mutex, RwLock};

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

/// Run the terminal HTTP + WS server in the current task. Blocks the caller
/// until Ctrl+C or an error.
pub async fn serve(user: String, pass: String, shell: String, port: u16) {
    let state = AppState {
        user,
        pass,
        shell,
        sessions: Arc::new(RwLock::new(HashSet::new())),
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/login", post(login_handler))
        .route("/api/logout", post(logout_handler))
        .route("/api/me", get(me_handler))
        .fallback(static_handler)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            append_log(&format!("listening on {}", addr));
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
            append_log(&format!("bind failed on port {}: {}", port, e));
            message_box(
                "Trupx",
                &format!(
                    "Cannot bind to port {}:\n{}\n\nIs another instance already running? Try `trupx stop`.",
                    port, e
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
            (
                [(header::CONTENT_TYPE, mime.as_ref())],
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
    let shell = st.shell.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, shell))
}

async fn handle_socket(socket: WebSocket, shell: String) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            append_log(&format!("openpty failed: {}", e));
            return;
        }
    };

    let mut cmd = CommandBuilder::new(&shell);
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        cmd.cwd(home);
    }

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            append_log(&format!("spawn {} failed: {}", shell, e));
            let _ = ws_tx
                .send(Message::Text(format!(
                    "\r\n[trupx] cannot spawn {}: {}\r\n",
                    shell, e
                )))
                .await;
            return;
        }
    };

    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let (pty_out_tx, mut pty_out_rx) = mpsc::channel::<Vec<u8>>(32);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if pty_out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let writer = Arc::new(Mutex::new(pair.master.take_writer().expect("take writer")));
    let master = Arc::new(Mutex::new(pair.master));

    let pump_out = async {
        while let Some(chunk) = pty_out_rx.recv().await {
            let text = String::from_utf8_lossy(&chunk).into_owned();
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        let _ = ws_tx.close().await;
    };

    let writer_cloned = writer.clone();
    let master_cloned = master.clone();
    let pump_in = async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    if let Some(rest) = text.strip_prefix('\u{0001}') {
                        if let Ok(ctl) = serde_json::from_str::<ControlMsg>(rest) {
                            match ctl {
                                ControlMsg::Resize { cols, rows } => {
                                    let m = master_cloned.lock().await;
                                    let _ = m.resize(PtySize {
                                        rows,
                                        cols,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    });
                                }
                            }
                        }
                        continue;
                    }
                    let mut w = writer_cloned.lock().await;
                    let _ = w.write_all(text.as_bytes());
                    let _ = w.flush();
                }
                Message::Binary(b) => {
                    let mut w = writer_cloned.lock().await;
                    let _ = w.write_all(&b);
                    let _ = w.flush();
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
    let _ = child.kill();
}
