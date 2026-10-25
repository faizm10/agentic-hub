import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ConfigError } from "./db";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM key for data at rest (API keys, chat content, synced device
 * data). `AGENTIC_HUB_ENCRYPTION_KEY` is 32 random bytes, base64-encoded:
 * `openssl rand -base64 32`.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.AGENTIC_HUB_ENCRYPTION_KEY;
  if (!raw) throw new ConfigError("AGENTIC_HUB_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new ConfigError("AGENTIC_HUB_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  cachedKey = decoded;
  return decoded;
}

export function resetKeyForTests() {
  cachedKey = null;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decrypt(sealed: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Unknown ciphertext format");
  const bytes = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

export const encryptJson = (value: unknown) => encrypt(JSON.stringify(value));
export const decryptJson = <T>(sealed: string): T => JSON.parse(decrypt(sealed)) as T;

/** Opaque bearer secrets (session cookies, device tokens) are stored only as SHA-256 hashes. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const derived = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Pairing codes avoid look-alike characters: `ABCD-2345`. */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
