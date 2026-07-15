# ADR 0001: Mapbox style plus keyless renderer

## Status

Accepted.

## Decision

California Light is exposed as a Mapbox Style Specification document and GeoJSON source, while the product route also includes a small browser canvas renderer for credential-free development.

When `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is present, the route initializes Mapbox GL JS with the checked-in style. Otherwise it projects the same GeoJSON fixture into a responsive canvas preview.

## Consequences

- The route is immediately visible in a fresh checkout.
- Mapbox credentials remain optional and uncommitted.
- The style and feature data are directly inspectable and replaceable.
- The no-key renderer is a visual development fallback, not a full basemap engine.
- Production California coverage should migrate the Reality Layer from GeoJSON to tiled vector data while retaining the public renderer contract.
