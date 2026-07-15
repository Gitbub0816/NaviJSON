/**
 * In-house, dependency-free routing engine over NaviJSON road data.
 *
 * Pipeline:
 *   buildRouteGraph(data) -> RouteGraph   (quantized node graph + grid index)
 *   snapToNetwork(graph, pt) -> LngLat    (nearest routable vertex)
 *   findRoute(graph, from, to) -> NavRoute (Dijkstra + turn-by-turn maneuvers)
 *
 * No external deps, no DOM, no React. Coordinates are [lng, lat].
 */

export type LngLat = [number, number];

/**
 * Minimal, structural GeoJSON typings. The `geojson` type package is not
 * installed in this repo (see NaviMap.tsx, which does the same), so these are
 * defined locally. They are structurally compatible with the real
 * `geojson.FeatureCollection`, so a consumer can pass either shape.
 */
export interface Geometry {
  type: string;
  coordinates: number[] | number[][] | number[][][];
}
export interface Feature {
  type?: string;
  properties: Record<string, unknown> | null;
  geometry: Geometry | null;
}
export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

export type ManeuverType =
  | "depart"
  | "straight"
  | "slight-left"
  | "slight-right"
  | "turn-left"
  | "turn-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "arrive";

export interface Maneuver {
  type: ManeuverType;
  instruction: string; // e.g. "Turn right onto Santa Clara St"
  roadName: string; // "" if unnamed
  location: LngLat; // where the maneuver happens
  distanceM: number; // distance of the step that FOLLOWS this maneuver
  bearingBefore: number; // 0..360
  bearingAfter: number; // 0..360
}

export interface NavRoute {
  coordinates: LngLat[]; // full route polyline, densified is fine
  distanceM: number;
  durationS: number; // traffic-adjusted estimate
  freeflowDurationS: number; // estimate with no congestion
  trafficDelayS: number; // durationS - freeflowDurationS
  trafficLevel: TrafficLevel; // overall congestion along the chosen route
  steps: Maneuver[]; // first is depart, last is arrive
}

/** A directed edge stored on the source node's adjacency list. */
interface Edge {
  to: number; // destination node index
  w: number; // length in meters (edge weight)
  sp: number; // free-flow travel speed in m/s (from road class)
  name: string; // road name ("" if unnamed)
  cls: string; // nj_class (for the traffic model)
}

export type TrafficLevel = "light" | "moderate" | "heavy";

/** Options for {@link findRoute}. */
export interface RouteOptions {
  /** Weight edges by traffic-adjusted time (default true → fastest route). */
  traffic?: boolean;
  /** Reference time for the traffic model (default: now). */
  now?: Date;
}

export interface RouteGraph {
  nodeCount: number;
  edgeCount: number;
  bbox: [number, number, number, number]; // [w,s,e,n]
  // ---- internal fields (implementation detail) ----
  /** Node coordinates, indexed by node id. */
  coords: LngLat[];
  /** Adjacency list: adj[nodeId] = outgoing edges. */
  adj: Edge[][];
  /** Spatial grid: cellKey -> node ids in that cell (for snapping). */
  grid: Map<string, number[]>;
  /** Grid cell size in degrees. */
  cell: number;
}

// ------------------------------------------------------------------ constants

/** Quantization: round coords to ~1e-5 deg (~1.1 m) so shared endpoints merge. */
const QUANT = 1e5;
/** Spatial-index cell size in degrees (~500 m). */
const CELL = 0.005;
/** Reject a snap whose nearest node is farther than this (meters). */
const MAX_SNAP_M = 500;

/** Travel speeds (m/s) by nj_class. `_link` classes fall back to their parent. */
const CLASS_SPEED: Record<string, number> = {
  motorway: 28,
  trunk: 18,
  primary: 18,
  secondary: 14,
  tertiary: 11,
  residential: 8,
  unclassified: 10,
  living_street: 6,
  service: 6,
};
const DEFAULT_SPEED = 10;

function speedFor(njClass: unknown): number {
  if (typeof njClass !== "string" || njClass.length === 0) return DEFAULT_SPEED;
  const cls = njClass.endsWith("_link") ? njClass.slice(0, -5) : njClass;
  return CLASS_SPEED[cls] ?? DEFAULT_SPEED;
}

