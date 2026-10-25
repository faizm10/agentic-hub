"use client";

import { useEffect, useRef } from "react";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Shortcut spec like "mod+k", "mod+shift+n", "escape". `mod` is ⌘ on macOS
 * and Ctrl elsewhere.
 */
export function matchesShortcut(event: KeyboardEvent, spec: string) {
  const parts = spec.toLowerCase().split("+");
  const key = parts.pop();
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (wantMod !== mod) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  const pressed = event.key.toLowerCase();
  return pressed === key || event.code.toLowerCase() === `key${key}` || event.code.toLowerCase() === `digit${key}`;
}

export function formatShortcut(spec: string) {
  return spec.split("+").map((part) => {
    switch (part.toLowerCase()) {
      case "mod":
        return isMac ? "⌘" : "Ctrl";
      case "shift":
        return isMac ? "⇧" : "Shift";
      case "alt":
        return isMac ? "⌥" : "Alt";
      case "enter":
        return "↵";
      case "escape":
        return "Esc";
      case "backslash":
        return "\\";
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
}

export interface ShortcutBinding {
  keys: string;
  handler: (event: KeyboardEvent) => void;
  /** Allow firing while focus is in an input/textarea. Defaults to true for mod-chords. */
  allowInInputs?: boolean;
  enabled?: boolean;
}

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function useShortcuts(bindings: ShortcutBinding[]) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const binding of ref.current) {
        if (binding.enabled === false) continue;
        const allow = binding.allowInInputs ?? binding.keys.includes("mod");
        if (!allow && isEditable(event.target)) continue;
        if (matchesShortcut(event, binding.keys)) {
          event.preventDefault();
          binding.handler(event);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}