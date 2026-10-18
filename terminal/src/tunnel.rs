use crate::config::Config;
use crate::proto::Frame;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::TokioAsyncResolver;
use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::Message;

/// Command sent from the main tunnel loop to a per-session WS forwarder.
enum WsCmd {
    /// A chunk from the public browser to pipe into the local WS.
    Send { binary: bool, data: Vec<u8> },
    /// Public side closed; close local WS and exit.
    Close,
}

/// Resolve a hostname by trying, in order:
///   1. DNS-over-HTTPS to Cloudflare (443/TCP) — survives networks that
///      block UDP/53 or alt DNS servers (Termux on mobile carriers, corporate
///      Wi-Fi, etc.).
///   2. Classic UDP+TCP DNS to Cloudflare + Google.
/// Bypassing the system resolver avoids Android's `EAI_AGAIN` entirely.
async fn resolve_host(host: &str, port: u16) -> Result<Vec<SocketAddr>> {
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, port)]);
    }

    let mut opts = ResolverOpts::default();
    opts.timeout = Duration::from_secs(5);
    opts.attempts = 2;

    // Try DoH first.
    let doh = NameServerConfigGroup::cloudflare_https();
    let doh_cfg = ResolverConfig::from_parts(None, vec![], doh);
    let doh_resolver = TokioAsyncResolver::tokio(doh_cfg, opts.clone());
    if let Ok(lookup) = doh_resolver.lookup_ip(host).await {
        let addrs: Vec<SocketAddr> =
            lookup.iter().map(|ip| SocketAddr::new(ip, port)).collect();
        if !addrs.is_empty() {
            return Ok(addrs);
        }
    }

    // Fall back to classic UDP/TCP DNS.
    let mut ns = NameServerConfigGroup::cloudflare();
    ns.merge(NameServerConfigGroup::google());
    let cfg = ResolverConfig::from_parts(None, vec![], ns);
    let resolver = TokioAsyncResolver::tokio(cfg, opts);
    let lookup = resolver
        .lookup_ip(host)
        .await
        .with_context(|| format!("dns lookup {host}"))?;
    let addrs: Vec<SocketAddr> = lookup.iter().map(|ip| SocketAddr::new(ip, port)).collect();
    if addrs.is_empty() {
        anyhow::bail!("dns lookup {host}: no addresses");
    }
    Ok(addrs)
}

async fn tcp_connect(host: &str, port: u16) -> Result<TcpStream> {
    let mut last_err: Option<anyhow::Error> = None;
    for addr in resolve_host(host, port).await? {
        match TcpStream::connect(addr).await {
            Ok(s) => return Ok(s),
            Err(e) => last_err = Some(anyhow::anyhow!("connect {addr}: {e}")),
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("no addresses")))
}

