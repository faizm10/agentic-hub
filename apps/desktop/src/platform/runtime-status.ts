import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { isTauri } from "./native";

/** Mirrors `RuntimeStatus` in src-tauri/src/supervisor.rs. */
export type NativeRuntimeStatus =
  | { state: "starting" }
  | { state: "ready"; version: string }
  | { state: "restarting"; detail: string; attempt: number }
  | { state: "failed"; detail: string }
  | { state: "stopped" };

/** Status of the runtime the desktop app supervises. `null` outside the native app. */
export function useNativeRuntimeStatus(): NativeRuntimeStatus | null {
  const [status, setStatus] = useState<NativeRuntimeStatus | null>(isTauri() ? { state: "starting" } : null);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const stop = await listen<NativeRuntimeStatus>("runtime://status", (event) => setStatus(event.payload));
      if (cancelled) return stop();
      unlisten = stop;
      const current = await invoke<NativeRuntimeStatus>("runtime_status");
      if (!cancelled) setStatus(current);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return status;
}

export async function restartNativeRuntime() {
  await invoke("runtime_restart");
}
