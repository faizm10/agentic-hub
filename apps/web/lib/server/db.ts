import "server-only";
import postgres from "postgres";

/** The one thing the server code needs from a database. Postgres in production, PGlite in tests. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  window_start timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  key_enc text NOT NULL,
  hint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  title_enc text,
  status text NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_user ON chats(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS chat_events (
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  payload_enc text NOT NULL,
  PRIMARY KEY (chat_id, sequence)
);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  runtime_version text,
  snapshot_enc text,
  allow_remote_control boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  viewer_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS device_events (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  sequence integer NOT NULL,
  payload_enc text NOT NULL,
  PRIMARY KEY (device_id, session_id, sequence)
);
CREATE TABLE IF NOT EXISTS device_commands (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command_enc text NOT NULL,
  status text NOT NULL,
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_commands_pending ON device_commands(device_id, status);
`;

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await db.query(statement);
}

let instance: Promise<Db> | null = null;

/** Lazily connects and creates the schema once per server instance. */
export function getDb(): Promise<Db> {
  instance ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new ConfigError("DATABASE_URL is not set. Add a Postgres database (for example Neon from the Vercel Marketplace).");
    const sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
    const db: Db = { query: (text, params = []) => sql.unsafe(text, params as never[]) as never };
    await migrate(db);
    return db;
  })().catch((error) => {
    instance = null;
    throw error;
  });
  return instance;
}

/** Test seam: run the server code against another database. */
export function setDbForTests(db: Db | null) {
  instance = db ? Promise.resolve(db) : null;
}

export class ConfigError extends Error {}
