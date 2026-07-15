import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validate } from "@mapbox/mapbox-gl-style-spec";

const route = "/maps/GeoJSON/A_M-light";

async function render(pathname = route) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("serves the California Light map at the requested route", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>California Light · NaviJSON<\/title>/i);
  assert.match(html, /NaviJSON/);
  assert.match(html, /California, in a clearer light\./);
  assert.match(html, /No-key preview/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("root URL redirects to the California Light map", async () => {
  const response = await render("/");
  assert.ok([301, 302, 307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, route);
});

test("ships valid GeoJSON and a structurally valid Mapbox style", async () => {
  const [styleText, geoJsonText, tokensText] = await Promise.all([
    readFile(new URL("../public/maps/GeoJSON/A_M-light/style.json", import.meta.url), "utf8"),
    readFile(new URL("../public/maps/GeoJSON/A_M-light/features.geojson", import.meta.url), "utf8"),
    readFile(new URL("../public/maps/GeoJSON/A_M-light/tokens.json", import.meta.url), "utf8"),
  ]);

  const style = JSON.parse(styleText);
  const geoJson = JSON.parse(geoJsonText);
  const tokens = JSON.parse(tokensText);

  assert.equal(style.version, 8);
  assert.equal(style.name, "NaviJSON California Light");
  assert.equal(style.sources["navijson-reality"].type, "geojson");
  assert.equal(geoJson.type, "FeatureCollection");
  assert.ok(geoJson.features.length >= 25);
  assert.equal(tokens.variant, "A_M-light");

  const fatalValidationErrors = validate(style).filter(
    (error) => !/imports|slot|config/.test(error.message),
  );
  assert.deepEqual(fatalValidationErrors, []);
});
