// Geometry helpers for the NaviJSON pipeline.
//
// Everything here works in [lng, lat] GeoJSON order. For metric operations we
// use a local equirectangular projection anchored at a reference latitude,
// which is accurate enough for lane-offset paint and length estimates at the
// city scale this pipeline targets.

const EARTH_M_PER_DEG_LAT = 110574; // meters per degree latitude (mean)

function metersPerDegLng(latDeg) {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

/** Round a coordinate to 6 decimal places (~0.11 m) to keep files compact. */
export function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function roundCoord([lng, lat]) {
  return [round6(lng), round6(lat)];
}

export function roundRing(ring) {
  return ring.map(roundCoord);
}

/** Great-circle-ish length of a [lng,lat] polyline in meters. */
export function lineLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const latRef = (lat1 + lat2) / 2;
    const dx = (lng2 - lng1) * metersPerDegLng(latRef);
    const dy = (lat2 - lat1) * EARTH_M_PER_DEG_LAT;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Whether a ring is closed (first point equals last point). */
export function isClosed(coords) {
  if (coords.length < 3) return false;
  const [ax, ay] = coords[0];
  const [bx, by] = coords[coords.length - 1];
  return Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9;
}

/** Ensure a ring is explicitly closed. */
export function closeRing(coords) {
  if (isClosed(coords)) return coords;
  return [...coords, coords[0]];
}

/** Signed area (shoelace) in projected meters^2 — used for winding checks. */
export function ringAreaMeters(coords) {
  if (coords.length < 3) return 0;
  const lat0 = coords[0][1];
  const mx = metersPerDegLng(lat0);
  let area = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    area += x1 * mx * (y2 * EARTH_M_PER_DEG_LAT) - x2 * mx * (y1 * EARTH_M_PER_DEG_LAT);
  }
  return area / 2;
}

/**
 * Offset a [lng,lat] polyline by `offsetMeters` (positive = left of travel
 * direction). Returns a new [lng,lat] polyline. Uses averaged segment normals
 * at interior vertices — good enough for lane-divider paint at street scale.
 */
export function offsetLine(coords, offsetMeters) {
  if (coords.length < 2) return coords;
  const lat0 = coords[Math.floor(coords.length / 2)][1];
  const mLng = metersPerDegLng(lat0);
  const mLat = EARTH_M_PER_DEG_LAT;

  // Project to local meters.
  const pts = coords.map(([lng, lat]) => [lng * mLng, lat * mLat]);

  // Per-segment unit normals (left-hand).
  const normals = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }

  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    let nx;
    let ny;
    if (i === 0) {
      [nx, ny] = normals[0];
    } else if (i === pts.length - 1) {
      [nx, ny] = normals[normals.length - 1];
    } else {
      const [ax, ay] = normals[i - 1];
      const [bx, by] = normals[i];
      nx = ax + bx;
      ny = ay + by;
      const nlen = Math.hypot(nx, ny) || 1;
      // Miter scaling keeps the offset roughly constant around bends.
      const cos = (ax * bx + ay * by + 1) / 2;
      const scale = 1 / Math.max(0.4, Math.sqrt(Math.max(cos, 0.0001)));
      nx = (nx / nlen) * scale;
      ny = (ny / nlen) * scale;
    }
    const [px, py] = pts[i];
    out.push([(px + nx * offsetMeters) / mLng, (py + ny * offsetMeters) / mLat]);
  }
  return out.map(roundCoord);
}

/** Bounding box [west, south, east, north] of a set of features. */
export function featuresBbox(features) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = ([lng, lat]) => {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  const walk = (coords) => {
    if (typeof coords[0] === "number") visit(coords);
    else coords.forEach(walk);
  };
  for (const f of features) {
    if (f.geometry) walk(f.geometry.coordinates);
  }
  return [west, south, east, north];
}
