//! Agentic Hub desktop app.
//!
//! The webview gets only the capabilities declared in `capabilities/`:
//! window basics, the native folder picker, and the app's own `runtime_*`
//! commands. There is no filesystem, shell or HTTP plugin. Agent execution
//! and Git access happen in the supervised runtime process, and the runtime's
//! bearer token stays in this Rust process.

mod bridge;
mod supervisor;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let entry = app
                .path()
                .resolve("runtime/agentic-hub-runtime.mjs", tauri::path::BaseDirectory::Resource)
                .expect("resource directory");
            let data_dir = std::env::var_os("AGENTIC_HUB_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| app.path().app_data_dir().expect("app data directory").join("runtime"));
            let supervisor = supervisor::Supervisor::new(app.handle().clone(), entry, data_dir);
            app.manage(bridge::Bridge::new(supervisor.clone()));
            tauri::async_runtime::spawn(supervisor.run());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::runtime_status,
            bridge::runtime_restart,
            bridge::runtime_request,
            bridge::runtime_stream_open,
            bridge::runtime_stream_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Agentic Hub");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let bridge = handle.state::<bridge::Bridge>();
            tauri::async_runtime::block_on(bridge.supervisor.shutdown());
        }
    });
}
