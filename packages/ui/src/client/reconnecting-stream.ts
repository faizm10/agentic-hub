import type { ConnectionInfo } from "../model/types";

/** A transport opens one physical stream; the wrapper handles retries. */
export interface StreamTransport<T> {
  open(handlers: {
    onOpen: () => void;
    onMessage: (message: T) => void;
    onClose: (error?: unknown) => void;
  }): { close: () => void };
}

export interface ReconnectingStreamOptions<T> {
  transport: StreamTransport<T>;
  onMessage: (message: T) => void;
  onStatus?: (info: ConnectionInfo) => void;
  /** Base delay in ms; doubles per attempt up to maxDelayMs, with jitter. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/**
 * Transport-agnostic reconnect loop (works with WebSocket, EventSource or a
 * Tauri channel). Consumers should resume from their last seen sequence
 * number inside `transport.open` so replays are de-duplicated by the reducer.
 */
export function createReconnectingStream<T>(options: ReconnectingStreamOptions<T>) {
  const {
    transport,
    onMessage,
    onStatus,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    maxAttempts = Number.POSITIVE_INFINITY,
    random = Math.random,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now = Date.now,
  } = options;

  let attempt = 0;
  let stopped = false;
  let current: { close: () => void } | null = null;
  let timer: unknown = null;

  const connect = () => {
    if (stopped) return;
    onStatus?.({ status: attempt === 0 ? "connecting" : "reconnecting" });
    current = transport.open({
      onOpen: () => {
        attempt = 0;
        onStatus?.({ status: "connected" });
      },
      onMessage,
      onClose: (error) => {
        current = null;
        if (stopped) return;
        attempt += 1;
        if (attempt > maxAttempts) {
          onStatus?.({ status: "disconnected", detail: error instanceof Error ? error.message : "Connection lost." });
          return;
        }
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.75 + random() * 0.5);
        onStatus?.({ status: "reconnecting", retryAt: now() + delay, detail: "Connection lost. Retrying…" });
        timer = setTimer(connect, delay);
      },
    });
  };

  connect();

  return {
    /** Skip the backoff and retry now. */
    retryNow() {
      if (stopped || current) return;
      if (timer != null) clearTimer(timer);
      timer = null;
      attempt = Math.max(attempt, 1);
      connect();
    },
    close() {
      stopped = true;
      if (timer != null) clearTimer(timer);
      current?.close();
      current = null;
    },
  };
}
