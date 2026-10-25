/**
 * A `fetch` that reaches the local runtime through the native bridge
 * (src-tauri/src/bridge.rs) instead of the network. Rust attaches the
 * runtime's bearer token, so it never exists in page script. JSON requests
 * map to `runtime_request`; `text/event-stream` requests map to
 * `runtime_stream_open`, whose chunks arrive over a Tauri channel.
 */
import { Channel, invoke } from "@tauri-apps/api/core";

export const TAURI_RUNTIME_BASE = "http://runtime.localhost";

type BridgeResponse = { status: number; body: string };
type StreamMessage = { type: "open"; status: number } | { type: "data"; chunk: string } | { type: "end" } | { type: "error"; message: string };

const encoder = new TextEncoder();

function toPath(input: RequestInfo | URL): string {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, TAURI_RUNTIME_BASE);
  return `${url.pathname}${url.search}`;
}

function openStream(path: string, headers: Headers, signal?: AbortSignal | null): Promise<Response> {
  return new Promise((resolve, reject) => {
    let id: number | null = null;
    let settled = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const close = () => {
      if (id !== null) void invoke("runtime_stream_close", { id });
    };
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: close,
    });
    const channel = new Channel<StreamMessage>();
    channel.onmessage = (message) => {
      switch (message.type) {
        case "open":
          settled = true;
          resolve(new Response(body, { status: message.status, headers: { "content-type": "text/event-stream" } }));
          break;
        case "data":
          controller.enqueue(encoder.encode(message.chunk));
          break;
        case "end":
          controller.close();
          break;
        case "error":
          if (!settled) {
            settled = true;
            reject(new TypeError(message.message));
          } else controller.error(new Error(message.message));
          break;
      }
    };
    signal?.addEventListener(
      "abort",
      () => {
        close();
        if (!settled) {
          settled = true;
          reject(new DOMException("Aborted", "AbortError"));
        }
      },
      { once: true },
    );
    invoke<number>("runtime_stream_open", { path, lastEventId: headers.get("last-event-id"), channel }).then(
      (streamId) => {
        id = streamId;
        if (signal?.aborted) close();
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(new TypeError(String(error)));
        }
      },
    );
  });
}

export const tauriFetch: typeof fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  const path = toPath(input);
  if (headers.get("accept")?.includes("text/event-stream")) return openStream(path, headers, init.signal);
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : null;
  let result: BridgeResponse;
  try {
    result = await invoke<BridgeResponse>("runtime_request", { method, path, body });
  } catch (error) {
    // Mirrors a network failure, which the runtime client reports as "unavailable".
    throw new TypeError(String(error), { cause: error });
  }
  return new Response(result.body || null, { status: result.status, headers: { "content-type": "application/json" } });
};
