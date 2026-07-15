// Developer console API-key management: list + create.
//
// TODO(auth): These console endpoints are intentionally OPEN for the MVP.
// Before exposing this publicly, gate every handler behind real user auth so a
// developer can only see and manage the keys they own.
import { desc } from "drizzle-orm";
import { apiKeys } from "../../../db/schema";

// Load the D1-backed Drizzle client lazily via dynamic import. `db/index.ts`
// statically imports `cloudflare:workers`, a binding that only exists inside
// the Cloudflare Worker runtime. Importing it dynamically keeps that protocol
// import out of the eagerly-evaluated module graph so the SSR bundle still
// loads under plain Node (e.g. the test runner), while the real Worker resolves
// `env.DB` at request time — same getDb() pattern as examples/d1/.../notes.
async function openDb() {
  const mod = await import("../../../db");
  return mod.getDb();
}

/**
 * Returns true when the failure is because Cloudflare D1 isn't wired up yet
 * (binding missing, or the migration hasn't been applied to the database).
 * The repo ships with `d1: null` in hosting.json, so this is the expected
 * state until an operator provisions and binds a real D1 database.
 */
function isD1Unavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${cause}`;
  return (
    combined.includes("D1 binding") ||
    combined.includes("is unavailable") ||
    combined.includes("no such table") ||
    combined.includes("D1_ERROR")
  );
}

function d1NotConfiguredResponse() {
  return Response.json(
    { error: "D1 not configured", hint: "bind DB in wrangler config" },
    { status: 503 }
  );
}

/** Hex-encode an ArrayBuffer. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a raw API key: `njk_live_` + 40 hex chars (20 random bytes). */
function generateRawKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `njk_live_${random}`;
}

/** SHA-256 hex digest of a string, via Web Crypto. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

// GET /api/keys → list keys (never the hash or raw key).
export async function GET() {
  try {
    const db = await openDb();
    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        revoked: apiKeys.revoked,
        requestCount: apiKeys.requestCount,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));

    return Response.json({ keys: rows });
  } catch (error) {
    if (isD1Unavailable(error)) return d1NotConfiguredResponse();
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

// POST /api/keys {name} → create a key; returns the RAW key ONCE.
export async function POST(request: Request) {
  let name = "";
  try {
    const payload = (await request.json().catch(() => ({}))) as { name?: string };
    name = payload.name?.trim() ?? "";
  } catch {
    name = "";
  }

  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const rawKey = generateRawKey();
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await sha256Hex(rawKey);
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    const db = await openDb();
    await db.insert(apiKeys).values({
      id,
      name,
      keyPrefix,
      keyHash,
      createdAt,
      revoked: 0,
      requestCount: 0,
      lastUsedAt: null,
    });

    // The raw key is returned exactly once and can never be retrieved again.
    return Response.json({ id, name, key: rawKey, keyPrefix }, { status: 201 });
  } catch (error) {
    if (isD1Unavailable(error)) return d1NotConfiguredResponse();
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
