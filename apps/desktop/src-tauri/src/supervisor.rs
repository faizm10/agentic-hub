//! Native supervisor for the Node.js coding-agent runtime.
//!
//! The app launches the bundled runtime as a child process bound to a random
//! loopback port, reads the per-start bearer token from the owner-only file
//! the runtime writes, and keeps that token in this process. The webview never
//! sees it: every request goes through the `runtime_*` commands in `bridge.rs`.
//!
//! If the runtime exits unexpectedly it is restarted with backoff, and the
//! webview is told through the `runtime://status` event. On app exit the
//! runtime gets SIGTERM so it can mark active turns cancelled and remove its
//! token and lock files.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, Notify, RwLock};

const MIN_NODE_MAJOR: u32 = 22;
const MIN_NODE_MINOR: u32 = 13;
const READY_PREFIX: &str = "AGENTIC_HUB_READY ";
const STDERR_LINES: usize = 20;

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum RuntimeStatus {
    Starting,
    Ready { version: String },
    /// The runtime exited unexpectedly; a restart is scheduled.
    Restarting { detail: String, attempt: u32 },
    /// The runtime cannot start until the user fixes something (e.g. Node.js missing).
    Failed { detail: String },
    Stopped,
}

#[derive(Clone)]
pub struct Endpoint {
    pub url: String,
    pub token: String,
}

#[derive(Deserialize)]
struct ReadyLine {
    url: String,
    #[serde(rename = "tokenFile")]
    token_file: String,
    version: String,
}

pub struct Supervisor {
    app: AppHandle,
    entry: PathBuf,
    data_dir: PathBuf,
    status: RwLock<RuntimeStatus>,
    endpoint: RwLock<Option<Endpoint>>,
    child: Mutex<Option<Child>>,
    shutting_down: std::sync::atomic::AtomicBool,
    restart: Notify,
}

impl Supervisor {
    pub fn new(app: AppHandle, entry: PathBuf, data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            app,
            entry,
            data_dir,
            status: RwLock::new(RuntimeStatus::Starting),
            endpoint: RwLock::new(None),
            child: Mutex::new(None),
            shutting_down: std::sync::atomic::AtomicBool::new(false),
            restart: Notify::new(),
        })
    }

    pub async fn status(&self) -> RuntimeStatus {
        self.status.read().await.clone()
    }

    pub async fn endpoint(&self) -> Option<Endpoint> {
        self.endpoint.read().await.clone()
    }

    async fn set_status(&self, status: RuntimeStatus) {
        *self.status.write().await = status.clone();
        let _ = self.app.emit("runtime://status", status);
    }

    /// Ask the run loop to restart now (e.g. after the user installed Node.js).
    pub async fn request_restart(&self) {
        if let Some(child) = self.child.lock().await.as_mut() {
            terminate(child).await;
        }
        self.restart.notify_one();
    }

    /// Supervises the runtime for the life of the app.
    pub async fn run(self: Arc<Self>) {
        let mut attempt: u32 = 0;
        loop {
            if self.is_shutting_down() {
                return;
            }
            self.set_status(RuntimeStatus::Starting).await;
            let started = Instant::now();
            let outcome = self.clone().launch_once().await;
            *self.endpoint.write().await = None;
            if self.is_shutting_down() {
                self.set_status(RuntimeStatus::Stopped).await;
                return;
            }
            let detail = match outcome {
                Err(LaunchError::Fatal(detail)) => {
                    // Nothing will change until the user acts; wait for an explicit retry.
                    self.set_status(RuntimeStatus::Failed { detail }).await;
                    self.restart.notified().await;
                    attempt = 0;
                    continue;
                }
                Err(LaunchError::Exited(detail)) => detail,
                Ok(()) => "The runtime exited.".to_string(),
            };
            // A runtime that ran for a while gets a fresh backoff.
            if started.elapsed() > Duration::from_secs(60) {
                attempt = 0;
            }
            attempt += 1;
            self.set_status(RuntimeStatus::Restarting { detail, attempt }).await;
            let delay = Duration::from_secs(u64::from(2u32.saturating_pow(attempt.min(5) - 1)).min(30));
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = self.restart.notified() => {}
            }
        }
    }

    fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(std::sync::atomic::Ordering::SeqCst)
    }

    async fn launch_once(self: Arc<Self>) -> Result<(), LaunchError> {
        if !self.entry.exists() {
            return Err(LaunchError::Fatal(format!("The runtime bundle is missing at {}. Reinstall Agentic Hub.", self.entry.display())));
        }
        let env_path = login_shell_path().await;
        let node = find_node(&env_path).await?;
        std::fs::create_dir_all(&self.data_dir).map_err(|e| LaunchError::Fatal(format!("Could not create {}: {e}", self.data_dir.display())))?;

        let mut command = Command::new(&node);
        command
            .arg("--disable-warning=ExperimentalWarning")
            .arg(&self.entry)
            .env("PATH", &env_path)
            .env("AGENTIC_HUB_PORT", "0")
            .env("AGENTIC_HUB_DATA_DIR", &self.data_dir)
            .env("AGENTIC_HUB_EXIT_WITH_PARENT", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|e| LaunchError::Fatal(format!("Could not start Node.js at {node}: {e}")))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        *self.child.lock().await = Some(child);

        let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
        let stderr_tail = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut tail = stderr_tail.lock().await;
                if tail.len() == STDERR_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        });

        let this = self.clone();
        let reader = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(json) = line.strip_prefix(READY_PREFIX) {
                    if let Ok(ready) = serde_json::from_str::<ReadyLine>(json) {
                        match std::fs::read_to_string(&ready.token_file) {
                            Ok(token) => {
                                *this.endpoint.write().await = Some(Endpoint { url: ready.url, token: token.trim().to_string() });
                                this.set_status(RuntimeStatus::Ready { version: ready.version }).await;
                            }
                            Err(e) => {
                                this.set_status(RuntimeStatus::Restarting { detail: format!("Could not read the runtime token: {e}"), attempt: 0 }).await;
                            }
                        }
                    }
                }
            }
        });

        // Wait for exit without holding the lock, so shutdown can signal the child.
        let exit = loop {
            {
                let mut guard = self.child.lock().await;
                match guard.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(Some(status))) => {
                        guard.take();
                        break status;
                    }
                    Some(Ok(None)) => {}
                    Some(Err(e)) => {
                        guard.take();
                        return Err(LaunchError::Exited(format!("Lost track of the runtime: {e}")));
                    }
                    None => return Err(LaunchError::Exited("The runtime was stopped.".into())),
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        reader.abort();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let tail: Vec<String> = tail.lock().await.iter().cloned().collect();
        let last = tail.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_default();
        if exit.code() == Some(3) {
            return Err(LaunchError::Fatal(if last.is_empty() { "Another Agentic Hub runtime is already using this data folder.".into() } else { last }));
        }
        Err(LaunchError::Exited(if last.is_empty() { format!("The runtime exited ({exit}).") } else { format!("The runtime exited ({exit}): {last}") }))
    }

    /// Graceful stop: SIGTERM, then SIGKILL after a grace period.
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, std::sync::atomic::Ordering::SeqCst);
        self.restart.notify_one();
        if let Some(mut child) = self.child.lock().await.take() {
            terminate(&mut child).await;
        }
    }
}

