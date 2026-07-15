# Cost boundary

The checked-in California Light preview has no required paid service. It uses the local GeoJSON fixture and browser canvas rendering by default.

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
