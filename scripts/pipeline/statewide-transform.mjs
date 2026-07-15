#!/usr/bin/env node
// Statewide streaming transformer: GeoJSONSeq (from `osmium export`) → NaviJSON
// GeoJSONSeq (for `tippecanoe`). Reads RS-delimited GeoJSON features on stdin,
// maps OSM tags to the NaviJSON schema (docs/SCHEMA.md), derives lane-marking
// "road paint" for major roads, and writes RS-delimited NaviJSON features on
// stdout. Streaming keeps disk flat while processing the whole California
// extract (tens of millions of features).
//
// Usage (in a pipe):
//   osmium export filtered.pbf -f geojsonseq --add-unique-id=type_id \
//     | node statewide-transform.mjs | tippecanoe -o california.pmtiles ...

import readline from "node:readline";
import { offsetLine, lineLengthMeters } from "./lib/geo.mjs";

const RS = "\x1e";
const LICENSE = "ODbL";
const SOURCE = "openstreetmap";
const LANE_WIDTH_M = 3.5;
const OBSERVED = process.env.NAVIJSON_OBSERVED || undefined;

const ROAD_RANK = {
  motorway: 8, motorway_link: 7, trunk: 7, trunk_link: 6,
  primary: 6, primary_link: 5, secondary: 5, secondary_link: 4,
  tertiary: 4, tertiary_link: 3, unclassified: 2, residential: 2,
  living_street: 1, service: 1, road: 2,
};
// Only derive lane paint for these classes statewide (bounds feature count).
const PAINT_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const RAIL = new Set(["rail", "light_rail", "subway", "tram", "monorail", "narrow_gauge"]);
const WATERWAY = new Set(["river", "stream", "canal", "drain", "ditch"]);
const GREEN_LEISURE = new Set(["park", "garden", "recreation_ground", "playground", "pitch", "golf_course", "dog_park", "nature_reserve"]);
const GREEN_LANDUSE = new Set(["grass", "meadow", "forest", "recreation_ground", "village_green", "cemetery", "orchard", "vineyard"]);
const URBAN_LANDUSE = new Set(["residential", "commercial", "industrial", "retail", "railway", "construction"]);

const bool = (v) => v === "yes" || v === "true" || v === "1";
const intOr = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function height(tags) {
  const h = Number.parseFloat(tags.height);
  if (Number.isFinite(h)) return Math.round(h);
  const l = Number.parseFloat(tags["building:levels"]);
  return Number.isFinite(l) ? Math.max(3, Math.round(l * 3.2)) : 8;
}

function envelope(tags, ref, extra) {
  const p = {
    source: SOURCE,
    source_ref: ref,
    license: LICENSE,
    observed: OBSERVED,
    ...extra,
  };
  for (const k of Object.keys(p)) if (p[k] === undefined || p[k] === null) delete p[k];
  return p;
}

function geomType(feature) {
  return feature.geometry?.type;
}

