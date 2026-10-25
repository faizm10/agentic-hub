//! IPC bridge from the webview to the local runtime.
//!
//! The webview calls these commands instead of opening network connections.
//! Rust attaches the bearer token, so page script never holds it, and only
//! relative runtime API paths are accepted, so the webview cannot use the
//! bridge to reach anything except the loopback runtime.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::supervisor::{RuntimeStatus, Supervisor};

pub struct Bridge {
    pub supervisor: Arc<Supervisor>,
    client: reqwest::Client,
    streams: Mutex<HashMap<u32, JoinHandle<()>>>,
    next_stream: AtomicU32,
}

impl Bridge {
    pub fn new(supervisor: Arc<Supervisor>) -> Self {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP client");
        Self { supervisor, client, streams: Mutex::new(HashMap::new()), next_stream: AtomicU32::new(1) }
    }
}

#[derive(Serialize)]
pub struct BridgeResponse {
    status: u16,
    body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamMessage {
    Open { status: u16 },
    Data { chunk: String },
    End,
    Error { message: String },
}

/// Accepts `/segment/...?...` built from safe characters only.
pub fn valid_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains("..")
        && path.len() <= 2048
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.?=&%:".contains(c))
}

fn unavailable(message: &str) -> BridgeResponse {
    BridgeResponse {
        status: 503,
        body: serde_json::json!({ "error": { "code": "RUNTIME_UNAVAILABLE", "message": message } }).to_string(),
    }
}

async fn unavailable_reason(supervisor: &Supervisor) -> String {
    match supervisor.status().await {
        RuntimeStatus::Starting => "The local runtime is starting…".into(),
        RuntimeStatus::Restarting { detail, .. } => format!("The local runtime stopped and is restarting. {detail}"),
        RuntimeStatus::Failed { detail } => detail,
        RuntimeStatus::Stopped => "The local runtime is stopped.".into(),
        RuntimeStatus::Ready { .. } => "The local runtime is not reachable.".into(),
    }
}

#[tauri::command]
pub async fn runtime_status(bridge: State<'_, Bridge>) -> Result<RuntimeStatus, String> {
    Ok(bridge.supervisor.status().await)
}

#[tauri::command]
pub async fn runtime_restart(bridge: State<'_, Bridge>) -> Result<(), String> {
    bridge.supervisor.request_restart().await;
    Ok(())
}

#[tauri::command]
pub async fn runtime_request(bridge: State<'_, Bridge>, method: String, path: String, body: Option<String>) -> Result<BridgeResponse, String> {
    if !valid_path(&path) {
        return Ok(BridgeResponse { status: 400, body: r#"{"error":{"code":"VALIDATION_ERROR","message":"Invalid runtime path"}}"#.into() });
    }
    let method = match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" => reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?,
        _ => return Ok(BridgeResponse { status: 405, body: r#"{"error":{"code":"VALIDATION_ERROR","message":"Unsupported method"}}"#.into() }),
    };
    let Some(endpoint) = bridge.supervisor.endpoint().await else {
        return Ok(unavailable(&unavailable_reason(&bridge.supervisor).await));
    };
    let mut request = bridge
        .client
        .request(method, format!("{}{}", endpoint.url, path))
        .bearer_auth(&endpoint.token)
        .header("accept", "application/json")
        .timeout(std::time::Duration::from_secs(120));
    if let Some(body) = body {
        request = request.header("content-type", "application/json").body(body);
    }
    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            Ok(BridgeResponse { status, body })
        }
        Err(_) => Ok(unavailable(&unavailable_reason(&bridge.supervisor).await)),
    }
}

/// Opens an SSE stream and forwards its raw text to `channel` until closed.
#[tauri::command]
pub async fn runtime_stream_open(bridge: State<'_, Bridge>, path: String, last_event_id: Option<String>, channel: Channel<StreamMessage>) -> Result<u32, String> {
    if !valid_path(&path) {
        return Err("Invalid runtime path".into());
    }
    let id = bridge.next_stream.fetch_add(1, Ordering::SeqCst);
    let Some(endpoint) = bridge.supervisor.endpoint().await else {
        let _ = channel.send(StreamMessage::Error { message: unavailable_reason(&bridge.supervisor).await });
        return Ok(id);
    };
    let mut request = bridge.client.get(format!("{}{}", endpoint.url, path)).bearer_auth(&endpoint.token).header("accept", "text/event-stream");
    if let Some(last) = last_event_id {
        if last.chars().all(|c| c.is_ascii_digit()) {
            request = request.header("last-event-id", last);
        }
    }
    let task = tokio::spawn(async move {
        match request.send().await {
            Ok(response) => {
                let _ = channel.send(StreamMessage::Open { status: response.status().as_u16() });
                let mut body = response.bytes_stream();
                while let Some(chunk) = body.next().await {
                    match chunk {
                        Ok(bytes) => {
                            if channel.send(StreamMessage::Data { chunk: String::from_utf8_lossy(&bytes).into_owned() }).is_err() {
                                return;
                            }
                        }
                        Err(e) => {
                            let _ = channel.send(StreamMessage::Error { message: e.to_string() });
                            return;
                        }
                    }
                }
                let _ = channel.send(StreamMessage::End);
            }
            Err(e) => {
                let _ = channel.send(StreamMessage::Error { message: e.to_string() });
            }
        }
    });
    let mut streams = bridge.streams.lock().await;
    streams.retain(|_, handle| !handle.is_finished());
    streams.insert(id, task);
    Ok(id)
}

#[tauri::command]
pub async fn runtime_stream_close(bridge: State<'_, Bridge>, id: u32) -> Result<(), String> {
    if let Some(handle) = bridge.streams.lock().await.remove(&id) {
        handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_path;

    #[test]
    fn accepts_runtime_paths_only() {
        assert!(valid_path("/sessions"));
        assert!(valid_path("/sessions/0b5d6a1e-1c4f-4a4e-9d0e-6a8b7f1d2c3e/events?after=12"));
        assert!(valid_path("/providers?refresh"));
        assert!(!valid_path("sessions"));
        assert!(!valid_path("//evil.example.com/x"));
        assert!(!valid_path("/../etc/passwd"));
        assert!(!valid_path("/x#frag"));
        assert!(!valid_path("/x y"));
        assert!(!valid_path("/@evil.example.com"));
    }
}
