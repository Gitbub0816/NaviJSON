// NaviJSON Drizzle schema.
//
// Stage 3 introduces developer-console API-key management backed by
// Cloudflare D1. Additional tables can be appended here as the platform grows.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * API keys issued to developers via the NaviJSON console.
 *
 * Security model: the raw key (`njk_live_…`) is shown to the user exactly once,
 * at creation time. Only its SHA-256 hex digest is persisted (`keyHash`) so a
 * database leak never exposes usable credentials. `keyPrefix` is a short,
 * non-secret label (first ~12 chars) safe to display in the UI.
 */
export const apiKeys = sqliteTable("api_keys", {
  // UUID primary key.
  id: text("id").primaryKey(),
  // Human-friendly label for the key.
  name: text("name").notNull().default(""),
  // Non-secret display prefix, e.g. "njk_live_1a2b".
  keyPrefix: text("key_prefix").notNull(),
  // SHA-256 hex digest of the full raw key. Never store the raw key itself.
  keyHash: text("key_hash").notNull(),
  // Creation timestamp, epoch milliseconds.
  createdAt: integer("created_at").notNull(),
  // Soft-delete / revocation flag (0 = active, 1 = revoked).
  revoked: integer("revoked").notNull().default(0),
  // Metering: total number of successful validate calls.
  requestCount: integer("request_count").notNull().default(0),
  // Last time the key was validated, epoch milliseconds (nullable).
  lastUsedAt: integer("last_used_at"),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
