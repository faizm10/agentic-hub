/**
 * Narrow bridge to native capabilities. The frontend only gets what is
 * listed in src-tauri/capabilities; nothing here grants filesystem or shell
 * access — the folder picker returns a path that is handed to the runtime.
 */
export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type PickResult = { kind: "picked"; path: string } | { kind: "cancelled" } | { kind: "unsupported" };

export async function pickRepositoryFolder(): Promise<PickResult> {
  if (!isTauri()) return { kind: "unsupported" };
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "Open a Git repository" });
  if (typeof selected === "string") return { kind: "picked", path: selected };
  return { kind: "cancelled" };
}

export const platform = {
  isMac: typeof navigator !== "undefined" && /Mac/.test(navigator.platform || navigator.userAgent),
};