// Map one osmium GeoJSON feature to zero+ NaviJSON features.
function map(feature) {
  const tags = feature.properties || {};
  const ref = tags["@id"] || (feature.id != null ? String(feature.id) : "osm");
  const gt = geomType(feature);
  const out = [];
  if (!gt) return out;

  // Points: signals, signs, lamps, crossings.
  if (gt === "Point") {
    const hw = tags.highway;
    const emit = (feature_type, nj_class, confidence) =>
      out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type, nj_class, name: tags.name, confidence }), geometry: feature.geometry });
    if (hw === "traffic_signals") emit("signal", "traffic_signals", 0.9);
    else if (hw === "stop") emit("stop_sign", "stop", 0.9);
    else if (hw === "give_way") emit("traffic_sign", "give_way", 0.88);
    else if (hw === "street_lamp") emit("street_lamp", "street_lamp", 0.85);
    else if (hw === "crossing") emit("crossing", tags.crossing || "uncontrolled", 0.85);
    else if (tags.traffic_sign) emit("traffic_sign", tags.traffic_sign, 0.8);
    return out;
  }

  const isPoly = gt === "Polygon" || gt === "MultiPolygon";
  const isLine = gt === "LineString" || gt === "MultiLineString";

  if (tags.building && isPoly) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "building", nj_class: tags.building === "yes" ? "building" : tags.building, name: tags.name, height: height(tags), confidence: 0.9 }), geometry: feature.geometry });
    return out;
  }
  if ((tags.natural === "water" || tags.water || tags.landuse === "reservoir") && isPoly) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "water", nj_class: tags.water || "water", name: tags.name, confidence: 0.9 }), geometry: feature.geometry });
    return out;
  }
  if (tags.waterway && WATERWAY.has(tags.waterway) && isLine) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "waterway", nj_class: tags.waterway, name: tags.name, confidence: 0.88 }), geometry: feature.geometry });
    return out;
  }
  if (isPoly && ((tags.leisure && GREEN_LEISURE.has(tags.leisure)) || (tags.landuse && GREEN_LANDUSE.has(tags.landuse)) || tags.natural === "wood" || tags.natural === "scrub")) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "park", nj_class: tags.leisure || tags.landuse || tags.natural, name: tags.name, confidence: 0.85 }), geometry: feature.geometry });
    return out;
  }
  if (isPoly && tags.landuse && URBAN_LANDUSE.has(tags.landuse)) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "landuse", nj_class: tags.landuse, name: tags.name, confidence: 0.75 }), geometry: feature.geometry });
    return out;
  }
  if (tags.railway && RAIL.has(tags.railway) && isLine) {
    out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "rail", nj_class: tags.railway, name: tags.name, layer: intOr(tags.layer, 0), bridge: bool(tags.bridge), tunnel: bool(tags.tunnel), confidence: 0.85 }), geometry: feature.geometry });
    return out;
  }
  if (tags.highway && isLine) {
    const hw = tags.highway;
    if (hw in ROAD_RANK) {
      const lanes = intOr(tags.lanes, null);
      const props = envelope(tags, ref, {
        feature_type: "road", nj_class: hw, rank: ROAD_RANK[hw], name: tags.name, ref: tags.ref,
        lanes, oneway: bool(tags.oneway), layer: intOr(tags.layer, 0),
        bridge: bool(tags.bridge), tunnel: bool(tags.tunnel), surface: tags.surface, maxspeed: tags.maxspeed, confidence: 0.92,
      });
      out.push({ type: "Feature", properties: props, geometry: feature.geometry });
      // Derived road paint for major roads with a lane count (LineString only).
      if (gt === "LineString" && lanes >= 2 && PAINT_CLASSES.has(hw)) {
        const coords = feature.geometry.coordinates;
        if (coords.length >= 2 && lineLengthMeters(coords) >= 20) {
          const width = lanes * LANE_WIDTH_M;
          for (let i = 1; i < lanes; i += 1) {
            const off = -width / 2 + i * LANE_WIDTH_M;
            const center = !props.oneway && Math.abs(off) < LANE_WIDTH_M / 2;
            out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "lane_divider", nj_class: center ? "centerline" : "lane_line", marking: center ? "double_yellow" : "white_dashed", road_class: hw, derived: true, confidence: 0.6 }), geometry: { type: "LineString", coordinates: offsetLine(coords, off) } });
          }
        }
      }
      return out;
    }
    if (hw === "cycleway" || tags.cycleway) {
      out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "cycleway", nj_class: hw, name: tags.name, confidence: 0.8 }), geometry: feature.geometry });
      return out;
    }
    if (["footway", "path", "steps", "pedestrian", "track", "bridleway"].includes(hw)) {
      const sidewalk = hw === "footway" && tags.footway === "sidewalk";
      if (isPoly && (hw === "pedestrian" || hw === "footway") && tags.area === "yes") {
        out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: "pedestrian_area", nj_class: hw, name: tags.name, confidence: 0.78 }), geometry: feature.geometry });
      } else {
        out.push({ type: "Feature", properties: envelope(tags, ref, { feature_type: sidewalk ? "sidewalk" : "path", nj_class: sidewalk ? "sidewalk" : hw, name: tags.name, layer: intOr(tags.layer, 0), bridge: bool(tags.bridge), tunnel: bool(tags.tunnel), confidence: 0.72 }), geometry: feature.geometry });
      }
      return out;
    }
  }
  return out;
}

// Per-feature tippecanoe minzoom so the statewide tileset keeps the highway
// skeleton at low zoom and defers dense detail (buildings, paint, points) to
// high zoom — the standard way to make a whole-state tileset usable.
function minzoomFor(props) {
  switch (props.feature_type) {
    case "road":
      if (props.rank >= 7) return 5;
      if (props.rank >= 6) return 7;
      if (props.rank >= 5) return 9;
      if (props.rank >= 4) return 10;
      return 12;
    case "water":
    case "park":
    case "landuse":
      return 7;
    case "waterway":
    case "rail":
      return 8;
    case "lane_divider":
    case "building":
    case "sidewalk":
    case "path":
    case "cycleway":
    case "pedestrian_area":
      return 13;
    default:
      return 13; // signal, stop_sign, traffic_sign, street_lamp, crossing
  }
}

// A downstream consumer that closes early (e.g. `head`) must not crash us.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let inCount = 0;
let outCount = 0;
const chunks = [];
let pending = 0;

function flush() {
  if (chunks.length) {
    process.stdout.write(chunks.join(""));
    chunks.length = 0;
  }
}

rl.on("line", (raw) => {
  const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
  if (!line.trim()) return;
  inCount += 1;
  let feature;
  try {
    feature = JSON.parse(line);
  } catch {
    return;
  }
  for (const f of map(feature)) {
    f.tippecanoe = { minzoom: minzoomFor(f.properties), layer: "reality" };
    chunks.push(RS + JSON.stringify(f) + "\n");
    outCount += 1;
  }
  if (++pending >= 5000) { flush(); pending = 0; }
});

rl.on("close", () => {
  flush();
  process.stderr.write(`[navijson-statewide] in=${inCount} out=${outCount}\n`);
});
