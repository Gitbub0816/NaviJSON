# NaviJSON agent guide

## Product boundary

NaviJSON is a Mapbox-compatible navigation and cartography project. Keep the `A_M-light` design independently authored: do not copy Apple artwork, labels, imagery, or proprietary geographic data.

## Source policy

Only commit geographic data whose license permits the intended use. Every production enrichment feature must include provenance, observation date when applicable, and a confidence score. Do not derive features from Google or Apple imagery without explicit derivative-data rights.

## Required checks

Before publishing changes to the California Light route:

1. Parse and validate `public/maps/GeoJSON/A_M-light/style.json`.
2. Parse `features.geojson` and confirm it is a `FeatureCollection`.
3. Run the production build and route tests.
4. Confirm the route works with no Mapbox token.
5. Never commit Mapbox access tokens.
