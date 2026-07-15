"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./map.module.css";

// Minimal GeoJSON typings (the `geojson` type package is not installed here).
type Position = number[];
type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };
type FeatureProps = { [key: string]: unknown } | null;
type Feature = { type: "Feature"; geometry: Geometry; properties: FeatureProps };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

type LightPreset = "day" | "dawn" | "dusk";
type MapboxMap = import("mapbox-gl").Map;

const DATA_URL = "/maps/GeoJSON/A_M-light/features.geojson";

// Fallback bounds (metadata `navijson:bbox`) if the collection carries no coords.
const FALLBACK_BOUNDS = {
  west: -121.914684,
  south: 37.243889,
  east: -121.867227,
  north: 37.362245,
};

const PRESET_COLORS: Record<LightPreset, { land: string; road: string; building: string }> = {
  day: { land: "#eef0eb", road: "#ffffff", building: "#e4e3dd" },
  dawn: { land: "#eee9e2", road: "#fffaf4", building: "#e2dbd3" },
  dusk: { land: "#e3e3e6", road: "#f6f5f7", building: "#d7d6db" },
};

const LANDUSE_FILL: Record<string, string> = {
  residential: "rgba(226,227,220,.55)",
  commercial: "rgba(232,228,222,.6)",
  retail: "rgba(234,226,222,.6)",
  industrial: "rgba(226,226,229,.6)",
  construction: "rgba(230,226,214,.55)",
  railway: "rgba(226,224,224,.5)",
};

type Bounds = { west: number; south: number; east: number; north: number };

// A parsed feature keeps its geometry plus a cached geo-bbox for viewport culling.
type Parsed = {
  geometry: Geometry;
  bbox: [number, number, number, number]; // west, south, east, north
  rank: number;
  motorway: boolean;
  marking: string;
  cls: string; // nj_class, used for landuse tint / lane split
};

type Buckets = {
  landuse: Parsed[];
  park: Parsed[];
  water: Parsed[];
  pedestrian: Parsed[];
  waterway: Parsed[];
  roadTunnel: Parsed[];
  roadGround: Parsed[];
  roadBridge: Parsed[];
  rail: Parsed[];
  laneCenter: Parsed[]; // double-yellow centerlines
  laneLine: Parsed[]; // white dashed lane lines
  sidewalk: Parsed[];
  path: Parsed[];
  cycleway: Parsed[];
  crossing: Parsed[];
  building: Parsed[];
  signal: Parsed[];
  stopSign: Parsed[];
  trafficSign: Parsed[];
  streetLamp: Parsed[];
  route: Parsed[];
};

function emptyBuckets(): Buckets {
  return {
    landuse: [], park: [], water: [], pedestrian: [], waterway: [],
    roadTunnel: [], roadGround: [], roadBridge: [], rail: [],
    laneCenter: [], laneLine: [], sidewalk: [], path: [], cycleway: [],
    crossing: [], building: [], signal: [], stopSign: [], trafficSign: [],
    streetLamp: [], route: [],
  };
}

// Flatten any geometry into coordinate rings so we can bbox / draw uniformly.
function eachRing(geometry: Geometry, fn: (ring: number[][]) => void) {
  switch (geometry.type) {
    case "LineString":
      fn(geometry.coordinates);
      break;
    case "MultiLineString":
    case "Polygon":
      geometry.coordinates.forEach(fn);
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((poly) => poly.forEach(fn));
      break;
    default:
      break;
  }
}

function geoBBox(geometry: Geometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const consume = (lng: number, lat: number) => {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  };
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    consume(lng, lat);
  } else {
    eachRing(geometry, (ring) => ring.forEach(([lng, lat]) => consume(lng, lat)));
  }
  return [w, s, e, n];
}

