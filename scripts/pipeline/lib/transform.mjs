// OpenStreetMap → NaviJSON feature transformer.
//
// Input: raw Overpass JSON elements (ways with inline `geometry`, and point
// nodes for signals/signs/lamps). Output: NaviJSON GeoJSON features carrying
// the provenance + confidence contract described in docs/SCHEMA.md.
//
// Only OpenStreetMap (ODbL) is consumed here. Every emitted feature records
// source="openstreetmap", a source_ref, license="ODbL", a confidence score,
// and the OSM base observation timestamp — satisfying the publication gate in
// docs/DATA_LICENSES.md.

import {
  closeRing,
  lineLengthMeters,
  offsetLine,
  ringAreaMeters,
  roundCoord,
  roundRing,
} from "./geo.mjs";

const LICENSE = "ODbL";
const SOURCE = "openstreetmap";
const LANE_WIDTH_M = 3.5;

// Drivable road classes and the render hierarchy weight NaviJSON assigns them.
const ROAD_CLASSES = {
  motorway: 8,
  motorway_link: 7,
  trunk: 7,
  trunk_link: 6,
  primary: 6,
  primary_link: 5,
  secondary: 5,
  secondary_link: 4,
  tertiary: 4,
  tertiary_link: 3,
  unclassified: 2,
  residential: 2,
  living_street: 1,
  service: 1,
  road: 2,
};

const RAIL_CLASSES = new Set([
  "rail",
  "light_rail",
  "subway",
  "tram",
  "monorail",
  "narrow_gauge",
]);

const WATERWAY_CLASSES = new Set(["river", "stream", "canal", "drain", "ditch"]);

const GREEN_LEISURE = new Set([
  "park",
  "garden",
  "recreation_ground",
  "playground",
  "pitch",
  "golf_course",
  "dog_park",
  "nature_reserve",
]);

const GREEN_LANDUSE = new Set([
  "grass",
  "meadow",
  "forest",
  "recreation_ground",
  "village_green",
  "cemetery",
  "orchard",
  "vineyard",
]);

const URBAN_LANDUSE = new Set([
  "residential",
  "commercial",
  "industrial",
  "retail",
  "railway",
  "construction",
]);

function toBool(value) {
  return value === "yes" || value === "true" || value === "1";
}

function parseIntOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function coordsFromGeometry(geometry) {
  return geometry.map((p) => roundCoord([p.lon, p.lat]));
}

function base(el, extra) {
  return {
    source: SOURCE,
    source_ref: `${el.type}/${el.id}`,
    license: LICENSE,
    ...extra,
  };
}

/** Estimate a building height (m) from OSM height / building:levels tags. */
function buildingHeight(tags) {
  if (tags.height) {
    const h = Number.parseFloat(tags.height);
    if (Number.isFinite(h)) return Math.round(h);
  }
  const levels = Number.parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels)) return Math.max(3, Math.round(levels * 3.2));
  return 8;
}

function normalizeRoadClass(highway) {
  if (highway in ROAD_CLASSES) return highway;
  return null;
}

/**
 * Derive lane-divider "road paint" lines for a drivable road with >= 2 lanes.
 * Returns an array of NaviJSON lane_divider features (inferred geometry, so a
 * lower confidence than surveyed OSM geometry).
 */
function laneDividers(el, roadCoords, roadProps) {
  const lanes = roadProps.lanes;
  if (!lanes || lanes < 2) return [];
  if (roadCoords.length < 2) return [];
  if (lineLengthMeters(roadCoords) < 18) return [];

  const totalWidth = lanes * LANE_WIDTH_M;
  const features = [];
  for (let i = 1; i < lanes; i += 1) {
    const offset = -totalWidth / 2 + i * LANE_WIDTH_M;
    const isCenter = roadProps.oneway ? false : Math.abs(offset) < LANE_WIDTH_M / 2;
    const line = offsetLine(roadCoords, offset);
    features.push({
      type: "Feature",
      properties: base(el, {
        feature_type: "lane_divider",
        nj_class: isCenter ? "centerline" : "lane_line",
        parent_ref: `${el.type}/${el.id}`,
        road_class: roadProps.nj_class,
        marking: isCenter ? "double_yellow" : "white_dashed",
        confidence: 0.62,
        derived: true,
        observed: roadProps.observed,
      }),
      geometry: { type: "LineString", coordinates: line },
    });
  }
  return features;
}

