use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Wire frames exchanged between CLI and server over the tunnel WebSocket.
/// Kept in sync with `server/lib/proto.ts`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Frame {
    /// Server -> client: tunnel assigned.
    Ready {
        tunnel_id: String,
        public_url: String,
    },

    // ---------- HTTP forwarding ----------
    /// Server -> client: forward this HTTP request to local port.
    Request {
        req_id: String,
        method: String,
        path: String,
        headers: BTreeMap<String, String>,
        /// base64-encoded body
        body_b64: String,
    },
    /// Client -> server: HTTP response for a prior request.
    Response {
        req_id: String,
        status: u16,
        headers: BTreeMap<String, String>,
        body_b64: String,
    },

    // ---------- WebSocket forwarding ----------
    /// Server -> client: open a WebSocket to the local app at `path`.
    /// The client should relay data frames with the same `req_id`.
    WsOpen {
        req_id: String,
        path: String,
        headers: BTreeMap<String, String>,
    },
    /// Either direction: a chunk of WebSocket payload data for `req_id`.
    /// `binary=true` means `data_b64` carries binary; otherwise text (utf-8).
    WsFrame {
        req_id: String,
        #[serde(default)]
        binary: bool,
        data_b64: String,
    },
    /// Either direction: WebSocket closed for `req_id`.
    WsClose {
        req_id: String,
        #[serde(default)]
        code: u16,
    },

    // ---------- Errors / keep-alive ----------
    /// Client -> server (reply to Request/WsOpen) when forwarding failed locally.
    Error { req_id: String, message: String },
    /// Either direction: keep-alive.
    Ping,
    Pong,
}

impl Frame {
    pub fn encode(&self) -> String {
        serde_json::to_string(self).expect("Frame serialization is infallible")
    }

    pub fn decode(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}
