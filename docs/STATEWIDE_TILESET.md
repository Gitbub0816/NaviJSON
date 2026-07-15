# Statewide California tileset

The committed `features.geojson` is a 15-region sample (see [SCHEMA.md](SCHEMA.md)).
The **entire state** is far too large to ship as GeoJSON, so it is delivered as
a vector-tile tileset built from the full California OpenStreetMap extract.

## What the build produces

`scripts/pipeline/build-statewide.sh` runs a streaming pipeline:

```
Geofabrik California PBF (~1.3 GB)
  → osmium tags-filter        keep NaviJSON-relevant OSM features
  → osmium export (GeoJSONSeq) assemble geometry + tags
  → statewide-transform.mjs    map OSM tags → NaviJSON schema + derived road paint
  → tippecanoe                 zoom 4–16 vector tiles → california.pmtiles
```

It is streaming end-to-end, so disk stays flat (no multi-GB intermediate GeoJSON).

### Actual build result

| Metric | Value |
| --- | --- |
| OSM elements read | 27,800,331 |
| NaviJSON features tiled | **16,983,701** |
| Zoom range | 4 – 16 |
| Bounds | -124.443, 32.495 → -114.104, 42.194 (full California) |
| Vector layer | `reality` |
| `california.pmtiles` | ~560 MB |
| `california.mbtiles` | ~comparable (Mapbox-upload format) |
| Attribution | © OpenStreetMap contributors, ODbL |

Per-feature `tippecanoe.minzoom` hints keep the highway skeleton at low zoom and
defer dense detail (buildings, road paint, poles, signs) to z13+. Tile fields
carry the full schema: `feature_type`, `nj_class`, `rank`, `lanes`, `oneway`,
`layer`, `bridge`, `tunnel`, `marking`, `height`, `source`, `source_ref`,
`license`, `confidence`, `observed`, …

The tilesets are **build artifacts, not committed** (they are large and git hosts
binaries poorly). `scripts/pipeline/statewide-build/` is gitignored.

## Build it yourself

```bash
# Requirements: osmium-tool, tippecanoe, node 22+
bash scripts/pipeline/build-statewide.sh          # → statewide-build/california.pmtiles
# Mapbox-upload format from the finished tiles (fast re-container, no re-tiling):
tile-join -o scripts/pipeline/statewide-build/california.mbtiles \
          scripts/pipeline/statewide-build/california.pmtiles --force
```

To rebuild against fresh OSM, delete `statewide-build/california-latest.osm.pbf`
and rerun (the script re-downloads it).

## Serve it in Mapbox

1. **Upload the MBTiles.** Mapbox Studio → *Tilesets* → *New tileset* → upload
   `california.mbtiles` (or use the Uploads API). You get a tileset id like
   `mapbox://YOURNAME.california`, source-layer **`reality`**.
2. **Point the style at it.** Regenerate the ready-made variant with your id:
   ```bash
   node scripts/pipeline/make-statewide-style.mjs mapbox://YOURNAME.california
   ```
   This writes `public/maps/GeoJSON/A_M-light/style-statewide.json` — the same
   29-layer stack (road paint included), just sourced from the tileset. Load it
   with `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` set.

## Or serve it as PMTiles (no Mapbox hosting)

Host `california.pmtiles` on any static bucket (Cloudflare R2, S3) and register
the protocol — works in Mapbox GL JS v3 and MapLibre:

```js
import { Protocol } from "pmtiles";
mapboxgl.addProtocol("pmtiles", new Protocol().tile);
```

```bash
node scripts/pipeline/make-statewide-style.mjs \
  "pmtiles://https://your-bucket.r2.dev/california.pmtiles"
```

Everything downstream (the 29 NaviJSON layers, filters, and road-paint styling)
is identical; only the source URL changes.