/**
 * Transform a single OSM element into zero or more NaviJSON features.
 * @param {object} el Overpass element.
 * @param {string} observed OSM base timestamp for provenance.
 */
export function transformElement(el, observed) {
  const tags = el.tags ?? {};
  const out = [];

  // ---- Point features (signals, signs, lamps, crossings) -----------------
  if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    const point = { type: "Point", coordinates: roundCoord([el.lon, el.lat]) };
    const highway = tags.highway;
    if (highway === "traffic_signals") {
      out.push(pointFeature(el, point, "signal", "traffic_signals", 0.9, observed, tags));
    } else if (highway === "stop") {
      out.push(pointFeature(el, point, "stop_sign", "stop", 0.9, observed, tags));
    } else if (highway === "give_way") {
      out.push(pointFeature(el, point, "traffic_sign", "give_way", 0.88, observed, tags));
    } else if (highway === "street_lamp") {
      out.push(pointFeature(el, point, "street_lamp", "street_lamp", 0.85, observed, tags));
    } else if (highway === "crossing") {
      out.push(pointFeature(el, point, "crossing", tags.crossing ?? "uncontrolled", 0.85, observed, tags));
    } else if (tags.traffic_sign) {
      out.push(pointFeature(el, point, "traffic_sign", tags.traffic_sign, 0.8, observed, tags));
    }
    return out;
  }

  if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) {
    return out;
  }

  const coords = coordsFromGeometry(el.geometry);

  // ---- Buildings ---------------------------------------------------------
  if (tags.building) {
    const ring = roundRing(closeRing(coords));
    if (ring.length >= 4) {
      out.push({
        type: "Feature",
        properties: base(el, {
          feature_type: "building",
          nj_class: tags.building === "yes" ? "building" : tags.building,
          name: tags.name,
          height: buildingHeight(tags),
          confidence: 0.9,
          observed,
        }),
        geometry: { type: "Polygon", coordinates: [enforceCcw(ring)] },
      });
    }
    return out;
  }

  // ---- Water (areal) -----------------------------------------------------
  if (tags.natural === "water" || tags.water || tags.landuse === "reservoir") {
    const ring = roundRing(closeRing(coords));
    if (ring.length >= 4) {
      out.push(polygonFeature(el, ring, "water", tags.water ?? "water", tags.name, 0.9, observed));
    }
    return out;
  }

  // ---- Waterway (linear rivers/streams) ----------------------------------
  if (tags.waterway && WATERWAY_CLASSES.has(tags.waterway)) {
    out.push({
      type: "Feature",
      properties: base(el, {
        feature_type: "waterway",
        nj_class: tags.waterway,
        name: tags.name,
        confidence: 0.88,
        observed,
      }),
      geometry: { type: "LineString", coordinates: coords },
    });
    return out;
  }

  // ---- Parks / green space ----------------------------------------------
  if (
    (tags.leisure && GREEN_LEISURE.has(tags.leisure)) ||
    (tags.landuse && GREEN_LANDUSE.has(tags.landuse)) ||
    tags.natural === "wood" ||
    tags.natural === "scrub"
  ) {
    const ring = roundRing(closeRing(coords));
    if (ring.length >= 4) {
      const cls = tags.leisure ?? tags.landuse ?? tags.natural;
      out.push(polygonFeature(el, ring, "park", cls, tags.name, 0.85, observed));
    }
    return out;
  }

  // ---- Urban land use ----------------------------------------------------
  if (tags.landuse && URBAN_LANDUSE.has(tags.landuse)) {
    const ring = roundRing(closeRing(coords));
    if (ring.length >= 4) {
      out.push(polygonFeature(el, ring, "landuse", tags.landuse, tags.name, 0.75, observed));
    }
    return out;
  }

  // ---- Rail --------------------------------------------------------------
  if (tags.railway && RAIL_CLASSES.has(tags.railway)) {
    out.push({
      type: "Feature",
      properties: base(el, {
        feature_type: "rail",
        nj_class: tags.railway,
        name: tags.name,
        layer: parseIntOr(tags.layer, 0),
        bridge: toBool(tags.bridge),
        tunnel: toBool(tags.tunnel),
        confidence: 0.85,
        observed,
      }),
      geometry: { type: "LineString", coordinates: coords },
    });
    return out;
  }

  // ---- Highways (roads, paths, cycleways, sidewalks) ---------------------
  if (tags.highway) {
    const highway = tags.highway;

    // Pedestrian areas render as polygons.
    if ((highway === "pedestrian" || highway === "footway") && tags.area === "yes") {
      const ring = roundRing(closeRing(coords));
      if (ring.length >= 4) {
        out.push(polygonFeature(el, ring, "pedestrian_area", highway, tags.name, 0.78, observed));
      }
      return out;
    }

    const roadClass = normalizeRoadClass(highway);
    if (roadClass) {
      const props = base(el, {
        feature_type: "road",
        nj_class: roadClass,
        rank: ROAD_CLASSES[roadClass],
        name: tags.name,
        ref: tags.ref,
        lanes: parseIntOr(tags.lanes, null),
        oneway: toBool(tags.oneway),
        layer: parseIntOr(tags.layer, 0),
        bridge: toBool(tags.bridge),
        tunnel: toBool(tags.tunnel),
        surface: tags.surface,
        maxspeed: tags.maxspeed,
        length_m: Math.round(lineLengthMeters(coords)),
        confidence: 0.92,
        observed,
      });
      out.push({
        type: "Feature",
        properties: props,
        geometry: { type: "LineString", coordinates: coords },
      });
      out.push(...laneDividers(el, coords, props));
      return out;
    }

    if (highway === "cycleway" || tags.cycleway) {
      out.push(lineFeature(el, coords, "cycleway", highway, tags.name, 0.8, observed, tags));
      return out;
    }

    if (["footway", "path", "steps", "pedestrian", "track", "bridleway"].includes(highway)) {
      const isSidewalk = highway === "footway" && tags.footway === "sidewalk";
      out.push(
        lineFeature(
          el,
          coords,
          isSidewalk ? "sidewalk" : "path",
          isSidewalk ? "sidewalk" : highway,
          tags.name,
          0.72,
          observed,
          tags,
        ),
      );
      return out;
    }
  }

  return out;
}

