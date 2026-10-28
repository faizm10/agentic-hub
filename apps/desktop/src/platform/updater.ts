/**
 * Signed in-app updates through Tauri's updater plugin.
 *
 * The plugin downloads `latest.json` from the GitHub release, then verifies
 * the bundle's minisign signature against the public key compiled into the
 * app (tauri.conf.json → plugins.updater.pubkey). A missing or invalid
 * signature fails the install; nothing unsigned is ever applied.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { isTauri } from "./native";

type Update = import("@tauri-apps/plugin-updater").Update;

export type UpdaterState =
  | { status: "unsupported" }
  | { status: "idle"; checkedAt?: string }
  | { status: "checking" }
  | { status: "available"; version: string; notes: string; date?: string }
  | { status: "downloading"; version: string; notes: string; downloaded: number; total: number | null }
  | { status: "ready"; version: string }
  | { status: "error"; message: string; version?: string; notes?: string };

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 8_000;

let state: UpdaterState = isTauri() ? { status: "idle" } : { status: "unsupported" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdaterState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getUpdaterState(): UpdaterState {
  return state;
}

export function subscribeUpdater(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turns plugin errors into something a user can act on. */
export function describeUpdateError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const text = raw.toLowerCase();
  if (text.includes("signature")) return "The update's signature could not be verified, so it was not installed. Download the release manually from GitHub.";
  if (text.includes("pubkey") || text.includes("public key")) return "This build has no update signing key configured. Install a release build from GitHub.";
  if (text.includes("404") || text.includes("could not fetch a valid release json")) return "No published release with update information was found yet.";
  if (text.includes("network") || text.includes("dns") || text.includes("connect") || text.includes("timed out") || text.includes("offline"))
    return "Couldn't reach GitHub. Check your connection and try again.";
  if (text.includes("permission") || text.includes("read-only") || text.includes("operation not permitted"))
    return "The app couldn't replace itself. Move Agentic Hub to the Applications folder and try again.";
  return raw ? `Update failed: ${raw.slice(0, 200)}` : "Update failed.";
}

export async function checkForUpdate(): Promise<void> {
  if (!isTauri() || state.status === "checking" || state.status === "downloading" || state.status === "ready") return;
  set({ status: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 20_000 });
    pending = update;
    if (update) set({ status: "available", version: update.version, notes: update.body ?? "", date: update.date });
    else set({ status: "idle", checkedAt: new Date().toISOString() });
  } catch (error) {
    pending = null;
    set({ status: "error", message: describeUpdateError(error) });
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending || (state.status !== "available" && state.status !== "error")) return;
  const update = pending;
  const notes = update.body ?? "";
  set({ status: "downloading", version: update.version, notes, downloaded: 0, total: null });
  try {
    let downloaded = 0;
    let total: number | null = null;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      else if (event.event === "Progress") downloaded += event.data.chunkLength;
      set({ status: "downloading", version: update.version, notes, downloaded, total });
    });
    set({ status: "ready", version: update.version });
  } catch (error) {
    set({ status: "error", message: describeUpdateError(error), version: update.version, notes });
  }
}

/** Stops the runtime cleanly, then relaunches into the installed version. */
export async function restartToUpdate(): Promise<void> {
  await invoke("app_restart");
}

let started = false;
/** Checks shortly after launch and then every few hours. Safe to call more than once. */
export function startAutomaticUpdateChecks() {
  if (started || !isTauri()) return;
  started = true;
  setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}

export function useUpdater(): UpdaterState {
  return useSyncExternalStore(subscribeUpdater, getUpdaterState, getUpdaterState);
}

/** The running app's version: from the bundle in the native app, from the build otherwise. */
export async function appVersion(): Promise<string> {
  if (isTauri()) {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }
  return __APP_VERSION__;
}