function parseFeatures(collection: FeatureCollection): { buckets: Buckets; bounds: Bounds } {
  const b = emptyBuckets();
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;

  for (const feature of collection.features) {
    const props = feature.properties ?? {};
    const type = String(props.feature_type ?? "");
    const bbox = geoBBox(feature.geometry);
    if (Number.isFinite(bbox[0])) {
      if (bbox[0] < w) w = bbox[0];
      if (bbox[1] < s) s = bbox[1];
      if (bbox[2] > e) e = bbox[2];
      if (bbox[3] > n) n = bbox[3];
    }
    const parsed: Parsed = {
      geometry: feature.geometry,
      bbox,
      rank: typeof props.rank === "number" ? props.rank : 0,
      motorway: props.nj_class === "motorway" || props.nj_class === "motorway_link",
      marking: String(props.marking ?? ""),
      cls: String(props.nj_class ?? ""),
    };

    switch (type) {
      case "landuse": b.landuse.push(parsed); break;
      case "park": b.park.push(parsed); break;
      case "water": b.water.push(parsed); break;
      case "pedestrian_area": b.pedestrian.push(parsed); break;
      case "waterway": b.waterway.push(parsed); break;
      case "road":
        if (props.tunnel) b.roadTunnel.push(parsed);
        else if (props.bridge || (typeof props.layer === "number" && props.layer > 0)) b.roadBridge.push(parsed);
        else b.roadGround.push(parsed);
        break;
      case "rail": b.rail.push(parsed); break;
      case "lane_divider":
        if (parsed.marking === "double_yellow" || props.nj_class === "centerline") b.laneCenter.push(parsed);
        else b.laneLine.push(parsed);
        break;
      case "sidewalk": b.sidewalk.push(parsed); break;
      case "path": b.path.push(parsed); break;
      case "cycleway": b.cycleway.push(parsed); break;
      case "crosswalk":
      case "crossing": b.crossing.push(parsed); break;
      case "building": b.building.push(parsed); break;
      case "signal": b.signal.push(parsed); break;
      case "stop_sign": b.stopSign.push(parsed); break;
      case "traffic_sign": b.trafficSign.push(parsed); break;
      case "street_lamp": b.streetLamp.push(parsed); break;
      case "route": b.route.push(parsed); break;
      default: break;
    }
  }

  // Draw casing/fill in rank order so arterials layer on top of local streets.
  const byRank = (x: Parsed, y: Parsed) => x.rank - y.rank;
  b.roadGround.sort(byRank);
  b.roadBridge.sort(byRank);
  b.roadTunnel.sort(byRank);

  const bounds: Bounds = Number.isFinite(w)
    ? { west: w, south: s, east: e, north: n }
    : { ...FALLBACK_BOUNDS };
  return { buckets: b, bounds };
}

// Fill width (px, at view.zoom 1) for a road rank. Casing adds a margin on top.
function roadFillWidth(rank: number): number {
  switch (rank) {
    case 8: return 6.4; // motorway
    case 7: return 4.6; // trunk / motorway_link
    case 6: return 4.8; // primary
    case 5: return 3.9; // secondary
    case 4: return 3.0; // tertiary
    case 2: return 2.1; // residential
    case 1: return 1.4; // service
    default: return 2.2;
  }
}

