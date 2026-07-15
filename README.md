# NaviJSON

NaviJSON is a Mapbox-compatible cartography and navigation project. The first exposed experience is **California Light**, an independently designed, Apple-inspired light map with NaviJSON GeoJSON enrichment.

## California Light

Open the app at:

```text
/maps/GeoJSON/A_M-light
```

Direct assets:

- `/maps/GeoJSON/A_M-light/style.json`
- `/maps/GeoJSON/A_M-light/features.geojson`
- `/maps/GeoJSON/A_M-light/tokens.json`

The experience works without credentials through a built-in interactive canvas renderer. Add `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to `.env.local` to switch the same route to Mapbox GL JS and the Mapbox Standard basemap.

## Local setup

```bash
npm install
npm run dev
```

Then open the local URL shown by the development server. Copy `.env.example` to `.env.local` only when enabling live Mapbox mode.

## Checks

```bash
npm run build
npm run lint
npm test
```

The test suite verifies the requested route, root redirect, GeoJSON fixture, design tokens, and Mapbox style structure.

## Data boundary

The bundled San José GeoJSON is a demonstration fixture, not statewide coverage. Production Reality Layer data must come from open, public-domain, customer-provided, or explicitly licensed sources and include provenance and confidence. Restricted commercial imagery must not be used for feature extraction without written derivative-data rights.

See [California Light documentation](docs/A_M_LIGHT.md), [data licenses](docs/DATA_LICENSES.md), and [costs](docs/COSTS.md).
