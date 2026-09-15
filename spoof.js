/* ============================================================
   Inta-Enhancer - spoof.js (OLIN 1.1.a)
   Runs in PAGE world (MAIN) at document_start — registered ONLY
   while Mobile feel is ON (background.js registers/unregisters it
   with the toggle; a reload applies the change, same as the UA rule).
   Makes Instagram's OWN JavaScript see an iPhone:
     navigator.userAgent / appVersion / platform / vendor /
     maxTouchPoints / userAgentData (+ high-entropy values).
   Network level (UA header + Sec-CH-* client hints) is spoofed by
   the declarativeNetRequest rules in background.js.
   Everything is guarded: if IG freezes an object, that one getter
   is skipped and the rest still apply. No page behavior is changed.
   ============================================================ */
(() => {
"use strict";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_APPVERSION =
  "5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const val = (v) => ({ configurable: true, enumerable: true, get: () => v });

try {
  Object.defineProperty(Navigator.prototype, "userAgent", val(IPHONE_UA));
} catch {}
try {
  Object.defineProperty(Navigator.prototype, "appVersion", val(IPHONE_APPVERSION));
} catch {}
try {
  Object.defineProperty(Navigator.prototype, "platform", val("iPhone"));
} catch {}
try {
  Object.defineProperty(Navigator.prototype, "vendor", val("Apple Computer"));
} catch {}
try {
  Object.defineProperty(Navigator.prototype, "maxTouchPoints", val(5));
} catch {}

try {
  const brands = [
    { brand: "Safari", version: "17" },
    { brand: "Mobile Safari", version: "17" },
    { brand: "Not;A=Brand", version: "99" },
  ];
  const uaData = {
    brands,
    mobile: true,
    platform: "iOS",
    getHighEntropyValues: () =>
      Promise.resolve({
        architecture: "arm",
        bitness: "64",
        formFactors: ["Mobile"],
        fullVersionList: brands,
        mobile: true,
        model: "iPhone",
        platform: "iOS",
        platformVersion: "17.0",
      }),
  };
  Object.defineProperty(Navigator.prototype, "userAgentData", val(uaData));
} catch {}

// "ontouchstart" in window stays true (touch-capable claim matches
// maxTouchPoints). Setter is a noop so feature-detects keep working.
try {
  Object.defineProperty(window, "ontouchstart", {
    configurable: true,
    enumerable: true,
    get: () => null,
    set: () => {},
  });
} catch {}

// iPhone Safari has NO window.chrome / window.browser (those are
// Chromium/Firefox globals). Leaving them present next to an iPhone UA
// is a classic spoof tell, so remove them. Guarded: if anything is
// non-configurable we just keep it — a missed strip beats a broken page.
try {
  const c = Object.getOwnPropertyDescriptor(window, "chrome");
  if (!c || c.configurable) {
    try { delete window.chrome; } catch {}
  }
} catch {}
try {
  const b = Object.getOwnPropertyDescriptor(window, "browser");
  if (b && b.configurable) {
    try { delete window.browser; } catch {}
  }
} catch {}
})();
