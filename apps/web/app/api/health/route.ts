import { ConfigError, getDb } from "@/lib/server/db";
import { encrypt } from "@/lib/server/crypto";
import { json } from "@/lib/server/http";

/** Configuration check for deployments. Reports what's missing, never secret values. */
export async function GET() {
  const checks = { database: false, encryptionKey: false };
  const problems: string[] = [];
  try {
    await (await getDb()).query("SELECT 1");
    checks.database = true;
  } catch (error) {
    // Connection errors can name hosts, so only configuration problems are spelled out.
    problems.push(error instanceof ConfigError ? error.message : "The database is unreachable.");
  }
  try {
    encrypt("check");
    checks.encryptionKey = true;
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Encryption key unavailable");
  }
  const ok = checks.database && checks.encryptionKey;
  return json({ ok, checks, problems }, { status: ok ? 200 : 503 });
}
