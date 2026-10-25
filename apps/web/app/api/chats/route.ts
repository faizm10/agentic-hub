import { z } from "zod";
import { createChat, listChats, recoverStaleChats } from "@/lib/server/chats";
import { authed } from "@/lib/server/guard";
import { json, readJson, route } from "@/lib/server/http";

const CreateSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().trim().min(1).max(120).optional(),
  text: z.string().trim().min(1, "Write a message first").max(100_000),
});

export const GET = route(async (request: Request) => {
  const { db, user } = await authed(request);
  await recoverStaleChats(db, user.id);
  return json({ chats: await listChats(db, user.id) });
});

/** Creates an empty chat; the first message is sent with POST /api/chats/:id/messages. */
export const POST = route(async (request: Request) => {
  const { db, user } = await authed(request);
  const input = CreateSchema.parse(await readJson(request));
  return json({ session: await createChat(db, user.id, input.provider, input.model, input.text) }, { status: 201 });
});