/**
 * Traffic model — a deterministic time-of-day congestion function used to
 * weight edges so the router infers the *fastest* route, not just the shortest,
 * and reroutes around congested arterials during rush hour.
 *
 * Returns an effective-speed multiplier in (0, 1]: 1 = free-flow, lower =
 * slower. Higher-capacity roads (motorways, primaries) degrade most at peak;
 * local streets barely change. This is a self-contained stand-in for a live
 * traffic feed — swap this function for a feed-backed lookup to go live.
 */
const TRAFFIC_SENSITIVITY: Record<string, number> = {
  motorway: 0.62,
  trunk: 0.55,
  primary: 0.5,
  secondary: 0.4,
  tertiary: 0.3,
  unclassified: 0.22,
  residential: 0.18,
  living_street: 0.14,
  service: 0.12,
};

export function trafficFactor(njClass: unknown, now: Date = new Date()): number {
  const raw = typeof njClass === "string" ? njClass : "";
  const cls = raw.endsWith("_link") ? raw.slice(0, -5) : raw;
  const hour = now.getHours() + now.getMinutes() / 60;
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  // Gaussian AM (08:00) and PM (17:30) rush peaks.
  const am = Math.exp(-((hour - 8) ** 2) / 2.0);
  const pm = Math.exp(-((hour - 17.5) ** 2) / 2.5);
  let peak = Math.max(am, pm);
  if (weekend) peak *= 0.4;
  const sens = TRAFFIC_SENSITIVITY[cls] ?? 0.25;
  const congestion = peak * sens; // 0 .. ~0.62
  return Math.max(0.25, 1 - congestion);
}

// ------------------------------------------------------------------ geo utils

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_R = 6371000; // meters

