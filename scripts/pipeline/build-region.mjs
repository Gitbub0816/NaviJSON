#!/usr/bin/env node
// NaviJSON region builder.
//
// Usage:
//   node scripts/pipeline/build-region.mjs                 # build all committed regions
//   node scripts/pipeline/build-region.mjs san-jose-downtown
//   node scripts/pipeline/build-region.mjs --bbox W,S,E,N --id custom
//
// Fetches OpenStreetMap (ODbL) via Overpass for each region, transforms it into
// the NaviJSON schema, writes per-region GeoJSON under scripts/pipeline/out/,
// and merges the committed regions into the served features.geojson.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fetchOverpass } from "./lib/overpass.mjs";
import { transformOverpass } from "./lib/transform.mjs";
import { featuresBbox } from "./lib/geo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT_DIR = join(HERE, "out");
const SERVED = join(REPO, "public", "maps", "GeoJSON", "A_M-light", "features.geojson");

function log(msg) {
  process.stdout.write(`[navijson] ${msg}\n`);
}

async function loadRegions() {
  return JSON.parse(await readFile(join(HERE, "regions.json"), "utf8"));
}

async function buildRegion(region) {
  log(`Region "${region.id}" — fetching OpenStreetMap…`);
  const overpass = await fetchOverpass(region.bbox, { log });
  const { features, counts } = transformOverpass(overpass);
  for (const f of features) f.properties.region = region.id;
  log(`Region "${region.id}" — ${features.length} features ${JSON.stringify(counts)}`);
  const collection = {
    type: "FeatureCollection",
    name: `NaviJSON California Light — ${region.name}`,
    metadata: {
      "navijson:region": region.id,
      "navijson:source": "OpenStreetMap contributors",
      "navijson:license": "ODbL",
      "navijson:observed": overpass?.osm3s?.timestamp_osm_base,
      "navijson:bbox": region.bbox,
    },
    features,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, `${region.id}.geojson`), JSON.stringify(collection));
  return collection;
}

function parseArgs(argv) {
  const args = { ids: [], bbox: null, id: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--bbox") {
      const [w, s, e, n] = argv[++i].split(",").map(Number);
      args.bbox = { west: w, south: s, east: e, north: n };
    } else if (a === "--id") {
      args.id = argv[++i];
    } else if (!a.startsWith("--")) {
      args.ids.push(a);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadRegions();

  let regions;
  if (args.bbox) {
    regions = [{ id: args.id ?? "custom", name: args.id ?? "Custom region", bbox: args.bbox }];
  } else if (args.ids.length) {
    regions = config.committed.filter((r) => args.ids.includes(r.id));
    if (!regions.length) throw new Error(`No committed region matches: ${args.ids.join(", ")}`);
  } else {
    regions = config.committed;
  }

  const collections = [];
  for (const region of regions) {
    // Sequential to stay friendly to shared Overpass mirrors.
    collections.push(await buildRegion(region));
  }

  // Merge every committed region into the served fixture.
  const merged = collections.flatMap((c) => c.features);
  const [west, south, east, north] = featuresBbox(merged);
  const observed = collections
    .map((c) => c.metadata["navijson:observed"])
    .filter(Boolean)
    .sort()
    .pop();

  const counts = {};
  for (const f of merged) {
    const t = f.properties.feature_type;
    counts[t] = (counts[t] ?? 0) + 1;
  }

  const collection = {
    type: "FeatureCollection",
    name: "NaviJSON California Light — Reality Layer",
    metadata: {
      "navijson:variant": "A_M-light",
      "navijson:source": "OpenStreetMap contributors",
      "navijson:license": "ODbL",
      "navijson:observed": observed,
      "navijson:regions": regions.map((r) => r.id),
      "navijson:bbox": { west, south, east, north },
      "navijson:feature_counts": counts,
      "navijson:generated_by": "scripts/pipeline/build-region.mjs",
    },
    features: merged,
  };

  await writeFile(SERVED, `${JSON.stringify(collection, null, 0)}\n`);
  log(`Wrote ${merged.length} features → ${SERVED}`);
  log(`Feature counts: ${JSON.stringify(counts)}`);
  log(`Bounds: [${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}]`);
}

main().catch((error) => {
  process.stderr.write(`[navijson] pipeline failed: ${error.stack ?? error.message}\n`);
  process.exit(1);
});
