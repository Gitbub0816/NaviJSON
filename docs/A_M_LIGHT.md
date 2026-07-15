# NaviJSON California Light (`A_M-light`)

The public map route is `/maps/GeoJSON/A_M-light`.

## Public assets

- `/maps/GeoJSON/A_M-light/style.json` — Mapbox Style Specification v8 document
- `/maps/GeoJSON/A_M-light/features.geojson` — GeoJSON fixture with roads, buildings, water, parks, lane paint, crosswalks, signals, and a route
- `/maps/GeoJSON/A_M-light/tokens.json` — cartographic design tokens and minimum zooms

The style imports Mapbox Standard and places the NaviJSON detail through the `bottom`, `middle`, and `top` slots. It is Apple-inspired in clarity and restraint, but it is independently designed and uses no Apple assets.

## Mapbox mode

Copy `.env.example` to `.env.local` and add a public Mapbox token. The route automatically switches from the built-in no-key canvas renderer to Mapbox GL JS.

```text
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_public_token
```

The token is intentionally not committed. Restrict the public token to the domains that will host NaviJSON.

## No-key mode

Without a token the same route renders an interactive California Light preview from `features.geojson`. Pan by dragging, zoom with the wheel or a double-click, and change the dawn/day/dusk preset in the lower-right control.

## Production data

The bundled GeoJSON is a small visual fixture, not a claim of statewide feature coverage. Replace its contents or change the `navijson-reality` source URL to a production GeoJSON endpoint or vector tileset once processed California data is available.