/** Great-circle distance in meters between two [lng,lat] points. */
function haversineM(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG2RAD;
  const lat2 = b[1] * DEG2RAD;
  const dLat = (b[1] - a[1]) * DEG2RAD;
  const dLng = (b[0] - a[0]) * DEG2RAD;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Compass bearing 0..360 (0 = N, 90 = E) from point a to point b. */
function bearing(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG2RAD;
  const lat2 = b[1] * DEG2RAD;
  const dLng = (b[0] - a[0]) * DEG2RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = Math.atan2(y, x) * RAD2DEG;
  return (brng + 360) % 360;
}

/** Signed smallest angle from `inb` to `outb`, in (-180, 180]. + = right, - = left. */
function bearingDelta(inb: number, outb: number): number {
  return ((outb - inb + 540) % 360) - 180;
}

function quant(v: number): number {
  return Math.round(v * QUANT) / QUANT;
}

function nodeKey(lng: number, lat: number): string {
  return `${Math.round(lng * QUANT)},${Math.round(lat * QUANT)}`;
}

function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / CELL)},${Math.floor(lat / CELL)}`;
}

// ----------------------------------------------------------------- graph build

/** Build a routable graph from the road features. Call once; memoize by caller. */
export function buildRouteGraph(data: FeatureCollection): RouteGraph {
  const coords: LngLat[] = [];
  const adj: Edge[][] = [];
  const nodeIds = new Map<string, number>();
  const grid = new Map<string, number[]>();

  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;

  const getNode = (lng: number, lat: number): number => {
    const key = nodeKey(lng, lat);
    let id = nodeIds.get(key);
    if (id !== undefined) return id;
    id = coords.length;
    const q: LngLat = [quant(lng), quant(lat)];
    coords.push(q);
    adj.push([]);
    nodeIds.set(key, id);
    // spatial index
    const ck = cellKey(q[0], q[1]);
    const bucket = grid.get(ck);
    if (bucket) bucket.push(id);
    else grid.set(ck, [id]);
    // bbox
    if (q[0] < w) w = q[0];
    if (q[0] > e) e = q[0];
    if (q[1] < s) s = q[1];
    if (q[1] > n) n = q[1];
    return id;
  };

  const feats = data.features ?? [];
  for (let fi = 0; fi < feats.length; fi++) {
    const f = feats[fi] as Feature;
    const props = f.properties as Record<string, unknown> | null;
    if (!props || props.feature_type !== "road") continue;
    const geom = f.geometry as Geometry | null;
    if (!geom || geom.type !== "LineString") continue;
    const line = geom.coordinates as number[][];
    if (line.length < 2) continue;

    const name = typeof props.name === "string" ? props.name : "";
    const sp = speedFor(props.nj_class);
    const cls = typeof props.nj_class === "string" ? props.nj_class : "";
    const oneway = props.oneway === true;

    let prevId = getNode(line[0][0], line[0][1]);
    let prevCoord: LngLat = [line[0][0], line[0][1]];
    for (let i = 1; i < line.length; i++) {
      const cur: LngLat = [line[i][0], line[i][1]];
      const curId = getNode(cur[0], cur[1]);
      if (curId !== prevId) {
        const len = haversineM(prevCoord, cur);
        adj[prevId].push({ to: curId, w: len, sp, name, cls });
        if (!oneway) adj[curId].push({ to: prevId, w: len, sp, name, cls });
      }
      prevId = curId;
      prevCoord = cur;
    }
  }

  let edgeCount = 0;
  for (let i = 0; i < adj.length; i++) edgeCount += adj[i].length;

  if (coords.length === 0) {
    w = 0;
    s = 0;
    e = 0;
    n = 0;
  }

  return {
    nodeCount: coords.length,
    edgeCount,
    bbox: [w, s, e, n],
    coords,
    adj,
    grid,
    cell: CELL,
  };
}

// -------------------------------------------------------------------- snapping

/** Nearest node id to `point`, or -1 if none within MAX_SNAP_M. */
function nearestNode(graph: RouteGraph, point: LngLat): number {
  const { grid, coords } = graph;
  const gx = Math.floor(point[0] / CELL);
  const gy = Math.floor(point[1] / CELL);

  let best = -1;
  let bestD = Infinity;

  // Expand the search ring until we find candidates (and one extra ring so a
  // node just across a cell boundary isn't missed).
  for (let ring = 0; ring <= 6; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // only scan the outer shell of this ring
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const bucket = grid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const id = bucket[k];
          const d = haversineM(point, coords[id]);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    // Once we have a hit, do one more ring then stop.
    if (best !== -1 && ring >= 1) break;
  }

  if (best === -1 || bestD > MAX_SNAP_M) return -1;
  return best;
}

/** Nearest routable point on the network to a clicked coordinate. */
export function snapToNetwork(graph: RouteGraph, point: LngLat): LngLat | null {
  const id = nearestNode(graph, point);
  if (id === -1) return null;
  const c = graph.coords[id];
  return [c[0], c[1]];
}

// ------------------------------------------------------------------- min-heap

/** Binary min-heap keyed on distance; stores node ids. */
class MinHeap {
  private dist: number[] = [];
  private node: number[] = [];

  get size(): number {
    return this.dist.length;
  }

  push(d: number, id: number): void {
    const dist = this.dist;
    const node = this.node;
    let i = dist.length;
    dist.push(d);
    node.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[p] <= dist[i]) break;
      swap(dist, node, i, p);
      i = p;
    }
  }

  pop(): number {
    const dist = this.dist;
    const node = this.node;
    const top = node[0];
    const last = dist.length - 1;
    dist[0] = dist[last];
    node[0] = node[last];
    dist.pop();
    node.pop();
    const size = dist.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < size && dist[l] < dist[smallest]) smallest = l;
      if (r < size && dist[r] < dist[smallest]) smallest = r;
      if (smallest === i) break;
      swap(dist, node, i, smallest);
      i = smallest;
    }
    return top;
  }
}

function swap(a: number[], b: number[], i: number, j: number): void {
  const ta = a[i];
  a[i] = a[j];
  a[j] = ta;
  const tb = b[i];
  b[i] = b[j];
  b[j] = tb;
}

// -------------------------------------------------------------------- routing

/**
 * Dijkstra from `src` to `dst` minimizing the supplied edge cost.
 * Returns node-id path (inclusive) or null.
 */
function dijkstra(
  graph: RouteGraph,
  src: number,
  dst: number,
  cost: (ed: Edge) => number,
): number[] | null {
  const { adj } = graph;
  const nn = adj.length;
  const dist = new Float64Array(nn).fill(Infinity);
  const prev = new Int32Array(nn).fill(-1);
  const done = new Uint8Array(nn);

  dist[src] = 0;
  const heap = new MinHeap();
  heap.push(0, src);

  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    const du = dist[u];
    const edges = adj[u];
    for (let i = 0; i < edges.length; i++) {
      const ed = edges[i];
      const v = ed.to;
      if (done[v]) continue;
      const nd = du + cost(ed);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd, v);
      }
    }
  }

  if (dist[dst] === Infinity) return null;

  const path: number[] = [];
  for (let at = dst; at !== -1; at = prev[at]) {
    path.push(at);
    if (at === src) break;
  }
  path.reverse();
  if (path[0] !== src) return null;
  return path;
}

/** Find the edge (u -> v) to recover its road name/speed. */
function edgeBetween(graph: RouteGraph, u: number, v: number): Edge | null {
  const edges = graph.adj[u];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].to === v) return edges[i];
  }
  return null;
}

function compass(brng: number): string {
  const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return dirs[Math.round(brng / 45) % 8];
}

function classify(delta: number): ManeuverType {
  const a = Math.abs(delta);
  const right = delta > 0;
  if (a > 160) return "uturn";
  if (a > 135) return right ? "sharp-right" : "sharp-left";
  if (a > 45) return right ? "turn-right" : "turn-left";
  if (a >= 18) return right ? "slight-right" : "slight-left";
  return "straight";
}

function instructionFor(type: ManeuverType, roadName: string, bearingAfter: number): string {
  const onto = roadName ? ` onto ${roadName}` : "";
  switch (type) {
    case "depart":
      return roadName ? `Head ${compass(bearingAfter)} on ${roadName}` : `Head ${compass(bearingAfter)}`;
    case "arrive":
      return "Arrive at your destination";
    case "straight":
      return roadName ? `Continue onto ${roadName}` : "Continue straight";
    case "slight-left":
      return `Slight left${onto}`;
    case "slight-right":
      return `Slight right${onto}`;
    case "turn-left":
      return `Turn left${onto}`;
    case "turn-right":
      return `Turn right${onto}`;
    case "sharp-left":
      return `Sharp left${onto}`;
    case "sharp-right":
      return `Sharp right${onto}`;
    case "uturn":
      return roadName ? `Make a U-turn onto ${roadName}` : "Make a U-turn";
  }
}

/**
 * Snap `from`/`to` to the nearest graph node and return the shortest route,
 * or null if either point can't be snapped or no path exists.
 */
export function findRoute(
  graph: RouteGraph,
  from: LngLat,
  to: LngLat,
  opts: RouteOptions = {},
): NavRoute | null {
  const useTraffic = opts.traffic !== false;
  const now = opts.now ?? new Date();
  // Edge cost = traffic-adjusted travel time (seconds). Routing on time (not
  // raw distance) is what makes this pick the *fastest* route and avoid
  // congested arterials at peak.
  const cost = (ed: Edge): number => {
    const factor = useTraffic ? trafficFactor(ed.cls, now) : 1;
    return ed.w / (ed.sp * factor);
  };

  const src = nearestNode(graph, from);
  const dst = nearestNode(graph, to);
  if (src === -1 || dst === -1) return null;

  if (src === dst) {
    const c = graph.coords[src];
    const loc: LngLat = [c[0], c[1]];
    return {
      coordinates: [loc],
      distanceM: 0,
      durationS: 0,
      freeflowDurationS: 0,
      trafficDelayS: 0,
      trafficLevel: "light",
      steps: [
        {
          type: "depart",
          instruction: "Head to your destination",
          roadName: "",
          location: loc,
          distanceM: 0,
          bearingBefore: 0,
          bearingAfter: 0,
        },
        {
          type: "arrive",
          instruction: "Arrive at your destination",
          roadName: "",
          location: loc,
          distanceM: 0,
          bearingBefore: 0,
          bearingAfter: 0,
        },
      ],
    };
  }

  const path = dijkstra(graph, src, dst, cost);
  if (!path || path.length < 2) return null;

  const k = path.length - 1; // number of segments

  // Per-segment geometry / attributes.
  const segLen: number[] = new Array(k);
  const segBrg: number[] = new Array(k);
  const segName: string[] = new Array(k);
  let totalDist = 0;
  let totalDur = 0; // traffic-adjusted
  let freeflowDur = 0;
  const polyline: LngLat[] = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    const c = graph.coords[path[i]];
    polyline[i] = [c[0], c[1]];
  }
  for (let i = 0; i < k; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const len = haversineM(a, b);
    const ed = edgeBetween(graph, path[i], path[i + 1]);
    const sp = ed ? ed.sp : DEFAULT_SPEED;
    const factor = useTraffic ? trafficFactor(ed ? ed.cls : "", now) : 1;
    segLen[i] = len;
    segBrg[i] = bearing(a, b);
    segName[i] = ed ? ed.name : "";
    totalDist += len;
    freeflowDur += len / sp;
    totalDur += len / (sp * factor);
  }
  const trafficDelayS = Math.max(0, totalDur - freeflowDur);
  const ratio = freeflowDur > 0 ? totalDur / freeflowDur : 1;
  const trafficLevel: TrafficLevel = ratio > 1.4 ? "heavy" : ratio > 1.15 ? "moderate" : "light";

  // Determine maneuver segment-start indices (where each step begins).
  // depart begins at segment 0; a maneuver at interior node i begins at segment i.
  const startSeg: number[] = [0];
  for (let i = 1; i < k; i++) {
    const nameChanged = segName[i] !== segName[i - 1];
    const delta = bearingDelta(segBrg[i - 1], segBrg[i]);
    if (nameChanged || Math.abs(delta) > 18) {
      startSeg.push(i);
    }
  }

  const steps: Maneuver[] = [];

  // depart
  {
    const loc = polyline[0];
    steps.push({
      type: "depart",
      instruction: instructionFor("depart", segName[0], segBrg[0]),
      roadName: segName[0],
      location: [loc[0], loc[1]],
      distanceM: 0, // filled below
      bearingBefore: segBrg[0],
      bearingAfter: segBrg[0],
    });
  }

  // interior maneuvers (skip startSeg[0] == 0, that's depart)
  for (let m = 1; m < startSeg.length; m++) {
    const segIdx = startSeg[m];
    const inb = segBrg[segIdx - 1];
    const outb = segBrg[segIdx];
    const delta = bearingDelta(inb, outb);
    let type = classify(delta);
    // Pure name change while going straight -> "Continue onto <new road>".
    if (type === "straight" && segName[segIdx] === segName[segIdx - 1]) {
      // no real change; shouldn't happen since we only push on change, but guard
      type = "straight";
    }
    const loc = polyline[segIdx];
    steps.push({
      type,
      instruction: instructionFor(type, segName[segIdx], outb),
      roadName: segName[segIdx],
      location: [loc[0], loc[1]],
      distanceM: 0, // filled below
      bearingBefore: inb,
      bearingAfter: outb,
    });
  }

  // arrive
  {
    const loc = polyline[polyline.length - 1];
    const lastBrg = segBrg[k - 1];
    steps.push({
      type: "arrive",
      instruction: instructionFor("arrive", "", lastBrg),
      roadName: "",
      location: [loc[0], loc[1]],
      distanceM: 0,
      bearingBefore: lastBrg,
      bearingAfter: lastBrg,
    });
  }

  // distanceM of each step = summed segment length from this step's start
  // segment up to (but excluding) the next step's start segment.
  for (let m = 0; m < startSeg.length; m++) {
    const from = startSeg[m];
    const upto = m + 1 < startSeg.length ? startSeg[m + 1] : k;
    let d = 0;
    for (let i = from; i < upto; i++) d += segLen[i];
    steps[m].distanceM = d; // steps[m] aligns with startSeg[m]; last (arrive) stays 0
  }
  // arrive step is the final one; ensure its distance is 0.
  steps[steps.length - 1].distanceM = 0;

  return {
    coordinates: polyline,
    distanceM: totalDist,
    durationS: totalDur,
    freeflowDurationS: freeflowDur,
    trafficDelayS,
    trafficLevel,
    steps,
  };
}
