import type { Metadata } from "next";
import { NaviMap } from "../maps/GeoJSON/A_M-light/NaviMap";
import { EmbedBridge } from "./EmbedBridge";
import styles from "./embed.module.css";

export const metadata: Metadata = {
  title: "NaviJSON Embed",
  description: "Chromeless embeddable NaviJSON map + navigation view.",
  robots: { index: false, follow: false },
};

/**
 * /embed — the chromeless view the NaviJSON SDK iframes.
 *
 * Reads config from the URL query string:
 *   - `token`   Mapbox public token (pk...). When present the live Mapbox map
 *               with tap-to-route / drive / voice renders; omit it for the
 *               keyless canvas preview.
 *   - `tileset` optional tileset URL (mapbox://user.id, a TileJSON URL, or
 *               pmtiles://...) forwarded to NaviMap's statewide style variant.
 *   - `key`     optional caller API key; reserved for future gating. Read here
 *               so the param round-trips, but not required to render.
 *
 * Server component: it resolves searchParams and renders the client NaviMap
 * full-viewport, plus the EmbedBridge that posts the "ready" event to the host.
 */
export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

  const token = first(params.token);
  const tileset = first(params.tileset);

  return (
    <div className={styles.frame}>
      <EmbedBridge />
      <NaviMap mapboxToken={token} tilesetUrl={tileset} />
    </div>
  );
}
