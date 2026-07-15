#!/usr/bin/env bash
# Build the entire-California NaviJSON vector tileset (PMTiles).
#
# Pipeline (streaming — no giant intermediate GeoJSON on disk):
#   Geofabrik California PBF
#     → osmium tags-filter   (keep only NaviJSON-relevant OSM features)
#     → osmium export        (assemble geometry, emit GeoJSONSeq)
#     → statewide-transform  (map OSM tags → NaviJSON schema + derived paint)
#     → tippecanoe           (build zoom 4–16 vector tiles → california.pmtiles)
#
# The PMTiles output is a build artifact, NOT committed (it is large and git
# hosts poorly). Host it on R2/S3/any static host and point style.json's
# `navijson-reality-tiles` source at it. See docs/A_M_LIGHT.md.
#
# Requirements: osmium-tool, tippecanoe, node. Data © OpenStreetMap / ODbL.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$HERE/statewide-build"
PBF="$BUILD/california-latest.osm.pbf"
FILTERED="$BUILD/california-filtered.osm.pbf"
OUT="$BUILD/california.pmtiles"
PBF_URL="https://download.geofabrik.de/north-america/us/california-latest.osm.pbf"

mkdir -p "$BUILD"

if [[ ! -f "$PBF" ]]; then
  echo "[navijson] downloading California PBF (~1.3 GB)…"
  curl -fSL -o "$PBF" "$PBF_URL"
fi

echo "[navijson] observation timestamp from PBF header:"
NAVIJSON_OBSERVED="$(osmium fileinfo -e -g header.option.osmosis_replication_timestamp "$PBF" 2>/dev/null || true)"
export NAVIJSON_OBSERVED
echo "  ${NAVIJSON_OBSERVED:-unknown}"

echo "[navijson] filtering relevant OSM features…"
osmium tags-filter "$PBF" \
  w/highway w/railway w/waterway w/natural=water w/water \
  w/landuse w/leisure w/natural=wood,scrub w/building \
  n/highway=traffic_signals,stop,street_lamp,give_way,crossing \
  n/traffic_sign \
  -o "$FILTERED" --overwrite

echo "[navijson] export → transform → tippecanoe (this is the long step)…"
osmium export "$FILTERED" -f geojsonseq --add-unique-id=type_id \
    --geometry-types=point,linestring,polygon -o - 2>/dev/null \
  | node "$HERE/statewide-transform.mjs" \
  | tippecanoe \
      -o "$OUT" --force \
      -Z4 -z16 \
      -l reality \
      --drop-densest-as-needed \
      --extend-zooms-if-still-dropping \
      --simplification=8 \
      --read-parallel \
      --name="NaviJSON California Reality Layer" \
      --attribution="© OpenStreetMap contributors, ODbL"

echo "[navijson] done → $OUT"
ls -lh "$OUT"
tippecanoe-decode --help >/dev/null 2>&1 && echo "(inspect with: pmtiles show $OUT)" || true
