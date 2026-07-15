/*!
 * NaviJSON SDK v0.1.0
 * Embeddable map + navigation widget for the NaviJSON platform.
 *
 * Zero dependencies, no build step. Drop it on any page:
 *
 *   <div id="map" style="width:100%;height:480px"></div>
 *   <script src="https://your-navijson-host/sdk/navijson.js"></script>
 *   <script>
 *     var map = NaviJSON.mount("#map", { token: "pk.YOUR_MAPBOX_TOKEN" });
 *     map.on("ready", function () { console.log("NaviJSON embed ready"); });
 *   </script>
 *
 * It creates an <iframe> pointed at the NaviJSON `/embed` view (derived from
 * this script's own origin) and returns a controller for events + teardown.
 *
 * Map data © OpenStreetMap contributors (ODbL).
 */
(function (root, factory) {
  // UMD-ish: CommonJS export if present, otherwise a browser global.
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.NaviJSON = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "0.1.0";

  /**
   * Best-effort origin for the /embed view. Prefer the origin the SDK script
   * itself was served from (so a page on example.com embedding a script from
   * navijson.app still points the iframe at navijson.app); fall back to the
   * current page origin.
   */
  function resolveOrigin() {
    try {
      // document.currentScript works while this file is executing top-level.
      var current =
        typeof document !== "undefined" ? document.currentScript : null;
      if (current && current.src) {
        return new URL(current.src).origin;
      }
      // Fallback: find any <script> whose src references navijson.js.
      if (typeof document !== "undefined") {
        var scripts = document.getElementsByTagName("script");
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || "";
          if (src.indexOf("navijson.js") !== -1) {
            return new URL(src).origin;
          }
        }
      }
    } catch (e) {
      /* fall through to location.origin */
    }
    return typeof location !== "undefined" ? location.origin : "";
  }

  /** Resolve a target that may be an Element or a CSS selector string. */
  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === "string") {
      return typeof document !== "undefined"
        ? document.querySelector(target)
        : null;
    }
    // Duck-type an Element (has appendChild).
    if (typeof target.appendChild === "function") return target;
    return null;
  }

  /** Build the /embed URL with only the params that are actually provided. */
  function buildSrc(origin, options) {
    var url = origin.replace(/\/+$/, "") + "/embed";
    var query = [];
    if (options.token) {
      query.push("token=" + encodeURIComponent(options.token));
    }
    if (options.tileset) {
      query.push("tileset=" + encodeURIComponent(options.tileset));
    }
    if (options.apiKey) {
      query.push("key=" + encodeURIComponent(options.apiKey));
    }
    return query.length ? url + "?" + query.join("&") : url;
  }

  /** Normalize a width/height option to a CSS length ("480px", "100%", …). */
  function toCssSize(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === "number") return value + "px";
    return String(value);
  }

  /**
   * NaviJSON.mount(target, options)
   *
   * @param {string|Element} target  CSS selector or element to mount into.
   * @param {object} [options]
   * @param {string} [options.token]    Mapbox public token (pk...).
   * @param {string} [options.tileset]  Tileset URL (mapbox://, TileJSON, pmtiles://).
   * @param {string} [options.apiKey]   Caller API key (reserved; forwarded as `key`).
   * @param {string|number} [options.width]   iframe width (default "100%").
   * @param {string|number} [options.height]  iframe height (default "100%").
   * @returns {{iframe: HTMLIFrameElement, on: Function, off: Function, destroy: Function}}
   */
  function mount(target, options) {
    options = options || {};
    var el = resolveTarget(target);
    if (!el) {
      throw new Error(
        "NaviJSON.mount: target not found (" +
          (typeof target === "string" ? target : "element") +
          ")",
      );
    }

    var origin = resolveOrigin();
    var iframe = document.createElement("iframe");
    iframe.src = buildSrc(origin, options);
    iframe.title = "NaviJSON map";
    iframe.setAttribute("allow", "geolocation; fullscreen");
    iframe.setAttribute("loading", "lazy");
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.width = toCssSize(options.width, "100%");
    iframe.style.height = toCssSize(options.height, "100%");
    el.appendChild(iframe);

    // --- event bridge -----------------------------------------------------
    // listeners: { eventType: [cb, cb, ...] }
    var listeners = {};

    function handleMessage(event) {
      // Only trust messages from *our* iframe and tagged with our source.
      if (event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== "object" || data.source !== "navijson") {
        return;
      }
      var type = data.type;
      if (!type) return;
      var cbs = listeners[type];
      if (!cbs) return;
      // Copy before iterating so an `off()` inside a handler is safe.
      cbs.slice().forEach(function (cb) {
        try {
          cb(data.payload, data);
        } catch (e) {
          /* a listener throwing must not break the bridge */
        }
      });
    }

    if (typeof window !== "undefined") {
      window.addEventListener("message", handleMessage);
    }

    var controller = {
      /** The created iframe element. */
      iframe: iframe,

      /** Subscribe to an embed event ("ready", "route", "arrive", …). */
      on: function (eventType, cb) {
        if (!eventType || typeof cb !== "function") return controller;
        (listeners[eventType] = listeners[eventType] || []).push(cb);
        return controller;
      },

      /** Unsubscribe. Omit `cb` to remove all listeners for the event. */
      off: function (eventType, cb) {
        if (!eventType) return controller;
        if (!cb) {
          delete listeners[eventType];
          return controller;
        }
        var cbs = listeners[eventType];
        if (cbs) {
          listeners[eventType] = cbs.filter(function (fn) {
            return fn !== cb;
          });
        }
        return controller;
      },

      /** Tear down: remove the message listener and the iframe. */
      destroy: function () {
        if (typeof window !== "undefined") {
          window.removeEventListener("message", handleMessage);
        }
        listeners = {};
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      },
    };

    return controller;
  }

  return {
    version: VERSION,
    mount: mount,
  };
});
