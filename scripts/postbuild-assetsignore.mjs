#!/usr/bin/env node
// Exclude oversized data assets from the Cloudflare Workers static-asset upload.
//
// Cloudflare Workers/Pages reject any single static asset over 25 MiB. The full
// 15-region Reality Layer (features.geojson, ~48 MB) is served from object
// storage (R2/S3) in production via NEXT_PUBLIC_FEATURES_URL, so it must not be
// bundled. vinext emits dist/client/.assetsignore; we append our entries so the
// deploy skips them. Runs automatically after `npm run build` (postbuild).

import { existsSync, readFileSync, appendFileSync } from "node:fs";

const IGNORE = "dist/client/.assetsignore";
const ENTRIES = [
  "maps/GeoJSON/A_M-light/features.geojson",
];

if (!existsSync(IGNORE)) {
  console.warn(`[navijson] ${IGNORE} not found; skipping asset-exclusion step.`);
  process.exit(0);
}

const current = readFileSync(IGNORE, "utf8");
const lines = new Set(current.split(/\r?\n/).filter(Boolean));
let added = 0;
let out = current.endsWith("\n") || current.length === 0 ? "" : "\n";
for (const entry of ENTRIES) {
  if (!lines.has(entry)) {
    out += `${entry}\n`;
    added += 1;
  }
}
if (added > 0) {
  appendFileSync(IGNORE, out);
  console.log(`[navijson] excluded ${added} oversized asset(s) from the Cloudflare upload.`);
}
