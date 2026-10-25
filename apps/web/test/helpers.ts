import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate, setDbForTests, type Db } from "@/lib/server/db";
import { resetKeyForTests } from "@/lib/server/crypto";

export async function testDb(): Promise<Db & { close(): Promise<void>; raw: PGlite }> {
  process.env.AGENTIC_HUB_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  resetKeyForTests();
  const pg = new PGlite();
  const db = { raw: pg, query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows, close: () => pg.close() };
  await migrate(db);
  setDbForTests(db);
  return db;
}
