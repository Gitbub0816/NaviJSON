"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import styles from "./map.module.css";

type LightPreset = "day" | "dawn" | "dusk";
type MapboxMap = import("mapbox-gl").Map;

const VIEW_BOUNDS = {
  west: -121.904,
  east: -121.872,
  south: 37.323,
  north: 37.349,
};

const PRESET_COLORS: Record<LightPreset, { land: string; road: string; building: string }> = {
  day: { land: "#eef0eb", road: "#ffffff", building: "#e2e1dc" },
  dawn: { land: "#eee9e2", road: "#fffaf4", building: "#dfd8d1" },
  dusk: { land: "#e3e3e6", road: "#f8f7f8", building: "#d4d3d8" },
};

function featureKind(feature: Feature<Geometry>) {
  return String(feature.properties?.feature_type ?? "");
}

function CanvasMap({ preset, onZoom }: { preset: LightPreset; onZoom: (delta: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<FeatureCollection | null>(null);
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [ready, setReady] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return;

    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = bounds.width;
    const height = bounds.height;
    const view = viewRef.current;
    const palette = PRESET_COLORS[preset];

    const project = ([lng, lat]: number[]) => {
      const baseX = ((lng - VIEW_BOUNDS.west) / (VIEW_BOUNDS.east - VIEW_BOUNDS.west)) * width;
      const baseY = (1 - (lat - VIEW_BOUNDS.south) / (VIEW_BOUNDS.north - VIEW_BOUNDS.south)) * height;
      return [
        (baseX - width / 2) * view.zoom + width / 2 + view.x,
        (baseY - height / 2) * view.zoom + height / 2 + view.y,
      ];
    };

    const pathGeometry = (geometry: Geometry) => {
      const sequences: number[][][] = geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "Polygon"
          ? geometry.coordinates
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : geometry.type === "MultiPolygon"
              ? geometry.coordinates.flat()
              : [];
      ctx.beginPath();
      sequences.forEach((line) => {
        line.forEach((coordinate, index) => {
          const [x, y] = project(coordinate);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") ctx.closePath();
      });
    };

    ctx.fillStyle = palette.land;
    ctx.fillRect(0, 0, width, height);

    const byKind = (kind: string) => data.features.filter((feature) => featureKind(feature) === kind);
    const fillFeatures = (kind: string, color: string) => {
      ctx.fillStyle = color;
      byKind(kind).forEach((feature) => {
        pathGeometry(feature.geometry);
        ctx.fill();
      });
    };

    fillFeatures("park", "#dcebd7");
    fillFeatures("water", "#a9d9ef");
    fillFeatures("building", palette.building);

    const strokeFeatures = (kind: string, color: string, widthPx: number, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx * view.zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(dash.map((value) => value * view.zoom));
      byKind(kind).forEach((feature) => {
        pathGeometry(feature.geometry);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    };

    strokeFeatures("motorway", "#e4c874", 19);
    strokeFeatures("motorway", "#fff1b6", 13);
    strokeFeatures("primary", "#cfd0cb", 13);
    strokeFeatures("primary", palette.road, 9);
    strokeFeatures("street", "#d9d9d5", 8);
    strokeFeatures("street", palette.road, 5.5);
    strokeFeatures("lane_divider", "rgba(141, 139, 128, .62)", 1.2, [4, 5]);
    strokeFeatures("route", "rgba(255,255,255,.92)", 10);
    strokeFeatures("route", "#1677ff", 6.5);

    byKind("crosswalk").forEach((feature) => {
      pathGeometry(feature.geometry);
      ctx.strokeStyle = "rgba(112, 116, 116, .8)";
      ctx.lineWidth = 4 * view.zoom;
      ctx.setLineDash([1.4 * view.zoom, 2.4 * view.zoom]);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    byKind("signal").forEach((feature) => {
      if (feature.geometry.type !== "Point") return;
      const [x, y] = project(feature.geometry.coordinates);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "rgba(25,38,43,.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.25, 0, Math.PI * 2);
      ctx.fillStyle = "#1ea66c";
      ctx.fill();
    });

    const labels = [
      ["San José", -121.8883, 37.3376, 21, 650],
      ["Guadalupe River", -121.9005, 37.3407, 11, 520],
      ["Santa Clara St", -121.8874, 37.3355, 11, 540],
      ["Market St", -121.8891, 37.3315, 10, 520],
      ["Plaza de César Chávez", -121.8895, 37.3323, 10, 560],
    ] as const;
    labels.forEach(([label, lng, lat, fontSize, weight]) => {
      const [x, y] = project([lng, lat]);
      ctx.font = `${weight} ${fontSize}px var(--font-geist-sans), sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.strokeText(label, x, y);
      ctx.fillStyle = label === "Guadalupe River" ? "#3a7c9d" : "#394247";
      ctx.fillText(label, x, y);
    });

    const routeStart = project([-121.8976, 37.3407]);
    ctx.beginPath();
    ctx.arc(routeStart[0], routeStart[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = "#1677ff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }, [preset]);

  useEffect(() => {
    fetch("/maps/GeoJSON/A_M-light/features.geojson")
      .then((response) => response.json())
      .then((data: FeatureCollection) => {
        dataRef.current = data;
        setReady(true);
        draw();
      });
  }, [draw]);

  useEffect(() => {
    if (!ready) return;
    draw();
    const resize = () => draw();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw, ready]);

  const adjustZoom = useCallback((delta: number) => {
    viewRef.current.zoom = Math.max(0.82, Math.min(2.8, viewRef.current.zoom + delta));
    onZoom(delta);
    draw();
  }, [draw, onZoom]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-label="Interactive preview of downtown San José"
      onWheel={(event) => {
        event.preventDefault();
        adjustZoom(event.deltaY < 0 ? 0.12 : -0.12);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, originX: viewRef.current.x, originY: viewRef.current.y };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        viewRef.current.x = dragRef.current.originX + event.clientX - dragRef.current.x;
        viewRef.current.y = dragRef.current.originY + event.clientY - dragRef.current.y;
        draw();
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onDoubleClick={() => adjustZoom(0.22)}
    />
  );
}

export function NaviMap({ mapboxToken }: { mapboxToken: string }) {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [preset, setPreset] = useState<LightPreset>("day");
  const [mapReady, setMapReady] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [, setZoomPulse] = useState(0);

  useEffect(() => {
    if (!mapboxToken || !mapNodeRef.current) return;
    let active = true;

    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (!active || !mapNodeRef.current) return;
      mapboxgl.accessToken = mapboxToken;
      const map = new mapboxgl.Map({
        container: mapNodeRef.current,
        style: "/maps/GeoJSON/A_M-light/style.json",
        center: [-121.8906, 37.3374],
        zoom: 14.7,
        pitch: 44,
        bearing: -18,
        antialias: true,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      map.once("load", () => setMapReady(true));
      mapRef.current = map;
    });

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

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
          {mapboxToken ? "Mapbox live" : "No-key preview"}
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
          <p className={styles.eyebrow}>Downtown San José</p>
          <h1>California, in a clearer light.</h1>
          <p className={styles.cardCopy}>
            A calm, high-clarity map with lane-level GeoJSON detail, warm land tones, soft water, and an intentional road hierarchy.
          </p>
          <div className={styles.routeSummary}>
            <div><strong>8 min</strong><span>2.4 mi</span></div>
            <div className={styles.routeLine}><i /><span /></div>
            <button>Directions <b>›</b></button>
          </div>
          <div className={styles.featureRow}>
            <span>Lane paint</span><span>Signals</span><span>3D ready</span>
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