enum LaunchError {
    Fatal(String),
    Exited(String),
}

async fn terminate(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: sending a signal to our own child process id.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        if tokio::time::timeout(Duration::from_secs(5), child.wait()).await.is_ok() {
            return;
        }
    }
    let _ = child.kill().await;
}

/// Apps launched from Finder get a minimal PATH. The user's login shell knows
/// where Node.js and the `codex`, `claude` and `muse` CLIs are installed.
async fn login_shell_path() -> String {
    let fallback = std::env::var("PATH").unwrap_or_default();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(&shell).args(["-l", "-c", "printf '%s' \"$PATH\""]).stdin(Stdio::null()).stderr(Stdio::null()).output(),
    )
    .await;
    let mut path = match output {
        Ok(Ok(out)) if out.status.success() && !out.stdout.is_empty() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => fallback,
    };
    // Common install locations, in case the shell profile doesn't set them.
    for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
        if !path.split(':').any(|p| p == extra) {
            path.push(':');
            path.push_str(extra);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        for extra in [".local/bin", ".volta/bin", ".bun/bin"] {
            let dir = format!("{home}/{extra}");
            if !path.split(':').any(|p| p == dir) {
                path.push(':');
                path.push_str(&dir);
            }
        }
    }
    path
}

async fn find_node(path: &str) -> Result<String, LaunchError> {
    let candidate = match std::env::var("AGENTIC_HUB_NODE") {
        Ok(explicit) if !explicit.is_empty() => Some(explicit),
        _ => path.split(':').map(|dir| format!("{dir}/node")).find(|p| std::path::Path::new(p).is_file()),
    };
    let node = candidate.ok_or_else(|| LaunchError::Fatal("Node.js 22.13 or newer is required. Install it from https://nodejs.org, then choose Retry.".into()))?;
    let output = Command::new(&node).arg("--version").output().await.map_err(|e| LaunchError::Fatal(format!("Could not run {node}: {e}")))?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !node_version_ok(&version) {
        return Err(LaunchError::Fatal(format!("Agentic Hub needs Node.js 22.13 or newer; found {version} at {node}. Update Node.js, then choose Retry.")));
    }
    Ok(node)
}

pub fn node_version_ok(version: &str) -> bool {
    let mut parts = version.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let (major, minor) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    major > MIN_NODE_MAJOR || (major == MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)
}

#[cfg(test)]
mod tests {
    use super::node_version_ok;

    #[test]
    fn checks_minimum_node_version() {
        assert!(node_version_ok("v22.13.0"));
        assert!(node_version_ok("v22.22.2"));
        assert!(node_version_ok("v24.1.0"));
        assert!(!node_version_ok("v22.12.9"));
        assert!(!node_version_ok("v20.19.0"));
        assert!(!node_version_ok("garbage"));
    }
}
