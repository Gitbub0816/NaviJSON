# Deploying NaviJSON to Cloudflare

This app is a Cloudflare Worker (vinext + `@cloudflare/vite-plugin`). `npm run
build` produces the deployable output in `dist/` (worker in `dist/server`,
static assets in `dist/client`). You do not need `npm run dev` running to ship —
deploy through your existing project.

## 0. The one gotcha: the 48 MB Reality Layer

Cloudflare rejects any single static asset over **25 MiB**. The full 15-region
`features.geojson` is ~48 MB, so it is **not** uploaded as a static asset:

- `npm run build` runs a `postbuild` step that appends the file to
  `dist/client/.assetsignore`, so the deploy skips it automatically.
- In production the app fetches the data from object storage instead, via the
  `NEXT_PUBLIC_FEATURES_URL` env var (see below). In local dev, with that var
  unset, it falls back to the bundled file.

So: **upload `features.geojson` to R2 and set `NEXT_PUBLIC_FEATURES_URL`** — or
the deployed map has no sample data (the statewide tileset still works on its
own if you set `NEXT_PUBLIC_NAVIJSON_TILESET`).

## 1. Environment variables

Set these in your project's build environment (they are `NEXT_PUBLIC_*`, so they
are inlined at **build** time — set them before `npm run build`):

| Var | Purpose | Required? |
| --- | --- | --- |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Mapbox GL rendering + 3D POV drive. Without it you get the keyless 2D canvas (no navigation). | For nav/3D |
| `NEXT_PUBLIC_FEATURES_URL` | Public URL of `features.geojson` (R2/S3). | To show the sample data |
| `NEXT_PUBLIC_NAVIJSON_TILESET` | Statewide vector tileset (`mapbox://…` or `pmtiles://…`). | Optional (statewide) |

## 2. Upload the data to R2

An R2 bucket `navijson-tiles` is already provisioned.

```bash
wrangler login
# Sample Reality Layer (served to the browser):
wrangler r2 object put navijson-tiles/features.geojson \
  --file public/maps/GeoJSON/A_M-light/features.geojson --remote
# (optional) statewide tileset:
wrangler r2 object put navijson-tiles/california.pmtiles \
  --file scripts/pipeline/statewide-build/california.pmtiles --remote

# Make the bucket publicly readable and note the r2.dev host:
wrangler r2 bucket dev-url enable navijson-tiles
```

**CORS (required):** the browser fetches `features.geojson` (and PMTiles) from
the R2 origin, which is cross-origin to your app, so the bucket must send CORS
headers. In the Cloudflare dashboard → R2 → `navijson-tiles` → Settings → CORS,
allow your app's origin (or `*` for testing) with `GET`/`HEAD` and the `Range`
header. Then:

```
NEXT_PUBLIC_FEATURES_URL=https://<your-r2-host>/features.geojson
# and, if using the tileset:
NEXT_PUBLIC_NAVIJSON_TILESET=pmtiles://https://<your-r2-host>/california.pmtiles
```

## 3. (Optional) D1 for the developer console

`/console` and `/api/keys|validate` need a D1 database bound as `DB`. Without it
they degrade to a clean "connect a D1 database" state, so this is optional.

```bash
wrangler d1 create navijson
# bind it as DB in your project config, then apply the migration:
wrangler d1 migrations apply navijson --remote
```

## 4. Build and deploy

```bash
npm ci
npm run build          # includes the postbuild asset-exclusion step
# Deploy through your existing project (appgprj_… in .openai/hosting.json).
# If deploying with wrangler directly:
#   npx wrangler deploy
```

## 5. Verify after deploy

- `/maps/GeoJSON/A_M-light` — the map. With a Mapbox token + `FEATURES_URL`, tap
  a start then destination and press **Start drive** for the 3D POV + voice.
- `/embed?token=pk…` — the embeddable widget view (used by `public/sdk/navijson.js`).
- `/console` — API-key dashboard (needs D1 bound).

## Notes

- The tileset/data files (`features.geojson`, `california.pmtiles`,
  `california.mbtiles`) are build artifacts, not committed to git — regenerate
  with `scripts/pipeline/build-region.mjs` / `build-statewide.sh`.
- Data © OpenStreetMap contributors, ODbL.