pub async fn run(
    cfg: &Config,
    local_host: &str,
    local_port: u16,
    requested_name: Option<String>,
) -> Result<()> {
    let server = cfg.require_server()?.to_string();
    let token = cfg.require_token()?.to_string();
    let mut tunnel_id = requested_name.or_else(|| cfg.tunnel_id.clone());

    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    let mut backoff = Duration::from_millis(500);
    loop {
        match one_session(&server, &token, tunnel_id.as_deref(), &http, local_host, local_port)
            .await
        {
            Ok(Some(assigned)) => {
                tunnel_id = Some(assigned);
                backoff = Duration::from_millis(500);
            }
            Ok(None) => {
                backoff = Duration::from_millis(500);
            }
            Err(e) => {
                crate::terminal::append_log(&format!("tunnel: session ended ({}); reconnecting", e));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

/// Returns Ok(Some(tunnel_id)) if a tunnel id was assigned/confirmed this session.
async fn one_session(
    server: &str,
    token: &str,
    reuse_id: Option<&str>,
    http: &reqwest::Client,
    local_host: &str,
    local_port: u16,
) -> Result<Option<String>> {
    let ws_url = {
        let mut u = url::Url::parse(server)?;
        let scheme = if u.scheme() == "https" { "wss" } else { "ws" };
        u.set_scheme(scheme)
            .map_err(|_| anyhow::anyhow!("bad server url scheme"))?;
        u.set_path("/api/tunnel");
        if let Some(id) = reuse_id {
            u.query_pairs_mut().append_pair("name", id);
        }
        u
    };

    let mut req = ws_url.as_str().into_client_request()?;
    req.headers_mut().insert(
        AUTHORIZATION,
        format!("Bearer {token}").parse().expect("valid header"),
    );

    crate::terminal::append_log(&format!("tunnel: connecting {}", ws_url));
    let host = ws_url.host_str().context("ws url has no host")?.to_string();
    let is_tls = ws_url.scheme() == "wss";
    let port = ws_url.port().unwrap_or(if is_tls { 443 } else { 80 });
    let tcp = tcp_connect(&host, port).await.context("tcp connect")?;
    let _ = tcp.set_nodelay(true);
    let (ws, _resp) = match tokio_tungstenite::client_async_tls_with_config(req, tcp, None, None)
        .await
    {
        Ok(v) => v,
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => {
            let status = resp.status();
            let body = resp
                .into_body()
                .and_then(|b| String::from_utf8(b).ok())
                .unwrap_or_default();
            let hint = if status == 400 {
                "  (hint: --name must be 2-32 chars, lowercase a-z, 0-9, hyphens; or omit it)"
            } else if status == 401 {
                "  (hint: run `flippy login` with a valid fly_ token)"
            } else {
                ""
            };
            anyhow::bail!(
                "server rejected handshake: HTTP {}\n  {}{}",
                status,
                body.trim(),
                hint
            );
        }
        Err(e) => return Err(e).context("websocket connect"),
    };
    let (mut tx, mut rx) = ws.split();

    let (out_tx, mut out_rx) = mpsc::channel::<Message>(64);

    // Writer task.
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if tx.send(m).await.is_err() {
                break;
            }
        }
    });

    // Active WebSocket sessions keyed by req_id. Each entry sends control
    // commands into the local-WS forwarder for that session.
    let ws_sessions: Arc<Mutex<HashMap<String, mpsc::Sender<WsCmd>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let mut assigned: Option<String> = None;
    let mut ping_ivl = tokio::time::interval(Duration::from_secs(25));
    ping_ivl.tick().await;

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(msg) = msg else { break };
                let msg = msg?;
                match msg {
                    Message::Text(txt) => {
                        let frame = Frame::decode(&txt).context("decoding frame")?;
                        match frame {
                            Frame::Ready { tunnel_id, public_url } => {
                                crate::terminal::append_log(&format!(
                                    "tunnel READY: {} -> http://{}:{}",
                                    public_url, local_host, local_port
                                ));
                                println!("Forwarding {public_url}  ->  http://{local_host}:{local_port}");
                                assigned = Some(tunnel_id);
                            }
                            Frame::Request { req_id, method, path, headers, body_b64 } => {
                                crate::terminal::append_log(&format!(
                                    "tunnel REQUEST: {} {} (req_id={})", method, path, req_id
                                ));
                                let out_tx = out_tx.clone();
                                let http = http.clone();
                                let host = local_host.to_string();
                                tokio::spawn(async move {
                                    let reply = match forward(&http, &host, local_port, &method, &path, &headers, &body_b64).await {
                                        Ok((status, headers, body)) => {
                                            crate::terminal::append_log(&format!(
                                                "tunnel RESPONSE: {} ({} bytes) req_id={}", status, body.len(), req_id
                                            ));
                                            Frame::Response {
                                                req_id: req_id.clone(),
                                                status,
                                                headers,
                                                body_b64: B64.encode(&body),
                                            }
                                        }
                                        Err(e) => {
                                            crate::terminal::append_log(&format!(
                                                "tunnel FORWARD ERROR: req_id={} err={}", req_id, e
                                            ));
                                            Frame::Error { req_id: req_id.clone(), message: e.to_string() }
                                        }
                                    };
                                    if let Err(e) = out_tx.send(Message::Text(reply.encode())).await {
                                        crate::terminal::append_log(&format!(
                                            "tunnel SEND-REPLY FAILED: req_id={} err={}", req_id, e
                                        ));
                                    }
                                });
                            }
                            Frame::WsOpen { req_id, path, headers } => {
                                let (ws_tx, ws_rx) = mpsc::channel::<WsCmd>(64);
                                ws_sessions.lock().await.insert(req_id.clone(), ws_tx);
                                let out_tx = out_tx.clone();
                                let sessions = ws_sessions.clone();
                                let local_host = local_host.to_string();
                                tokio::spawn(async move {
                                    local_ws_session(
                                        &local_host, local_port, req_id.clone(), path, headers,
                                        ws_rx, out_tx,
                                    ).await;
                                    sessions.lock().await.remove(&req_id);
                                });
                            }
                            Frame::WsFrame { req_id, binary, data_b64 } => {
                                let data = B64.decode(&data_b64).unwrap_or_default();
                                if let Some(sender) = ws_sessions.lock().await.get(&req_id).cloned() {
                                    let _ = sender.send(WsCmd::Send { binary, data }).await;
                                }
                            }
                            Frame::WsClose { req_id, .. } => {
                                if let Some(sender) = ws_sessions.lock().await.remove(&req_id) {
                                    let _ = sender.send(WsCmd::Close).await;
                                }
                            }
                            Frame::Ping => {
                                let _ = out_tx.send(Message::Text(Frame::Pong.encode())).await;
                            }
                            Frame::Pong => {}
                            Frame::Response { .. } | Frame::Error { .. } => {
                                // Not expected from server; ignore.
                            }
                        }
                    }
                    Message::Binary(_) => { /* reserved for future chunk frames */ }
                    Message::Ping(p) => { let _ = out_tx.send(Message::Pong(p)).await; }
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                    Message::Frame(_) => {}
                }
            }
            _ = ping_ivl.tick() => {
                if out_tx.send(Message::Text(Frame::Ping.encode())).await.is_err() {
                    break;
                }
            }
        }
    }

    drop(out_tx);
    let _ = writer.await;
    Ok(assigned)
}

