// Developer console API-key management: revoke a single key.
//
// TODO(auth): Open endpoint for the MVP — add real user auth so only the
// owner of a key can revoke it.
import { eq } from "drizzle-orm";
import { apiKeys } from "../../../../db/schema";

// Lazy D1 client — see app/api/keys/route.ts for why this is a dynamic import
// (keeps `cloudflare:workers` out of the eagerly-loaded SSR bundle).
async function openDb() {
  const mod = await import("../../../../db");
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

// DELETE /api/keys/[id] → soft-revoke the key (revoked = 1).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const db = await openDb();
    const updated = await db
      .update(apiKeys)
      .set({ revoked: 1 })
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });

    if (updated.length === 0) {
      return Response.json({ error: "key not found" }, { status: 404 });
    }

    return Response.json({ id, revoked: true });
  } catch (error) {
    if (isD1Unavailable(error)) return d1NotConfiguredResponse();
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
