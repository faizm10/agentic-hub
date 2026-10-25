/// Desktop shell entry point.
///
/// The webview gets only the capabilities declared in `capabilities/`:
/// window basics and the native folder picker. There is deliberately no
/// filesystem, shell or HTTP plugin — agent execution and Git access belong
/// to the separate runtime process, not the UI.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Agentic Hub");
}
