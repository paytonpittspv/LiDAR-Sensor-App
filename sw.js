// Offline support. Two places serve the app over https:
//   sensor.paytonpittsdesigns.com  the sensor itself (only reachable on its Wi-Fi): open from the saved copy
//                                  straight away, and update that copy in the background whenever the sensor is there
//   GitHub Pages                   newest from the network when online, the saved copy when offline
const VERSION = "aa52f9699a";
const CACHE = "lidar-sensor-" + VERSION;
const SENSOR = "sensor.paytonpittsdesigns.com";
const onSensor = self.location.hostname === SENSOR;
const ASSETS = ["./", "index.html", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/favicon-32.png"];
const API = /^\/(live|arm|stop|data|tls|cert|csr|level|pod|show|claim|screen|pick|order|about|update)(\/|$)/;

// Save the app one file at a time, the page first. The sensor takes only a few secure connections at once: asking
// for everything together can make one request fail, and a single failure used to throw the whole copy away (so the
// app wouldn't open without the sensor). Now the page alone is enough to open offline; the icons are a bonus, and
// anything missed is fetched again on the next visit ("fill" message from the page).
async function fill() {
  const c = await caches.open(CACHE);
  for (const a of ASSETS) {
    if (await c.match(a)) continue;
    for (let i = 0; i < 3; i++) { try { const r = await fetch(a, { cache: "no-store" }); if (r.ok) { await c.put(a, r); break; } } catch (e) {} await new Promise((ok) => setTimeout(ok, 400)); }
  }
  return !!(await c.match("index.html"));
}
self.addEventListener("install", (e) => { e.waitUntil(fill().then(() => self.skipWaiting())); });
self.addEventListener("message", (e) => { if (e.data === "fill") e.waitUntil(fill().then((ok) => e.source && e.source.postMessage({ offline: ok }))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("lidar-sensor-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const save = (res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); } return res; };
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || API.test(url.pathname)) return;   // sensor calls always go live
  if (req.mode === "navigate") {
    if (onSensor) {
      e.respondWith(caches.match("index.html").then((hit) => {
        const net = fetch(req).then(save);
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net.catch(() => caches.match("./"));
      }));
    } else {
      e.respondWith(fetch(req).then(save).catch(() => caches.match("index.html").then((r) => r || caches.match("./"))));
    }
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