async fn forward(
    http: &reqwest::Client,
    local_host: &str,
    local_port: u16,
    method: &str,
    path: &str,
    headers: &BTreeMap<String, String>,
    body_b64: &str,
) -> Result<(u16, BTreeMap<String, String>, bytes::Bytes)> {
    let url = format!("http://{local_host}:{local_port}{path}");
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let body = B64.decode(body_b64).unwrap_or_default();

    let mut rb = http.request(method, &url);
    for (k, v) in headers {
        let kl = k.to_ascii_lowercase();
        // Drop hop-by-hop + "accept-encoding" so the local app returns the
        // body uncompressed. The gateway (flippy server) needs plain bytes
        // to inject the SPA shim into HTML responses, and reqwest here isn't
        // compiled with gzip/brotli support.
        if matches!(
            kl.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding" | "accept-encoding"
        ) {
            continue;
        }
        rb = rb.header(k, v);
    }
    if !body.is_empty() {
        rb = rb.body(body);
    }

    let r = rb.send().await.map_err(|e| anyhow::anyhow!("local request failed: {e}"))?;
    let status = r.status().as_u16();
    let mut hdrs = BTreeMap::new();
    for (k, v) in r.headers().iter() {
        if let Ok(s) = v.to_str() {
            hdrs.insert(k.as_str().to_string(), s.to_string());
        }
    }
    let body = r.bytes().await?;
    Ok((status, hdrs, body))
}

/// Open a loopback WebSocket to the local app at `ws://host:port<path>` and
/// shuttle frames between it and the tunnel.
async fn local_ws_session(
    local_host: &str,
    local_port: u16,
    req_id: String,
    path: String,
    headers: BTreeMap<String, String>,
    mut cmd_rx: mpsc::Receiver<WsCmd>,
    out_tx: mpsc::Sender<Message>,
) {
    let url = format!("ws://{local_host}:{local_port}{path}");
    let mut req = match url.as_str().into_client_request() {
        Ok(r) => r,
        Err(e) => {
            let _ = out_tx
                .send(Message::Text(
                    Frame::Error { req_id: req_id.clone(), message: format!("bad ws url: {e}") }
                        .encode(),
                ))
                .await;
            return;
        }
    };
    // Forward relevant headers (cookies, auth, user-agent, etc.) so the local
    // app's auth / session logic sees the real request.
    for (k, v) in &headers {
        let kl = k.to_ascii_lowercase();
        if matches!(
            kl.as_str(),
            "host"
                | "connection"
                | "upgrade"
                | "sec-websocket-key"
                | "sec-websocket-version"
                | "sec-websocket-extensions"
                | "sec-websocket-accept"
        ) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(k.as_bytes()),
            v.parse(),
        ) {
            req.headers_mut().insert(name, value);
        }
    }

    let stream = match TcpStream::connect((local_host, local_port)).await {
        Ok(s) => s,
        Err(e) => {
            let _ = out_tx
                .send(Message::Text(
                    Frame::Error { req_id: req_id.clone(), message: format!("local ws tcp: {e}") }
                        .encode(),
                ))
                .await;
            return;
        }
    };
    let _ = stream.set_nodelay(true);
    let (ws, _resp) =
        match tokio_tungstenite::client_async_with_config(req, stream, None).await {
            Ok(v) => v,
            Err(e) => {
                let _ = out_tx
                    .send(Message::Text(
                        Frame::Error { req_id: req_id.clone(), message: format!("local ws upgrade: {e}") }
                            .encode(),
                    ))
                    .await;
                return;
            }
        };
    let (mut local_tx, mut local_rx) = ws.split();

    loop {
        tokio::select! {
            msg = local_rx.next() => {
                match msg {
                    None => break,
                    Some(Err(_)) => break,
                    Some(Ok(Message::Text(t))) => {
                        let frame = Frame::WsFrame {
                            req_id: req_id.clone(),
                            binary: false,
                            data_b64: B64.encode(t.as_bytes()),
                        };
                        if out_tx.send(Message::Text(frame.encode())).await.is_err() { break; }
                    }
                    Some(Ok(Message::Binary(b))) => {
                        let frame = Frame::WsFrame {
                            req_id: req_id.clone(),
                            binary: true,
                            data_b64: B64.encode(&b),
                        };
                        if out_tx.send(Message::Text(frame.encode())).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    None => break,
                    Some(WsCmd::Close) => break,
                    Some(WsCmd::Send { binary, data }) => {
                        let msg = if binary {
                            Message::Binary(data.into())
                        } else {
                            Message::Text(String::from_utf8_lossy(&data).into_owned())
                        };
                        if local_tx.send(msg).await.is_err() { break; }
                    }
                }
            }
        }
    }
    let _ = local_tx.send(Message::Close(None)).await;
    let _ = out_tx
        .send(Message::Text(Frame::WsClose { req_id, code: 1000 }.encode()))
        .await;
}