function enforceCcw(ring) {
  return ringAreaMeters(ring) < 0 ? [...ring].reverse() : ring;
}

function pointFeature(el, geometry, featureType, njClass, confidence, observed, tags) {
  return {
    type: "Feature",
    properties: base(el, {
      feature_type: featureType,
      nj_class: njClass,
      name: tags.name,
      ref: tags.ref,
      confidence,
      observed,
    }),
    geometry,
  };
}

function polygonFeature(el, ring, featureType, njClass, name, confidence, observed) {
  return {
    type: "Feature",
    properties: base(el, {
      feature_type: featureType,
      nj_class: njClass,
      name,
      confidence,
      observed,
    }),
    geometry: { type: "Polygon", coordinates: [enforceCcw(ring)] },
  };
}

function lineFeature(el, coords, featureType, njClass, name, confidence, observed, tags) {
  return {
    type: "Feature",
    properties: base(el, {
      feature_type: featureType,
      nj_class: njClass,
      name,
      layer: parseIntOr(tags.layer, 0),
      bridge: toBool(tags.bridge),
      tunnel: toBool(tags.tunnel),
      confidence,
      observed,
    }),
    geometry: { type: "LineString", coordinates: coords },
  };
}

/** Strip undefined property values so emitted GeoJSON stays clean. */
export function cleanProperties(feature) {
  const props = feature.properties;
  for (const key of Object.keys(props)) {
    if (props[key] === undefined || props[key] === null) delete props[key];
  }
  return feature;
}

/**
 * Transform a full Overpass response into a NaviJSON FeatureCollection body.
 * @returns {{features: object[], counts: Record<string, number>}}
 */
export function transformOverpass(overpass) {
  const observed = overpass?.osm3s?.timestamp_osm_base ?? undefined;
  const elements = Array.isArray(overpass?.elements) ? overpass.elements : [];
  const features = [];
  for (const el of elements) {
    for (const feature of transformElement(el, observed)) {
      features.push(cleanProperties(feature));
    }
  }
  const counts = {};
  for (const f of features) {
    const t = f.properties.feature_type;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return { features, counts };
}
