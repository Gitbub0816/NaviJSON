# Cost boundary

The checked-in California Light preview has no required paid service. It uses the local OpenStreetMap-derived Reality Layer GeoJSON and browser canvas rendering by default.

## Reality Layer generation

Building the committed sample regions with `scripts/pipeline/build-region.mjs` uses the **free public Overpass API** for OpenStreetMap data — no key or paid quota is required for these small extracts (be a considerate client and respect Overpass rate limits). Statewide California is not built from Overpass: it is processed **offline** from a downloaded Geofabrik California `.osm.pbf` extract and turned into vector tiles with tippecanoe, so the only costs there are local compute and, if published, tile hosting and delivery.

## Optional services

| Capability | Default | Potential cost |
| --- | --- | --- |
| Map rendering | No-key local renderer | Mapbox GL JS usage after a token is added |
| Basemap and 3D | Fixture preview | Mapbox-hosted Standard style and resources |
| Production Reality Layer | Local GeoJSON fixture | Tile processing, storage, and delivery |
| Routing | Not configured in this focused map release | Hosted routing provider or self-hosted Valhalla infrastructure |
| Source processing | Not required for the fixture | Compute, storage, imagery access, lidar processing, and review labor |

Provider pricing and free tiers change. Review the current official Mapbox pricing, Studio, Uploads API, and Tiling Service documentation before uploading production data. Do not encode assumed free-tier quantities into application logic.

## Keys still needed

- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` — optional public browser token for live Mapbox mode.
- A secret Mapbox token would be needed only for future automated uploads; it must never be exposed to the browser or committed.
