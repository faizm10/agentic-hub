import { describe, expect, it, vi } from "vitest";
import { createReconnectingStream, type StreamTransport } from "../client/reconnecting-stream";
import type { ConnectionInfo } from "../model/types";

function fakeTransport() {
  const opens: { onOpen: () => void; onMessage: (m: string) => void; onClose: (e?: unknown) => void; closed: boolean }[] = [];
  const transport: StreamTransport<string> = {
    open(handlers) {
      const entry = { ...handlers, closed: false };
      opens.push(entry);
      return { close: () => (entry.closed = true) };
    },
  };
  return { transport, opens };
}

describe("createReconnectingStream", () => {
  it("reconnects with exponential backoff and resets after a successful open", () => {
    vi.useFakeTimers();
    const { transport, opens } = fakeTransport();
    const statuses: ConnectionInfo["status"][] = [];
    const messages: string[] = [];
    createReconnectingStream({ transport, onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s.status), random: () => 0.5, baseDelayMs: 100 });

    opens[0]!.onOpen();
    opens[0]!.onMessage("hello");
    opens[0]!.onClose(new Error("drop"));
    expect(statuses).toEqual(["connecting", "connected", "reconnecting"]);

    vi.advanceTimersByTime(99);
    expect(opens).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(opens).toHaveLength(2);

    opens[1]!.onClose();
    vi.advanceTimersByTime(199);
    expect(opens).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(opens).toHaveLength(3);

    opens[2]!.onOpen();
    opens[2]!.onClose();
    vi.advanceTimersByTime(100);
    expect(opens).toHaveLength(4);
    expect(messages).toEqual(["hello"]);
    vi.useRealTimers();
  });

  it("gives up after maxAttempts and reports disconnected", () => {
    vi.useFakeTimers();
    const { transport, opens } = fakeTransport();
    const statuses: ConnectionInfo[] = [];
    createReconnectingStream({ transport, onMessage: () => {}, onStatus: (s) => statuses.push(s), maxAttempts: 1, random: () => 0.5, baseDelayMs: 10 });
    opens[0]!.onClose();
    vi.advanceTimersByTime(10);
    opens[1]!.onClose(new Error("refused"));
    expect(statuses.at(-1)).toEqual({ status: "disconnected", detail: "refused" });
    vi.useRealTimers();
  });

  it("retryNow skips the backoff and close stops everything", () => {
    vi.useFakeTimers();
    const { transport, opens } = fakeTransport();
    const stream = createReconnectingStream({ transport, onMessage: () => {}, baseDelayMs: 10_000 });
    opens[0]!.onClose();
    stream.retryNow();
    expect(opens).toHaveLength(2);
    stream.close();
    expect(opens[1]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(opens).toHaveLength(2);
    vi.useRealTimers();
  });
});
