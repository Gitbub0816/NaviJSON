#!/usr/bin/env node
// Derive the statewide vector-tile style from the committed GeoJSON style.
//
// style.json renders the committed 104k-feature sample from a GeoJSON source.
// The statewide Reality Layer is far too large to ship as GeoJSON, so it is
// served as vector tiles (Mapbox-hosted tileset or PMTiles). Every nj-* layer
// filters on feature_type / nj_class *properties*, so the exact same layer
// stack renders over the vector source — we only need to:
//   1. replace the geojson source with a vector source, and
//   2. add "source-layer": "reality" to every layer that uses it.
//
// Usage:
//   node scripts/pipeline/make-statewide-style.mjs [tileset-url]
// where tileset-url is e.g. mapbox://YOURNAME.california
//   or  pmtiles://https://your-bucket.r2.dev/california.pmtiles
// Output: public/maps/GeoJSON/A_M-light/style-statewide.json

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "public", "maps", "GeoJSON", "A_M-light");
const SOURCE_ID = "navijson-reality";
const SOURCE_LAYER = "reality"; // matches tippecanoe -l reality in build-statewide.sh

const tilesetUrl = process.argv[2] || "mapbox://REPLACE_WITH_YOUR_TILESET_ID";

const style = JSON.parse(await readFile(join(DIR, "style.json"), "utf8"));

// 1. Swap the geojson source for a vector source pointing at the tileset.
style.name = "NaviJSON California Light — Statewide";
style.metadata = {
  ...(style.metadata ?? {}),
  "navijson:variant": "A_M-light-statewide",
  "navijson:tileset": tilesetUrl,
  "navijson:source_layer": SOURCE_LAYER,
  "navijson:note":
    "Statewide vector-tile variant. Point `sources.navijson-reality.url` at your Mapbox tileset (mapbox://user.id) or a PMTiles URL (pmtiles://https://.../california.pmtiles, requires registering the pmtiles protocol via mapboxgl.addProtocol). Tiles built by scripts/pipeline/build-statewide.sh.",
};
style.sources = {
  ...style.sources,
  [SOURCE_ID]: { type: "vector", url: tilesetUrl },
};

// Zoom out a touch so the statewide skeleton is visible on first load.
style.zoom = 12;

// 2. Add source-layer to every layer bound to the reality source.
let patched = 0;
for (const layer of style.layers) {
  if (layer.source === SOURCE_ID) {
    layer["source-layer"] = SOURCE_LAYER;
    patched += 1;
  }
}

await writeFile(join(DIR, "style-statewide.json"), `${JSON.stringify(style, null, 2)}\n`);
process.stdout.write(
  `[navijson] wrote style-statewide.json — tileset ${tilesetUrl}, ${patched} layers given source-layer "${SOURCE_LAYER}"\n`,
);
