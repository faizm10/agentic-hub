/**
 * Same-origin bridge from the desktop UI to the local runtime, served by the
 * Vite dev/preview server (used by `pnpm dev:desktop` and `tauri dev`).
 *
 * The runtime has no CORS and requires a bearer token that it writes to an
 * owner-only file. Rather than handing that token to page script, this bridge
 * reads it on the Node side and attaches it to forwarded requests. It accepts
 * only same-origin requests on a loopback Host, so other websites open in a
 * browser can't drive the runtime through it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Connect, Plugin } from "vite";

const PREFIX = "/runtime";
const FORWARDED_HEADERS = ["accept", "content-type", "content-length", "last-event-id"];

function dataDir() {
  return process.env.AGENTIC_HUB_DATA_DIR ?? join(homedir(), ".agentic-hub");
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The newest token file written by a runtime process that is still running. */
export function findRuntimeToken(dir = dataDir()): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const candidates = names
    .map((name) => ({ name, pid: Number(/^token-(\d+)$/.exec(name)?.[1]) }))
    .filter((c) => Number.isInteger(c.pid) && c.pid > 0 && alive(c.pid))
    .map((c) => ({ path: join(dir, c.name), mtime: statSync(join(dir, c.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates) {
    try {
      const token = readFileSync(candidate.path, "utf8").trim();
      if (token) return token;
    } catch {
      // Removed during shutdown; try the next one.
    }
  }
  return null;
}

function fail(res: ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: { code, message } }));
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/** Reject anything that isn't a same-origin request to a loopback host. */
function rejectReason(req: IncomingMessage): string | null {
  const host = req.headers.host ?? "";
  if (!LOOPBACK_HOST.test(host)) return "The runtime bridge only serves loopback hosts.";
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return "Cross-origin requests to the runtime bridge are not allowed.";
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return "Cross-site requests to the runtime bridge are not allowed.";
  return null;
}

function createBridge(): Connect.NextHandleFunction {
  const target = new URL(process.env.AGENTIC_HUB_RUNTIME_URL ?? "http://127.0.0.1:43117");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("AGENTIC_HUB_RUNTIME_URL must point at a loopback address.");
  }
  return (req, res) => {
    const denied = rejectReason(req);
    if (denied) return fail(res, 403, "FORBIDDEN", denied);
    const token = findRuntimeToken();
    if (!token) {
      return fail(
        res,
        503,
        "RUNTIME_UNAVAILABLE",
        `No running Agentic Hub runtime was found (no live token file in ${dataDir()}). Start it with \`pnpm runtime:start\`.`,
      );
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    for (const name of FORWARDED_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // Mounted at PREFIX, so req.url is already the runtime path.
    const upstream = httpRequest(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.url || "/", headers },
      (response) => {
        const out: Record<string, string> = { "cache-control": "no-store" };
        const type = response.headers["content-type"];
        if (type) out["content-type"] = type;
        res.writeHead(response.statusCode ?? 502, out);
        res.flushHeaders();
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (res.headersSent) return void res.end();
      fail(res, 503, "RUNTIME_UNAVAILABLE", `The local runtime isn't listening at ${target.origin}. Start it with \`pnpm runtime:start\`.`);
    });
    // Close the upstream SSE stream when the page goes away.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };
}

export function runtimeBridge(): Plugin {
  return {
    name: "agentic-hub-runtime-bridge",
    configureServer(server) {
      server.middlewares.use(PREFIX, createBridge());
    },
    configurePreviewServer(server) {
      server.middlewares.use(PREFIX, createBridge());
    },
  };
}
