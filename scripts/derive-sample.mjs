#!/usr/bin/env node
// Derive same-origin, deploy-sized data files from the full Reality Layer.
//
// The full features.geojson (~48 MB) exceeds Cloudflare's 25 MiB static-asset
// limit and can't be served from r2.dev cross-origin (r2.dev ignores bucket CORS
// policies). So at build time we emit two smaller files that DO deploy as
// same-origin Worker assets (no CORS):
//   - features-render.geojson : rendering (drops buildings/sidewalks/paths/
//     crossings — the basemap already draws buildings). ~18 MB.
//   - roads.geojson           : roads only, for the routing graph. ~8 MB.
// Runs on prebuild and predev. Both outputs are gitignored (regenerated).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "public", "maps", "GeoJSON", "A_M-light");
const SRC = join(DIR, "features.geojson");

if (!existsSync(SRC)) {
  console.warn(`[navijson] ${SRC} not found; skipping derive step.`);
  process.exit(0);
}

const RENDER_DROP = new Set(["building", "sidewalk", "path", "crossing"]);

const collection = JSON.parse(readFileSync(SRC, "utf8"));
const features = Array.isArray(collection.features) ? collection.features : [];

const render = features.filter((f) => !RENDER_DROP.has(f?.properties?.feature_type));
const roads = features.filter((f) => f?.properties?.feature_type === "road");

writeFileSync(
  join(DIR, "features-render.geojson"),
  JSON.stringify({ type: "FeatureCollection", name: "NaviJSON render", metadata: collection.metadata, features: render }),
);
writeFileSync(
  join(DIR, "roads.geojson"),
  JSON.stringify({ type: "FeatureCollection", name: "NaviJSON roads (routing)", features: roads }),
);

const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
console.log(
  `[navijson] derived features-render.geojson (${render.length} feats) + roads.geojson (${roads.length} feats)`,
);
