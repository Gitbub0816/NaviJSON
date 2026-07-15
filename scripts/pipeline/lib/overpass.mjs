// Overpass API client for the NaviJSON pipeline.
//
// Builds a single Overpass QL query that pulls every OSM feature class the
// NaviJSON schema renders, then fetches it with retry/backoff across mirrors.
// Ways come back with inline geometry (`out geom`); point features (signals,
// signs, lamps, crossings) come back as tagged nodes.

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/**
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {number} timeout Overpass server-side timeout (seconds).
 */
export function buildQuery(bbox, timeout = 180) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:${timeout}];
(
  way["highway"](${b});
  way["railway"](${b});
  way["waterway"~"river|stream|canal|drain|ditch"](${b});
  way["natural"="water"](${b});
  way["water"](${b});
  way["landuse"](${b});
  way["leisure"](${b});
  way["natural"~"wood|scrub"](${b});
  way["building"](${b});
  node["highway"~"traffic_signals|stop|street_lamp|give_way|crossing"](${b});
  node["traffic_sign"](${b});
);
out geom tags qt;`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Overpass results for a bbox with retry across mirrors.
 * @returns {Promise<object>} Parsed Overpass JSON.
 */
export async function fetchOverpass(bbox, { timeout = 180, retries = 4, log = () => {} } = {}) {
  const query = buildQuery(bbox, timeout);
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      log(`Overpass fetch (attempt ${attempt + 1}) via ${new URL(url).host}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (timeout + 40) * 1000);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "NaviJSON-pipeline/1.0 (OpenStreetMap ODbL; +navijson)",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status === 429 || response.status === 504) {
        throw new Error(`Overpass busy (${response.status})`);
      }
      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}`);
      }
      const json = await response.json();
      if (!Array.isArray(json.elements)) {
        throw new Error("Overpass response missing elements");
      }
      log(`Overpass returned ${json.elements.length} elements`);
      return json;
    } catch (error) {
      lastError = error;
      const wait = Math.min(2 ** attempt, 16) * 1000;
      log(`Overpass attempt ${attempt + 1} failed: ${error.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`Overpass failed after ${retries} attempts: ${lastError?.message}`);
}
