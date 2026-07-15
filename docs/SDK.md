# NaviJSON JavaScript SDK

Embed the NaviJSON map + navigation experience on any website with a single
script tag and one function call. This is the **embeddable-iframe MVP**: the SDK
mounts an `<iframe>` pointed at the NaviJSON `/embed` view and gives you a small
controller for events and teardown.

Map data © OpenStreetMap contributors (ODbL).

## Quick start

```html
<div id="map" style="width:100%;height:480px"></div>

<script src="https://your-navijson-host/sdk/navijson.js"></script>
<script>
  var map = NaviJSON.mount("#map", { token: "pk.YOUR_MAPBOX_TOKEN" });
  map.on("ready", function () {
    console.log("ready");
  });
</script>
```

A runnable version lives at [`/sdk/example.html`](../public/sdk/example.html).

The SDK is dependency-free vanilla JS (no build step). It exposes a global
`NaviJSON`, and also assigns to `module.exports` when a CommonJS environment is
present.

## `NaviJSON.mount(target, options)`

Creates the iframe, inserts it into `target`, and returns a controller.

| Argument  | Type               | Description                                            |
| --------- | ------------------ | ------------------------------------------------------ |
| `target`  | `string \| Element`| CSS selector or DOM element to mount into.             |
| `options` | `object`           | See below (all optional).                              |

### Options

| Option    | Type             | Default  | Description                                                                 |
| --------- | ---------------- | -------- | --------------------------------------------------------------------------- |
| `token`   | `string`         | —        | Mapbox **public** token (`pk.…`). With a token the live Mapbox map renders (tap-to-route, drive, voice); without one, the keyless canvas preview renders. |
| `tileset` | `string`         | —        | Tileset URL: `mapbox://user.id`, a TileJSON URL, or `pmtiles://…`. Selects the statewide style variant. See [STATEWIDE_TILESET.md](STATEWIDE_TILESET.md). |
| `apiKey`  | `string`         | —        | Your NaviJSON API key. Forwarded to the embed as `key` (reserved for future gating). |
| `width`   | `string \| number` | `"100%"` | iframe width. A number is treated as pixels (`480` → `"480px"`).           |
| `height`  | `string \| number` | `"100%"` | iframe height. A number is treated as pixels.                             |

The iframe is created with `allow="geolocation; fullscreen"` so locate-me and
fullscreen work inside the embed.

### Origin resolution

The iframe `src` origin is derived from the SDK script's own `src` (via
`document.currentScript`), so a page on `example.com` that loads the script from
`navijson.app` still points the iframe at `navijson.app/embed`. If that cannot be
determined it falls back to `location.origin`.

## Controller

`mount()` returns:

```ts
{
  iframe: HTMLIFrameElement,
  on(event: string, cb: (payload, message) => void): controller,
  off(event: string, cb?: Function): controller,
  destroy(): void,
}
```

- **`iframe`** — the created element, in case you need to style or inspect it.
- **`on(event, cb)`** — subscribe to an embed event. Returns the controller so
  calls chain.
- **`off(event, cb)`** — unsubscribe a specific callback; omit `cb` to remove all
  listeners for that event.
- **`destroy()`** — remove the `message` listener and the iframe from the DOM.

## Events

Events arrive from the embed via `window.postMessage` using the envelope
`{ source: "navijson", type, payload }`. The controller only accepts messages
from **its own** iframe's `contentWindow` and with `source === "navijson"`, then
dispatches `payload` to matching `on()` listeners.

| Event    | When                                       | Payload            |
| -------- | ------------------------------------------ | ------------------ |
| `ready`  | The embed has mounted inside the iframe.   | `{}`               |
| `route`  | _(reserved)_ a route has been computed.    | route summary      |
| `arrive` | _(reserved)_ the drive reached its end.    | arrival info       |

`ready` fires today. `route` and `arrive` are reserved: the message plumbing is
in place and harmless, and the embed will emit them as the map gains those hooks.

## The `/embed` view

The SDK iframes `<origin>/embed`, a chromeless full-viewport page that reads
config from the query string:

| Param     | Description                                                              |
| --------- | ------------------------------------------------------------------------ |
| `token`   | Mapbox public token. Omit for the keyless canvas preview.                |
| `tileset` | Optional tileset URL (`mapbox://…`, TileJSON, or `pmtiles://…`).          |
| `key`     | Optional caller API key (round-tripped; reserved for future gating).     |

You can also iframe `/embed` directly without the SDK:

```html
<iframe
  src="https://your-navijson-host/embed?token=pk.YOUR_TOKEN"
  style="width:100%;height:480px;border:0"
  allow="geolocation; fullscreen"
></iframe>
```

## Versioning

`NaviJSON.version` is the SDK version string (currently `"0.1.0"`).

## Roadmap / next steps

This release is the embeddable-iframe MVP. A documented next step is richer
**imperative control** over the map — e.g. `controller.setDestination(lngLat)`,
`controller.startDrive()`, `controller.clearRoute()` — implemented as a
`postMessage` command channel into the embed (the reverse direction of the event
bridge already shipped here).
