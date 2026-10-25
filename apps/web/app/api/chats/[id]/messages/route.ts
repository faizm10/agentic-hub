import { z } from "zod";
import { runTurn } from "@/lib/server/chats";
import { authed } from "@/lib/server/guard";
import { errorResponse, HttpError, readJson } from "@/lib/server/http";

export const maxDuration = 300;

const BodySchema = z.object({ text: z.string().trim().min(1, "Write a message first").max(100_000) });

/**
 * Sends a message and streams the turn as Server-Sent Events: `delta`
 * records for partial text, and `agent` records for each persisted event.
 * Closing the request cancels the provider call.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[id]/messages">) {
  try {
    const { db, user } = await authed(request);
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Chat not found");
    const { text } = BodySchema.parse(await readJson(request));
    const encoder = new TextEncoder();
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            abort.abort();
          }
        };
        try {
          await runTurn(db, user.id, id, text, (record) => write(record.event, record.data), abort.signal);
        } catch (error) {
          const response = errorResponse(error);
          write("failure", ((await response.json()) as { error: unknown }).error);
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (error) {
    return errorResponse(error);
  }
}