function CanvasMap({ preset, onZoom }: { preset: LightPreset; onZoom: (delta: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bucketsRef = useRef<Buckets | null>(null);
  const boundsRef = useRef<Bounds>({ ...FALLBACK_BOUNDS });
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const presetRef = useRef<LightPreset>(preset);
  const [ready, setReady] = useState(false);

  const draw = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const buckets = bucketsRef.current;
    if (!canvas || !buckets) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = rect.width;
    const height = rect.height;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const view = viewRef.current;
    const zoom = view.zoom;
    const palette = PRESET_COLORS[presetRef.current];
    const bounds = boundsRef.current;

    // Aspect-preserving fit: project lng/lat to a local plane (cos-lat corrected),
    // then scale that plane to fit the canvas with padding.
    const centerLat = (bounds.south + bounds.north) / 2;
    const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
    const planeW = Math.max((bounds.east - bounds.west) * cosLat, 1e-6);
    const planeH = Math.max(bounds.north - bounds.south, 1e-6);
    const pad = Math.min(width, height) * 0.05 + 12;
    const fit = Math.min((width - pad * 2) / planeW, (height - pad * 2) / planeH);
    const offX = (width - planeW * fit) / 2;
    const offY = (height - planeH * fit) / 2;

    const project = (lng: number, lat: number): [number, number] => {
      const baseX = (lng - bounds.west) * cosLat * fit + offX;
      const baseY = (bounds.north - lat) * fit + offY;
      return [
        (baseX - width / 2) * zoom + width / 2 + view.x,
        (baseY - height / 2) * zoom + height / 2 + view.y,
      ];
    };

    // Screen-space bbox of a feature (from its cached geo-bbox) for cheap culling.
    const onScreen = (bbox: [number, number, number, number]): boolean => {
      const [ax, ay] = project(bbox[0], bbox[3]);
      const [bx, by] = project(bbox[2], bbox[1]);
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      return maxX >= -8 && minX <= width + 8 && maxY >= -8 && minY <= height + 8;
    };

    const trace = (geometry: Geometry) => {
      ctx.beginPath();
      eachRing(geometry, (ring) => {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = project(ring[i][0], ring[i][1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") ctx.closePath();
      });
    };

    const fillEach = (items: Parsed[], color: string) => {
      ctx.fillStyle = color;
      for (const it of items) {
        if (!onScreen(it.bbox)) continue;
        trace(it.geometry);
        ctx.fill();
      }
    };

    const strokeEach = (items: Parsed[], color: string, w: number, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(w * zoom, 0.35);
      ctx.setLineDash(dash.length ? dash.map((d) => d * zoom) : []);
      for (const it of items) {
        if (!onScreen(it.bbox)) continue;
        trace(it.geometry);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    // Casing pass, then fill pass, so intersections read as continuous carriageway.
    const drawRoads = (items: Parsed[], opts: { shadow?: boolean } = {}) => {
      if (opts.shadow) {
        ctx.strokeStyle = "rgba(35,44,49,.22)";
        for (const it of items) {
          if (!onScreen(it.bbox)) continue;
          ctx.lineWidth = (roadFillWidth(it.rank) + 4.6) * zoom;
          trace(it.geometry);
          ctx.stroke();
        }
      }
      // Casing
      for (const it of items) {
        if (!onScreen(it.bbox)) continue;
        ctx.strokeStyle = it.motorway ? "#e7cf86" : "#cfd2cb";
        ctx.lineWidth = (roadFillWidth(it.rank) + 2.2) * zoom;
        trace(it.geometry);
        ctx.stroke();
      }
      // Fill
      for (const it of items) {
        if (!onScreen(it.bbox)) continue;
        ctx.strokeStyle = it.motorway ? "#fbe9a8" : palette.road;
        ctx.lineWidth = roadFillWidth(it.rank) * zoom;
        trace(it.geometry);
        ctx.stroke();
      }
    };

    // --- background land ---
    ctx.fillStyle = palette.land;
    ctx.fillRect(0, 0, width, height);

    // --- fills: landuse (per-class tint) -> park -> pedestrian -> water ---
    for (const it of buckets.landuse) {
      if (!onScreen(it.bbox)) continue;
      trace(it.geometry);
      ctx.fillStyle = LANDUSE_FILL[it.cls] ?? "rgba(228,228,222,.5)";
      ctx.fill();
    }

    fillEach(buckets.park, "#d9e9d2");
    fillEach(buckets.pedestrian, "rgba(226,224,218,.7)");
    fillEach(buckets.water, "#aad8ef");
    strokeEach(buckets.waterway, "#8fc7e6", 1.6);

    // --- tunnel roads: dashed + dimmed, beneath everything ---
    ctx.globalAlpha = 0.5;
    strokeEach(buckets.roadTunnel, "#c8cbc4", 3, [6, 5]);
    ctx.globalAlpha = 1;

    // --- ground roads ---
    drawRoads(buckets.roadGround);

    // --- rail ---
    strokeEach(buckets.rail, "#b6b8b8", 1.6);
    strokeEach(buckets.rail, "#8d9092", 1.6, [1.5, 6]);

    // --- bridge / elevated roads with a drop shadow so overpasses read raised ---
    drawRoads(buckets.roadBridge, { shadow: true });

    // --- ROAD PAINT (lane markings) — clearly visible when zoomed in ---
    if (zoom >= 1.05) {
      // double-yellow centerline: 1.6px #f2c14e
      strokeEach(buckets.laneCenter, "#f2c14e", 1.6);
      // white dashed lane lines
      strokeEach(buckets.laneLine, "rgba(255,255,255,.92)", 1.1, [3.4, 4.2]);
    }

    // --- pedestrian network ---
    strokeEach(buckets.sidewalk, "rgba(150,154,150,.5)", 0.8);
    strokeEach(buckets.path, "rgba(139,142,136,.72)", 1, [2.6, 3]);
    strokeEach(buckets.cycleway, "rgba(90,150,120,.7)", 1.1, [5, 3]);

    // --- crossings (paint at pedestrian crossings) ---
    if (zoom >= 1.4) {
      ctx.fillStyle = "rgba(120,124,124,.7)";
      for (const it of buckets.crossing) {
        if (it.geometry.type === "Point") {
          if (!onScreen(it.bbox)) continue;
          const [x, y] = project(it.geometry.coordinates[0], it.geometry.coordinates[1]);
          ctx.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);
        } else {
          strokeEach([it], "rgba(120,124,124,.75)", 3.5, [1.4, 2.2]);
        }
      }
    }

    // --- buildings: subtle light footprints ---
    ctx.strokeStyle = "rgba(120,124,120,.18)";
    ctx.lineWidth = 0.6;
    for (const it of buckets.building) {
      if (!onScreen(it.bbox)) continue;
      trace(it.geometry);
      ctx.fillStyle = palette.building;
      ctx.fill();
      if (zoom >= 1.3) ctx.stroke();
    }

    // --- point markers ---
    const drawDots = (items: Parsed[], radius: number, fill: string, ring?: string) => {
      for (const it of items) {
        if (it.geometry.type !== "Point") continue;
        if (!onScreen(it.bbox)) continue;
        const [x, y] = project(it.geometry.coordinates[0], it.geometry.coordinates[1]);
        if (ring) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 1.1, 0, Math.PI * 2);
          ctx.fillStyle = ring;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };

    if (zoom >= 1.55) {
      drawDots(buckets.streetLamp, 1.4, "#f4c86a"); // light poles
    }
    if (zoom >= 1.25) {
      drawDots(buckets.trafficSign, 2, "#e8a13c", "rgba(255,255,255,.92)"); // amber
      drawDots(buckets.stopSign, 2.1, "#d94b3f", "rgba(255,255,255,.92)"); // red
      drawDots(buckets.signal, 2.2, "#1ea66c", "rgba(255,255,255,.92)"); // green
    }

    // --- optional route overlay ---
    strokeEach(buckets.route, "rgba(255,255,255,.92)", 6);
    strokeEach(buckets.route, "#1677ff", 3.6);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    let active = true;
    fetch(DATA_URL)
      .then((response) => response.json())
      .then((data: FeatureCollection) => {
        if (!active) return;
        const { buckets, bounds } = parseFeatures(data);
        bucketsRef.current = buckets;
        boundsRef.current = bounds;
        setReady(true);
      })
      .catch(() => {
        /* keep the calm empty canvas on failure */
      });
    return () => {
      active = false;
    };
  }, []);

  // Redraw on ready, preset change, and resize (all coalesced through rAF).
  useEffect(() => {
    presetRef.current = preset;
    if (!ready) return;
    scheduleDraw();
    const resize = () => scheduleDraw();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [ready, preset, scheduleDraw]);

  const adjustZoom = useCallback((delta: number) => {
    viewRef.current.zoom = Math.max(0.7, Math.min(9, viewRef.current.zoom + delta * viewRef.current.zoom));
    onZoom(delta);
    scheduleDraw();
  }, [onZoom, scheduleDraw]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-label="Interactive keyless preview of downtown San José and the I-280/CA-87 interchange, with lane paint, light poles and grade-separated overpasses"
      onWheel={(event) => {
        event.preventDefault();
        adjustZoom(event.deltaY < 0 ? 0.16 : -0.16);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, originX: viewRef.current.x, originY: viewRef.current.y };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        viewRef.current.x = dragRef.current.originX + event.clientX - dragRef.current.x;
        viewRef.current.y = dragRef.current.originY + event.clientY - dragRef.current.y;
        scheduleDraw();
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onDoubleClick={() => adjustZoom(0.3)}
    />
  );
}

export function NaviMap({ mapboxToken, tilesetUrl = "" }: { mapboxToken: string; tilesetUrl?: string }) {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [preset, setPreset] = useState<LightPreset>("day");
  const [mapReady, setMapReady] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [, setZoomPulse] = useState(0);
  const statewide = Boolean(tilesetUrl);

  useEffect(() => {
    if (!mapboxToken || !mapNodeRef.current) return;
    let active = true;

    (async () => {
      const { default: mapboxgl } = await import("mapbox-gl");
      if (!active || !mapNodeRef.current) return;
      mapboxgl.accessToken = mapboxToken;

      // Default: render the committed GeoJSON sample. When a statewide tileset
      // is configured, load the vector-tile style variant and point its source
      // at the tileset (a Mapbox-hosted `mapbox://user.id` tileset, a TileJSON
      // URL, or a `pmtiles://…` URL served from R2/S3).
      let style: string | object = "/maps/GeoJSON/A_M-light/style.json";
      let initialZoom = 14.7;
      if (tilesetUrl) {
        try {
          if (tilesetUrl.startsWith("pmtiles://")) {
            const { Protocol } = await import("pmtiles");
            const protocol = new Protocol();
            // pmtiles ships a MapLibre/Mapbox-compatible protocol handler.
            mapboxgl.addProtocol("pmtiles", protocol.tile as never);
          }
          const response = await fetch("/maps/GeoJSON/A_M-light/style-statewide.json");
          const statewideStyle = (await response.json()) as {
            sources: Record<string, { url?: string }>;
          };
          statewideStyle.sources["navijson-reality"].url = tilesetUrl;
          style = statewideStyle;
          initialZoom = 9;
        } catch (error) {
          console.error("NaviJSON: statewide tileset style failed to load; using sample.", error);
        }
      }
      if (!active || !mapNodeRef.current) return;

      const map = new mapboxgl.Map({
        container: mapNodeRef.current,
        style: style as never,
        center: [-121.8906, 37.3374],
        zoom: initialZoom,
        pitch: 44,
        bearing: -18,
        antialias: true,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      map.once("load", () => setMapReady(true));
      mapRef.current = map;
    })();

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, tilesetUrl]);

  const selectPreset = (nextPreset: LightPreset) => {
    setPreset(nextPreset);
    const map = mapRef.current;
    if (map) {
      try {
        map.setConfigProperty("basemap", "lightPreset", nextPreset);
      } catch {
        // Local style previews remain usable if a renderer lacks import config support.
      }
    }
  };

  return (
    <main className={`${styles.shell} ${styles[preset]}`}>
      <div className={styles.mapStage}>
        {!mapboxToken && <CanvasMap preset={preset} onZoom={() => setZoomPulse((value) => value + 1)} />}
        {mapboxToken && <div ref={mapNodeRef} className={styles.mapbox} aria-label="NaviJSON Mapbox map" />}
        {mapboxToken && !mapReady && <div className={styles.loading}>Loading California Light…</div>}
      </div>

      <header className={styles.topbar}>
        <a className={styles.brand} href="/maps/GeoJSON/A_M-light" aria-label="NaviJSON California Light home">
          <span className={styles.brandMark}>N</span>
          <span><strong>NaviJSON</strong><small>California Light</small></span>
        </a>

        <div className={styles.search} role="search">
          <span className={styles.searchIcon}>⌕</span>
          <input aria-label="Search the map" placeholder="Search California" />
          <kbd>⌘ K</kbd>
        </div>

        <div className={styles.statusPill}>
          <span className={styles.statusDot} />
          {statewide ? "Statewide tileset" : mapboxToken ? "Mapbox live" : "No-key preview"}
        </div>
      </header>

      <aside className={styles.tools} aria-label="Map tools">
        <button aria-label="Locate me" title="Locate me">⌖</button>
        <span />
        <button aria-label="Map layers" title="Map layers">▱</button>
      </aside>

      <div className={styles.preset} aria-label="Lighting preset">
        {(["dawn", "day", "dusk"] as LightPreset[]).map((option) => (
          <button
            key={option}
            className={preset === option ? styles.activePreset : ""}
            onClick={() => selectPreset(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {detailOpen && (
        <section className={styles.placeCard} aria-label="Selected place">
          <button className={styles.closeCard} aria-label="Close details" onClick={() => setDetailOpen(false)}>×</button>
          <p className={styles.eyebrow}>Downtown San José + I-280/CA-87 interchange</p>
          <h1>The real map, in a clearer light.</h1>
          <p className={styles.cardCopy}>
            ~16,000 live OpenStreetMap features rendered keyless on canvas: painted lane
            markings, light poles, signals and stop signs, water and parks, plus
            grade-separated freeway overpasses. Zoom in to see the road paint.
          </p>
          <div className={styles.routeSummary}>
            <div><strong>8 min</strong><span>2.4 mi</span></div>
            <div className={styles.routeLine}><i /><span /></div>
            <button>Directions <b>›</b></button>
          </div>
          <div className={styles.featureRow}>
            <span>Lane paint</span><span>Light poles</span><span>Overpasses</span>
          </div>
        </section>
      )}

      {!detailOpen && (
        <button className={styles.reopenCard} onClick={() => setDetailOpen(true)}>Explore the style</button>
      )}

      <footer className={styles.footer}>
        <a href="/maps/GeoJSON/A_M-light/style.json">Style JSON</a>
        <a href="/maps/GeoJSON/A_M-light/features.geojson">GeoJSON</a>
        <span>Apple-inspired, independently designed</span>
      </footer>
    </main>
  );
}
