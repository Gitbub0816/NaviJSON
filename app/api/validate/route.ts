// API-key validation + usage metering.
//
// This is the endpoint the NaviJSON SDK / API consumers call on each request.
// It accepts a key via `Authorization: Bearer <key>` or `?key=<key>`, verifies
// it against the stored SHA-256 hash, rejects missing/revoked keys with 401,
// and otherwise increments the request counter and stamps lastUsedAt.
import { eq, sql } from "drizzle-orm";
import { apiKeys } from "../../../db/schema";

// Lazy D1 client — see app/api/keys/route.ts for why this is a dynamic import
// (keeps `cloudflare:workers` out of the eagerly-loaded SSR bundle).
async function openDb() {
  const mod = await import("../../../db");
  return mod.getDb();
}

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

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** Extract the raw key from Authorization: Bearer or the ?key= query param. */
function extractKey(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const url = new URL(request.url);
  return url.searchParams.get("key")?.trim() ?? "";
}

async function handle(request: Request) {
  const rawKey = extractKey(request);

  if (!rawKey) {
    return Response.json(
      { valid: false, error: "missing API key" },
      { status: 401 }
    );
  }

  try {
    const keyHash = await sha256Hex(rawKey);
    const db = await openDb();

    const [row] = await db
      .select({
        id: apiKeys.id,
        keyPrefix: apiKeys.keyPrefix,
        revoked: apiKeys.revoked,
        requestCount: apiKeys.requestCount,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!row || row.revoked) {
      return Response.json(
        { valid: false, error: "invalid or revoked API key" },
        { status: 401 }
      );
    }

    // Meter usage: increment count + stamp last-used time.
    await db
      .update(apiKeys)
      .set({
        requestCount: sql`${apiKeys.requestCount} + 1`,
        lastUsedAt: Date.now(),
      })
      .where(eq(apiKeys.id, row.id));

    return Response.json({
      valid: true,
      keyPrefix: row.keyPrefix,
      requestCount: row.requestCount + 1,
    });
  } catch (error) {
    if (isD1Unavailable(error)) return d1NotConfiguredResponse();
    return Response.json(
      { valid: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
