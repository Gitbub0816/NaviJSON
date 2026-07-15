# NaviJSON feature schema (A_M-light Reality Layer)

The served `features.geojson` is a GeoJSON `FeatureCollection`. Every feature is
produced by `scripts/pipeline/` from OpenStreetMap (ODbL) and carries a common
provenance envelope plus feature-type-specific fields. This document is the
contract shared by the data pipeline, the Mapbox `style.json`, the keyless
canvas renderer, and the test suite. **Change it here first.**

## Provenance envelope (every feature)

| Property | Type | Notes |
| --- | --- | --- |
| `feature_type` | string | Primary render category (see table below). |
| `nj_class` | string | Sub-class within the category (e.g. road `nj_class:"motorway"`). |
| `source` | string | Always `"openstreetmap"` for pipeline output. |
| `source_ref` | string | OSM element ref, e.g. `"way/78135425"`. |
| `license` | string | `"ODbL"`. |
| `confidence` | number | 0–1. Surveyed geometry ≈0.9; inferred/derived ≈0.6–0.7. |
| `observed` | string | OSM base timestamp (ISO 8601) when applicable. |
| `region` | string | Committed region id the feature came from. |

Optional common fields: `name`, `ref`, `layer` (int, grade level), `bridge`
(bool), `tunnel` (bool).

## Feature types

| `feature_type` | Geometry | Key extra properties | Render intent |
| --- | --- | --- | --- |
| `road` | LineString | `nj_class`, `rank` (1–8), `lanes`, `oneway`, `layer`, `bridge`, `tunnel`, `surface`, `maxspeed`, `length_m` | Casing + fill, width by `rank`, ordered by `layer`. |
| `lane_divider` | LineString | `nj_class` (`centerline`\|`lane_line`), `marking` (`double_yellow`\|`white_dashed`), `road_class`, `parent_ref`, `derived:true` | **Road paint** — painted lane markings. |
| `crosswalk` | LineString | — | Zebra paint at crossings. |
| `crossing` | Point | `nj_class` (crossing type) | Pedestrian crossing marker. |
| `sidewalk` | LineString | `layer`, `bridge`, `tunnel` | Thin walkway line. |
| `path` | LineString | `nj_class` (`footway`\|`path`\|`steps`\|`track`…) | Dashed trail. |
| `cycleway` | LineString | `nj_class` | Bike route line. |
| `rail` | LineString | `nj_class` (`rail`\|`tram`\|`light_rail`…), `layer`, `bridge`, `tunnel` | Rail line with tie hatching. |
| `waterway` | LineString | `nj_class` (`river`\|`stream`\|`canal`…) | Water line. |
| `water` | Polygon | `nj_class` | Water fill. |
| `park` | Polygon | `nj_class` | Green fill. |
| `landuse` | Polygon | `nj_class` (`residential`\|`commercial`\|`industrial`…) | Muted land tint. |
| `pedestrian_area` | Polygon | `nj_class` | Plaza fill. |
| `building` | Polygon | `height` (m), `nj_class` | 3D extrusion / footprint. |
| `signal` | Point | — | Traffic-signal dot. |
| `stop_sign` | Point | — | Stop-sign marker. |
| `traffic_sign` | Point | `nj_class` (`give_way`, sign code) | Road-sign marker. |
| `street_lamp` | Point | — | **Light pole** marker. |
| `route` | LineString | — | Navigation route overlay (optional, hand-authored). |

## Road hierarchy (`rank`)

`8 motorway · 7 trunk/motorway_link · 6 primary · 5 secondary · 4 tertiary ·
2 residential/unclassified · 1 service/living_street`. Renderers key line width
and label priority off `rank`.

## Grade separation (overpasses / underpasses)

`layer` gives the vertical stacking order (OSM `layer` tag; 0 = ground). `bridge`
marks an overpass deck; `tunnel` marks an underpass/bore. Renderers draw ground
features first, then `bridge`/`layer>0` features on top with a casing shadow, and
render `tunnel`/`layer<0` features dashed and dimmed. A freeway interchange region
(`guadalupe-i280-87-interchange`) is committed specifically to exercise this.

## Road paint / lane markings

`lane_divider` features are **derived** by the pipeline from a road's `lanes`
count: interior lane boundaries are computed by perpendicular-offsetting the road
centerline (3.5 m lanes). For two-way roads the central divider is emitted as a
`double_yellow` `centerline`; the rest are `white_dashed` `lane_line`s. These are
first-class map layers, not just data — see the `nj-lane-*` layers in `style.json`
and the paint pass in `NaviMap.tsx`.

## Regenerating

```bash
node scripts/pipeline/build-region.mjs            # all committed regions
node scripts/pipeline/build-region.mjs --bbox W,S,E,N --id my-area
```

Regions are defined in `scripts/pipeline/regions.json`. The `statewide` entry
holds the full California bounding box for large tiled runs (generate from a
Geofabrik California PBF + tippecanoe, not a live Overpass call).
