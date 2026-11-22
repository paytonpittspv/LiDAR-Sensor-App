// ===== APP START =====
// ---------------- storage (on this phone) ----------------
// Everything is kept in the phone's database (IndexedDB), which holds far more than the old 5 MB storage,
// and the app asks the browser to never clear it on its own. Every change is written the moment it happens.
// A small copy also goes in localStorage (settings, athletes, the session and the 3 newest runs), written
// instantly, so even a refresh in the split second before the database finishes can't lose a run.
const Store = (() => {
  const NAME = "paytons-lidar", OS = "kv", KEYS = ["athletes", "runs", "settings", "session"], SMALL = ["athletes", "settings", "session"];
  const cache = {}; let db = null, mode = "local", persisted = null, usage = null, quota = null, onError = () => {};
  const ls = {
    get(k) { try { const v = localStorage.getItem("pls." + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set(k, v) { try { localStorage.setItem("pls." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem("pls." + k); } catch (e) {} },
  };
  const open = () => new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no database"));
    const t = setTimeout(() => rej(new Error("timeout")), 5000);
    let rq; try { rq = indexedDB.open(NAME, 1); } catch (e) { clearTimeout(t); return rej(e); }
    rq.onupgradeneeded = () => rq.result.createObjectStore(OS);
    rq.onsuccess = () => { clearTimeout(t); const d = rq.result; d.onclose = () => { if (db === d) db = null; }; d.onversionchange = () => d.close(); res(d); };
    rq.onerror = () => { clearTimeout(t); rej(rq.error); };
  });
  const run = (m, fn) => new Promise((res, rej) => {
    const t = db.transaction(OS, m), out = fn(t.objectStore(OS));
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("aborted"));
  });
  // join run lists by id; later lists win (they were written more recently)
  const merge = (...lists) => { const m = new Map(); for (const l of lists) for (const r of l || []) if (r && r.id) m.set(r.id, r); return [...m.values()].sort((a, b) => b.ts - a.ts); };
  async function load() {
    try { db = await open(); mode = "db"; } catch (e) { db = null; mode = "local"; }
    if (mode === "db") {
      try {
        const got = await run("readonly", (s) => { const o = {}; for (const k of KEYS) s.get(k).onsuccess = (ev) => { o[k] = ev.target.result; }; return o; });
        for (const k of SMALL) { const l = ls.get(k); cache[k] = l !== undefined ? l : got[k]; }
        // old saved runs (from before the database) and the instant copy of the newest runs are folded in
        cache.runs = merge(got.runs, ls.get("runs"), ls.get("recent"));
        await run("readwrite", (s) => { for (const k of KEYS) if (cache[k] !== undefined) s.put(cache[k], k); });
        ls.del("runs");   // now safely in the database, which frees the old storage
      } catch (e) { db = null; mode = "local"; }
    }
    if (mode === "local") {
      for (const k of SMALL) cache[k] = ls.get(k);
      cache.runs = merge(ls.get("runs"), ls.get("recent"));
    }
    refreshInfo(true);
  }
  function refreshInfo(ask) {
    try {
      const S = navigator.storage; if (!S) return;
      if (S.persisted) S.persisted().then((p) => { persisted = p; if (!p && ask && S.persist) return S.persist().then((q) => (persisted = q)); }).catch(() => {});
      if (S.estimate) S.estimate().then((e) => { usage = e.usage; quota = e.quota; }).catch(() => {});
    } catch (e) {}
  }
  function get(k, d) { return cache[k] === undefined ? d : cache[k]; }
  function set(k, v) {
    cache[k] = v;
    if (SMALL.includes(k)) ls.set(k, v);
    if (k === "runs") ls.set("recent", v.slice(0, 3));
    if (mode === "local") {
      if (k === "runs" && !ls.set("runs", v)) { onError({ name: "QuotaExceededError" }); return false; }
      return true;
    }
    write(k, true);
    return true;
  }
  // Safari sometimes closes the database behind the page's back (after switching Wi-Fi or a while in the
  // background). Then a write fails although nothing is full: reopen it and try once more. Only a real
  // "storage is full" error is reported as one.
  function write(k, retry) {
    const fail = (e) => {
      if (retry && !(e && e.name === "QuotaExceededError")) {
        db = null;
        open().then((d) => { db = d; write(k, false); }, () => { mode = "local"; if (k === "runs" && !ls.set("runs", cache.runs)) onError({ name: "QuotaExceededError" }); });
      } else onError(e);
    };
    try {
      if (!db) throw new Error("closed");
      const t = db.transaction(OS, "readwrite"); t.objectStore(OS).put(cache[k], k);
      t.onabort = t.onerror = () => fail(t.error);
      if (k === "runs") t.oncomplete = () => refreshInfo(false);
    } catch (e) { fail(e); }
  }
  const info = () => ({ mode, persisted, usage, quota, secure: !!window.isSecureContext });
  return { ready: load(), get, set, info, protect: () => refreshInfo(true), onError: (f) => (onError = f) };
})();
Store.ready.then(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const FT = Engine.FT;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f2 = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(2));
const f1 = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(1));
const mph = (ms) => ms * 2.23694;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const ftLabel = (ft) => { if (ft == null || !isFinite(ft)) return "—"; const s = ft < 0 ? "−" : ""; ft = Math.abs(ft); let f = Math.floor(ft), i = Math.round((ft - f) * 12); if (i === 12) { f++; i = 0; } return `${s}${f}' ${i}"`; };
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayLabel = (key, long) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString([], long ? { weekday: "long", month: "long", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }); };
const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------------- storage ----------------
const DB = { get: Store.get, set: Store.set };
const standalone = () => { try { return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; } };
Store.onError((e) => toast(e && e.name === "QuotaExceededError" ? "Couldn't save: this phone's storage is full. Export a backup in Settings, then delete old runs." : "Couldn't save that change. Close and reopen the app, then try again."));
let athletes = DB.get("athletes", []);
let runs = DB.get("runs", []).map((r) => (r.setup === "polerun" ? Object.assign(r, { setup: "polerun100" }) : r));
// vault counting (Nov 15): you start on the mark and the first step is a right, so L1 is the first left after it.
// Runs saved before counted the step off the mark as L1 when the step count was odd: recount them once.
{ let fixed = 0; for (const r of runs) { const S = r.res && r.res.steps; if (r.mode === "vault" && S && S.counted && !S.v2) { S.lefts = Math.floor(S.counted / 2); S.v2 = true; fixed++; } } if (fixed) DB.set("runs", runs); }
let settings = Object.assign({ midOut: 4, voice: false, chime: "original", solo: false, theme: null, weightUnit: "lb", lastAthlete: null, lastMode: "sprint", lastTarget: 30, lastSetup: "runway100" }, DB.get("settings", {}));
const saveAthletes = () => DB.set("athletes", athletes);
const saveRuns = () => DB.set("runs", runs);
const saveSettings = () => DB.set("settings", settings);
// this phone/iPad, so the sensor can tell which device set up a run (the others follow along)
if (!settings.deviceId) { settings.deviceId = uid(); saveSettings(); }
const DEVICE_ID = settings.deviceId;
if (settings.theme) document.documentElement.setAttribute("data-theme", settings.theme);
if (settings.lastSetup === "polerun") settings.lastSetup = "polerun100";
const athleteById = (id) => athletes.find((a) => a.id === id) || { id, name: "Unknown athlete" };

// ---------------- tests ----------------
const SETUPS = {
  runway100: { name: "Runway · short approach", short: "Short approach", detail: "Tripod 100 ft from the back of the box", boxFt: 100 },
  runway150: { name: "Runway · long approach", short: "Long approach", detail: "Tripod 150 ft from the back of the box", boxFt: 150 },
  polerun100: { name: "Pole run · short approach", short: "Pole run 100", detail: "Off the runway · tripod 100 ft from the box mark", boxFt: 100, pole: true },
  polerun150: { name: "Pole run · long approach", short: "Pole run 150", detail: "Off the runway · tripod 150 ft from the box mark", boxFt: 150, pole: true },
  polerun: { name: "Pole run", short: "Pole run", detail: "Off the runway", boxFt: 100, pole: true, old: true },   // runs saved before 100/150 ft pole runs
};
const testKey = (r) => (r.mode === "sprint" ? `sprint-${r.target}` : `vault-${r.setup}`);
const testName = (key) => { const [m, x] = key.split("-"); return m === "sprint" ? `${x} m sprint` : SETUPS[x].name; };
const testShort = (key) => { const [m, x] = key.split("-"); return m === "sprint" ? `${x} m` : SETUPS[x].short; };
// headline number for a run (and which way is better)
function headline(r) {
  const R = r.res;
  if (r.mode === "sprint") return { label: `${r.target} m time`, value: R.time, unit: "s", text: `${f2(R.time)} s`, better: "low" };
  return { label: "Last 5 m", value: R.last5 && R.last5.speed, unit: "m/s", text: R.last5 ? `${f2(R.last5.speed)} m/s` : "—", better: "high" };
}

// ---------------- toast ----------------
let toastT = null;
function toast(msg) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom,0px));background:var(--card2);color:var(--text);border:1px solid var(--line);padding:10px 14px;border-radius:12px;z-index:60;max-width:90vw;font-weight:600;font-size:14px";
    document.body.appendChild(t); }
  t.textContent = msg; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), 3200);
}

// ---------------- voice ----------------
let voiceUnlocked = false;
function say(txt, force) {
  if (!settings.voice && !force) return;
  if (!("speechSynthesis" in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(txt); u.rate = 1.0; u.volume = 1; speechSynthesis.speak(u); } catch (e) {}
}
const spoken = (v, d = 2) => v.toFixed(d).replace(".", " point ");
function speech(run) {
  const R = run.res;
  if (run.mode === "sprint") return `${run.target} meters, ${spoken(R.time)}. Top speed ${spoken(R.top.speed)}.`;
  const f = R.finish;
  const box = f ? (f.change >= 0.1 ? "Speeding up into the box." : f.change <= -0.1 ? `Slowing ${spoken(Math.abs(f.change))} into the box.` : "Holding speed into the box.") : "";
  return (R.steps.counted ? `${R.steps.lefts} lefts. ` : "") + (R.last5 ? `Last five, ${spoken(R.last5.speed)}. ` : "") + box;
}
function changeTag(R) {
  if (!R.last5 || !R.prev5) return null;
  const d = R.last5.speed - R.prev5.speed;
  if (d <= -0.15) return { cls: "down", text: `Slowed ${Math.abs(d).toFixed(2)} into takeoff`, say: `Slowed by ${spoken(Math.abs(d))}.` };
  if (d >= 0.15) return { cls: "up", text: `Built ${d.toFixed(2)} into takeoff`, say: "Still building speed." };
  return { cls: "flat", text: "Held speed into takeoff", say: "Held speed." };
}

// ---------------- sensor ----------------
// sensor states (from the firmware): 0 idle · 1 waiting for an athlete to stand still · 2 armed · 3 running · 4 done
const sensor = { connected: false, d: null, s: 0, rate: 0, rec: false, moved: false, misses: 0, state: 0, sets: 0, go: 0, inZone: false, hold: 0, arm: null, cfg: "", phones: 0, fw: "", role: null };
let pollBusy = false;
async function poll() {
  if (pollBusy) return; pollBusy = true;
  try {
    const live = view === "new" && cap.phase === "recording" && cap.liveFrom != null && !cap.sim;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 900);
    const j = await (await fetch(live ? `/live?dev=${DEVICE_ID}&from=${cap.liveFrom}` : `/live?dev=${DEVICE_ID}`, { cache: "no-store", signal: ctl.signal })).json(); clearTimeout(to);
    if (!sensor.connected) setTimeout(certSync, 400);
    sensor.connected = true; sensor.misses = 0;
    sensor.d = j.d > 10 && j.d < j.max ? j.d / 100 : null; sensor.s = j.s; sensor.rate = j.rate; sensor.rec = j.rec; sensor.moved = j.moved;
    sensor.state = j.state || 0; sensor.sets = j.sets || 0; sensor.go = j.go || 0; sensor.inZone = !!j.in; sensor.hold = j.hold || 0;
    sensor.arm = j.arm != null ? j.arm : null; sensor.cfg = j.cfg || ""; sensor.phones = j.phones || 0; sensor.fw = j.fw || "";
    sensor.role = j.role || "control";
    sensor.imu = !!j.imu; sensor.bump = !!j.bump; sensor.bumpDeg = j.bumpDeg || 0; sensor.bumpWhy = j.bumpWhy || "";
    sensor.pod = j.pod || null; sensor.pods = j.pods || (j.pod ? [Object.assign({ id: "pod" }, j.pod)] : []); podWatch();
    if (j.pick != null) { sensor.pick = j.pick; sensor.pickName = j.pickName || ""; takePick(); }
    if (j.order != null) { sensor.order = j.order; takeOrder(); }
    // the first device on the sensor is the controller; any other one turns into the big display
    if (sensor.role === "display" && !disp.on && !disp.dismissed) startDisplay();
    else if (sensor.role === "control" && disp.on && !disp.manual) stopDisplay();
    if (live && j.pts) { liveAdd(j.pts); cap.liveFrom = j.next; }
    onLive();
  } catch (e) { if (++sensor.misses > 3) { sensor.connected = false; sensor.d = null; } }
  pollBusy = false;
  const p = $("#conn"), noLidar = sensor.connected && !sensor.rate;
  p.className = "pill " + (!sensor.connected ? "off" : noLidar ? "warn" : "ok");
  p.textContent = !sensor.connected ? "No sensor" : noLidar ? "No LiDAR" : sensor.phones > 1 ? `${sensor.phones} devices` : "Connected";
  bumpBar();
  const cue = $("#stcue"); if (cue) cue.innerHTML = cueHTML();
  document.querySelectorAll("[data-live]").forEach((el) => (el.textContent = sensor.d != null ? sensor.d.toFixed(2) : "—"));
  const z = $("#zone"); if (z) { z.classList.toggle("on", sensor.inZone); z.querySelector("span").textContent = sensor.inZone ? "Someone is in the zone: stand still…" : "Nobody in the zone yet"; }
}
// poll faster while a run is live
// Where this copy of the app is running:
//   https://sensor.paytonpittsdesigns.com  the sensor's secure address: records, keeps every run, opens offline anywhere
//   http://192.168.4.1                     the sensor's plain address: setup, and the fallback before the certificate is on
//   GitHub Pages (https)                   the web copy: can't reach the sensor (browsers block a secure page talking to it)
const SECURE_HOST = "sensor.paytonpittsdesigns.com", SECURE_URL = "https://" + SECURE_HOST + "/";
const ON_SECURE = location.hostname === SECURE_HOST;
const ON_PLAIN = location.protocol === "http:";
const WEB_COPY = location.protocol === "https:" && !ON_SECURE;
// the saved copy that opens without the sensor: register, then ask it to fill in anything it missed
let offlineReady = null;
if ((location.protocol === "https:" || location.hostname === "localhost") && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && "offline" in e.data) { offlineReady = e.data.offline; if (view === "settings") render(); } });
  // (this code runs once the phone's database has opened, which is usually after the page's "load" event: waiting
  // for that event here meant the offline copy was often never set up, so register right away if it's been)
  const reg = () => navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((r) => { if (r.active) r.active.postMessage("fill"); }).catch(() => { offlineReady = false; });
  if (document.readyState === "complete") reg(); else window.addEventListener("load", reg);
}

// ---------------- the sensor's certificate ----------------
// The GitHub job (cert/) gets and renews the certificate. When the phone has internet the app downloads the
// newest one; when it's connected to the sensor it installs it there if the sensor's is older.
const CERT_URL = "https://raw.githubusercontent.com/paytonpittspv/LiDAR-Sensor-App/main/cert/";
const SETUP_URL = "https://github.com/paytonpittspv/LiDAR-Sensor-App/new/main?filename=cert/sensor.csr&value=";
const certSaved = () => { try { return JSON.parse(localStorage.getItem("pls.cert") || "null"); } catch (e) { return null; } };
let sensorTls = null, certOnline = null;
async function certFetch() {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 7000);
  try {
    const j = await (await fetch(CERT_URL + "sensor.json?t=" + Date.now(), { cache: "no-store", signal: ctl.signal })).json();
    certOnline = j; const have = certSaved();
    if (!have || j.until > have.until) {
      const pem = await (await fetch(CERT_URL + "sensor.pem?t=" + Date.now(), { cache: "no-store", signal: ctl.signal })).text();
      if (pem.includes("BEGIN CERTIFICATE")) { localStorage.setItem("pls.cert", JSON.stringify({ until: j.until, pem })); certSync(); if (view === "settings") render(); }
    }
    return true;
  } catch (e) { return false; } finally { clearTimeout(to); }
}
async function certSync() {
  if (WEB_COPY || !sensor.connected) return;
  try {
    sensorTls = await (await fetch("/tls", { cache: "no-store" })).json();
    const have = certSaved();
    if (have && (!sensorTls.until || have.until > sensorTls.until)) {
      const r = await (await fetch("/cert", { method: "POST", body: have.pem, headers: { "Content-Type": "text/plain" } })).json();
      if (r.ok) {
        sensorTls.until = have.until; sensorTls.secure = true;
        if (ON_PLAIN) { toast("Certificate installed on the sensor."); view = "settings"; render(); }
        else toast("Sensor's certificate renewed.");
      }
    }
    if (view === "settings") render();
  } catch (e) {}
}
// look for a newer certificate now and then (fails fast on the sensor's Wi-Fi, which has no internet)
setTimeout(certFetch, 1500); setInterval(() => { if (ON_PLAIN && !certSaved() && localStorage.getItem("pls.setupLink")) certFetch(); }, 20000); setInterval(certFetch, 10 * 60 * 1000); window.addEventListener("online", () => certFetch());
async function copySetupLink() {
  try {
    const csr = (await (await fetch("/csr", { cache: "no-store" })).text()).trim();
    if (!csr.includes("CERTIFICATE REQUEST")) throw new Error("no csr");
    // one line of base64, no header lines: GitHub's new-file link keeps only the first line of a multi-line value
    const b64 = csr.replace(/-----[A-Z ]+-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
    const url = SETUP_URL + encodeURIComponent(b64);
    localStorage.setItem("pls.setupLink", url);
    toast(copyText(url) ? "Setup link copied." : "Copy the link in the box below.");
  } catch (e) { toast("Couldn't read the setup code: join the SpeedLidar Wi-Fi first."); }
  render();
}
function secureCardHTML() {
  const have = certSaved(), when = (s) => new Date(s).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const off = offlineReady === true ? `<div class="small" style="margin-top:6px;color:var(--good)">\u2713 Saved on this phone: the app opens without the sensor.</div>`
    : offlineReady === false ? `<div class="small" style="margin-top:6px;color:var(--warn)">Not saved for use without the sensor yet. Keep the app open on the sensor's Wi-Fi for 10 seconds.</div>` : "";
  if (ON_SECURE) return `<div class="card"><div class="label">Secure address</div><div style="margin-top:4px"><b>${SECURE_HOST}</b></div>${off}
    <div class="small muted" style="margin-top:4px">${sensorTls && sensorTls.until ? `Certificate on the sensor good until ${when(sensorTls.until)}.` : "Connect to the sensor to check its certificate."} ${have ? `Newest one saved on this phone: until ${when(have.until)}.` : ""} It renews by itself: open the app with internet now and then and it carries the new one to the sensor.</div></div>`;
  if (WEB_COPY) return `<div class="card"><div class="label">The app's new home</div><div class="small muted" style="margin-top:4px">Once the sensor's secure address is set up, use <b>${SECURE_HOST}</b> instead of this copy: it records and opens offline, and keeps every run in one place. Move your runs there with <b>Copy runs</b> below, then <b>Paste runs</b> in the new app.</div></div>`;
  // on the sensor's plain address: one-time setup
  const done = sensorTls && sensorTls.secure, link = localStorage.getItem("pls.setupLink");
  if (done) return `<div class="card tint"><div class="label">Secure address</div><div class="small muted" style="margin:4px 0 10px">✓ Set up: certificate good until ${when(sensorTls.until)}. The secure address is a new copy of the app, so bring your runs: tap <b>Copy all</b> below first, then open it, add it to your Home Screen and tap <b>Paste runs</b> in its Settings.</div><a class="btn primary" href="${SECURE_URL}">Open ${SECURE_HOST}</a></div>`;
  return `<div class="card tint"><div class="label">Set up the secure address · once</div>
    <div class="small muted" style="margin:4px 0 10px">Gives the app one home at <b>${SECURE_HOST}</b> that records, opens offline anywhere and keeps every run together. Takes about 5 minutes.</div>
    <ol class="steps">
      <li><b>On the SpeedLidar Wi-Fi</b>, tap <button class="btn sm" data-act="cert-copy">Copy setup link</button>${link ? ` <span class="small" style="color:var(--good)">✓ copied</span>` : ""}</li>
      <li>Turn <b>Wi-Fi off</b> (cellular on). Paste the link into Safari's address bar, sign in to GitHub if asked and tap <b>Commit changes</b>, then <b>Commit changes</b> again.</li>
      <li>Come back to <b>this page</b> and leave it open. In about 3 minutes it finds the certificate: ${have ? `<b style="color:var(--good)">✓ certificate ready (until ${when(have.until)})</b>` : `<span class="muted">waiting… <button class="btn sm ghost" data-act="cert-check">Check now</button></span>`}</li>
      <li>Turn <b>Wi-Fi back on</b> and join SpeedLidar. It installs the certificate on the sensor and moves to the secure address. Add that one to your Home Screen.</li>
    </ol>
    ${link ? `<textarea readonly rows="2" style="width:100%;font-size:12px;margin-top:6px" onclick="this.select()">${esc(link)}</textarea>` : ""}</div>`;
}
function pollLoop() {
  if (WEB_COPY) { const p = $("#conn"); p.className = "pill off"; p.textContent = "Offline app"; return; } poll().finally(() => setTimeout(pollLoop, view === "new" && ["waiting", "ready", "recording"].includes(cap.phase) ? 120 : 250)); }

// ---------------- sounds ----------------
// The ready chime is synthesised once into a WAV clip and played with an <audio> element.
// (iPhones mute Web Audio with the silent switch; an audio clip plays like music, so it still sounds
// with the switch on and goes out over a Bluetooth speaker.)
const CHIMES = {
  // the original ready chime: E5 · A5 · E6, sine with a little second harmonic, 15 ms rise, exponential fade
  original: { dur: 1.5, tones: [[659.25, 0, 0.32, 0.55], [880, 0.13, 0.32, 0.55], [1318.5, 0.26, 0.32, 1.1], [1318.5, 0, 0.06, 0.55, 1], [1760, 0.13, 0.06, 0.55, 1], [2637, 0.26, 0.06, 1.1, 1]] },
  // GateCamLive's finish beeps: 880 Hz, then 1320 Hz 0.13 s later
  gatecam: { dur: 0.5, beeps: [[880, 0, 0.09], [1320, 0.13, 0.14]] },
};
function renderChime(kind) {
  const C = CHIMES[kind] || CHIMES.original, sr = 44100, n = Math.floor(sr * C.dur), out = new Float32Array(n);
  // exponential rise 0.0001 → peak over 15 ms, then exponential fall to 0.0001 at `len` (same shape as before)
  for (const [f, t0, peak, len] of C.tones || []) {
    const w = 2 * Math.PI * f / sr, s0 = Math.floor(t0 * sr), a = 0.015, e = Math.min(n, s0 + Math.floor(len * sr));
    for (let i = s0; i < e; i++) {
      const t = (i - s0) / sr, env = t < a ? 1e-4 * Math.pow(peak / 1e-4, t / a) : peak * Math.pow(1e-4 / peak, (t - a) / (len - a));
      out[i] += env * Math.sin(w * (i - s0));
    }
  }
  // plain beeps with 5 ms edges so they don't click
  for (const [f, t0, len] of C.beeps || []) {
    const w = 2 * Math.PI * f / sr, s0 = Math.floor(t0 * sr), m = Math.floor(len * sr), edge = Math.floor(0.005 * sr);
    for (let k = 0; k < m && s0 + k < n; k++) out[s0 + k] += 0.3 * Math.min(1, k / edge, (m - k) / edge) * Math.sin(w * k);
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  // 16-bit mono WAV
  const bytes = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); bytes.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, sr, true); bytes.setUint32(28, sr * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); str(36, "data"); bytes.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 32767, true);
  return URL.createObjectURL(new Blob([bytes.buffer], { type: "audio/wav" }));
}
const chimeEls = {};
function chimeEl() {
  const kind = CHIMES[settings.chime] ? settings.chime : "original";
  if (!chimeEls[kind]) { const el = new Audio(renderChime(kind)); el.preload = "auto"; chimeEls[kind] = el; }
  return chimeEls[kind];
}
let wakeLock = null;
// called on a tap: lets the page play the chime later without a tap, and keeps the screen on where allowed
function unlockAudio() {
  voiceUnlocked = true;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  try {
    const el = chimeEl();
    if (!el._unlocked) {
      el.muted = true; el._want = false;
      const p = el.play();
      if (p) p.then(() => { if (!el._want) { el.pause(); el.currentTime = 0; } el.muted = false; el._unlocked = true; }).catch(() => { el.muted = false; });
    }
  } catch (e) {}
  try { if (!wakeLock && navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { wakeLock = w; w.addEventListener("release", () => (wakeLock = null)); }).catch(() => {}); } catch (e) {}
}
function chime() {
  try {
    const el = chimeEl(); el._want = true; el.muted = false; el.volume = 1;
    el.currentTime = 0;
    const p = el.play(); if (p) p.catch(() => toast("Tap the screen once so the phone allows the chime."));
  } catch (e) {}
}
function readySignal() {
  chime();
  setTimeout(() => say(cap.queue.length > 1 ? `${firstName(cap.athleteId)}, ready` : "Ready"), 1100);
  if (navigator.vibrate) try { navigator.vibrate([60, 40, 60]); } catch (e) {}
}
// the screen lock releases the wake lock; ask again when the app comes back
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && voiceUnlocked) unlockAudio(); });

// ---------------- capture flow ----------------
// phase: setup → waiting (athlete steps in) → ready (armed, chime) → recording (live) → processing → review / waiting again
const cap = { phase: "setup", mode: settings.lastMode, athleteId: settings.lastAthlete, target: settings.lastTarget, setup: settings.lastSetup, run: null, lastRun: null, armedAt: 0, error: null,
  queue: (settings.lastQueue || (settings.lastAthlete ? [settings.lastAthlete] : [])).filter((id) => athletes.some((x) => x.id === id)),
  session: DB.get("session", null), setsSeen: 0, liveFrom: null, live: null, sim: null,
  armId: null };
const saveSession = () => DB.set("session", cap.session);
const firstName = (id) => athleteById(id).name.split(" ")[0];
function nextUp(id) { const q = cap.queue; if (q.length < 2) return id; const i = q.indexOf(id); return q[(i + 1) % q.length]; }
// a saved run joins the session; then the next athlete in the queue is up
function keepRun(run) {
  runs.unshift(run); saveRuns();
  if (!cap.session) cap.session = { start: Date.now(), ids: [] };
  cap.session.ids.push(run.id); saveSession();
  cap.athleteId = nextUp(run.athleteId);
}
// how the sensor decides someone is ready, for this test
function armRule() {
  if (cap.mode === "sprint") return { stop: Math.round((cap.target + 1.5) * 100), gate: 500, hold: 1500, max: 9900, text: "Stand still within 5 m of the sensor for 1.5 s" };
  const box = Math.round(SETUPS[cap.setup].boxFt * FT * 100);
  return { stop: 0, gate: box - 1220, hold: 2000, max: box, text: "Stand still on your start mark for 2 s" };
}
// tell the sensor to wait for the next athlete (it arms itself when they stand still)
async function arm(now) {
  cap.error = null; cap.run = null; cap.live = null; cap.liveFrom = null; cap.sim = null;
  const r = armRule();
  cap.setsSeen = sensor.sets;
  if (sensor.connected) {
    const a = athleteById(cap.athleteId), sprint = cap.mode === "sprint", S = SETUPS[cap.setup] || {};
    const cfg = { dev: DEVICE_ID, mode: cap.mode, setup: cap.setup, target: cap.target, name: a.name, kg: a.kg || null };
    const body = new URLSearchParams({ stop: r.stop, gate: r.gate, hold: r.hold, max: r.max, cfg: JSON.stringify(cfg), who: a.name.slice(0, 23),
      evs: sprint ? "SPRINT" : S.pole ? "POLE RUN" : "VAULT", evl: sprint ? `Stop at ${cap.target} m` : `${S.boxFt >= 150 ? "Long" : "Short"} \u00b7 ${S.boxFt} ft`, tgt: sprint ? cap.target : 0 });
    if (now) body.set("now", "1");
    const seen = new Set(), names = [];
    for (const id of [...(cap.queue || []), ...athletes.map((x) => x.id)]) { const x = athleteById(id); if (x && x.name && !seen.has(x.id)) { seen.add(x.id); names.push(x.name.slice(0, 23)); } }
    body.set("roster", names.slice(0, 40).join("\n"));
    body.set("lineup", Math.min(40, new Set((cap.queue || []).filter((id) => athleteById(id))).size));
    try { const j = await (await fetch("/arm", { method: "POST", body, cache: "no-store" })).json(); if (j && j.arm != null) cap.armId = j.arm; }
    catch (e) { cap.error = "Couldn't reach the sensor. Join its Wi-Fi (SpeedLidar) and try again."; }
  }
  cap.phase = "waiting"; cap.armedAt = Date.now();
  render();
}
function toReady() { cap.phase = "ready"; cap.setsSeen = sensor.sets; readySignal(); render(); }
async function stopNow() { try { await fetch("/stop", { cache: "no-store" }); } catch (e) {} }
let fetching = false;
// the display (iPad on the bench) picked who's up next: set them up, keeping the same test
function takePick() {
  if (sensor.role !== "control" || disp.on) return;
  if (cap.pickSeen == null) { cap.pickSeen = sensor.pick; return; }   // older picks, from before we connected
  if (sensor.pick === cap.pickSeen) return;
  cap.pickSeen = sensor.pick;
  const n = sensor.pickName.trim().toLowerCase(), a = athletes.find((x) => x.name.trim().toLowerCase().slice(0, 23) === n);
  if (!a || a.id === cap.athleteId && cap.phase !== "setup") return;
  cap.athleteId = a.id;
  if (view === "new" && !cap.sim && (cap.phase === "waiting" || cap.phase === "ready")) {
    toast(`${a.name} is up (picked on the display)`);
    arm(sensor.state === 2);   // already standing ready: stay armed for the new athlete
  } else render();
}
// the display dragged the roster into a new order: that's today's lineup now (names above the line)
async function takeOrder() {
  if (sensor.role !== "control" || disp.on) return;
  if (cap.orderSeen == null) { cap.orderSeen = sensor.order; return; }
  if (sensor.order === cap.orderSeen) return;
  cap.orderSeen = sensor.order;
  let j; try { j = await (await fetch("/screen", { cache: "no-store" })).json(); } catch (e) { return; }
  if (!j || !Array.isArray(j.roster) || !(j.lineup > 0)) return;
  const byName = (n) => athletes.find((x) => x.name.trim().slice(0, 23).toLowerCase() === String(n).trim().toLowerCase());
  const q = j.roster.slice(0, j.lineup).map(byName).filter(Boolean).map((a) => a.id);
  if (!q.length || q.join() === cap.queue.join()) return;
  cap.queue = q; settings.lastQueue = q.slice(); saveSettings();
  toast("Lineup changed on the display"); render();
}
function onLive() {
  if (view !== "new" || cap.sim) return;
  if (cap.phase === "waiting" && sensor.sets > cap.setsSeen && sensor.state >= 2) toReady();
  else if (cap.phase === "ready" && sensor.state === 1) { cap.phase = "waiting"; toast("They stepped away. Waiting for someone to stand in again."); render(); }
  if (cap.phase === "ready" && sensor.state === 3) startLive(Math.max(0, sensor.go - 1500));
  if ((cap.phase === "ready" || cap.phase === "recording") && sensor.state === 4 && sensor.moved && !fetching) download();
}

// ---------------- live view during a run ----------------
function startLive(from) {
  cap.phase = "recording"; cap.liveFrom = from;
  cap.live = { t: [], d: [], d0: null, v: 0, top: 0, pts: [] };
  render();
}
function liveAdd(pts) {
  const L = cap.live; if (!L) return;
  for (const [ms, cm] of pts) {
    const lim = armRule().max; if (!(cm > 10 && cm < lim)) continue;
    L.t.push(ms / 1000); L.d.push(cm / 100);
    // start position: where they stood (median of the first readings)
    if (L.d0 == null && L.d.length >= 10) { const s = L.d.slice(0, 10).sort((a, b) => a - b); L.d0 = s[5]; }
    if (L.d0 == null) continue;
    // speed: straight-line fit over the last 0.3 s
    const n = L.t.length, t1 = L.t[n - 1]; let i = n - 1; while (i > 0 && t1 - L.t[i - 1] <= 0.3) i--;
    if (n - i >= 5) {
      let st = 0, sd = 0, stt = 0, std = 0, m = n - i;
      for (let k = i; k < n; k++) { st += L.t[k]; sd += L.d[k]; stt += L.t[k] * L.t[k]; std += L.t[k] * L.d[k]; }
      const v = (m * std - st * sd) / (m * stt - st * st);
      if (isFinite(v)) { L.v = L.v ? 0.6 * L.v + 0.4 * Math.max(0, v) : Math.max(0, v); L.top = Math.max(L.top, L.v); }
    }
    const x = Math.max(0, L.d[L.d.length - 1] - L.d0);
    if (!L.pts.length || x > L.pts[L.pts.length - 1][0] + 0.05) L.pts.push([x, L.v]);
  }
  liveDraw();
}
function liveSpan() { return cap.mode === "sprint" ? cap.target : Math.round(SETUPS[cap.setup].boxFt * FT - (cap.live && cap.live.d0 || 0)); }
function liveDraw() {
  const L = cap.live, el = $("#liveBox"); if (!L || !el) return;
  const x = L.pts.length ? L.pts[L.pts.length - 1][0] : 0;
  $("#liveD").textContent = x.toFixed(1); $("#liveV").textContent = L.v.toFixed(2); $("#liveTop").textContent = L.top ? `TOP ${L.top.toFixed(2)}` : "";
  const W = 340, H = 150, pl = 30, pr = 8, pt = 8, pb = 22, span = Math.max(5, liveSpan()), ym = 12;
  const X = (v) => pl + (v / span) * (W - pl - pr), Y = (v) => pt + (1 - Math.min(v, ym) / ym) * (H - pt - pb);
  let d = ""; for (const [a, b] of L.pts) d += (d ? "L" : "M") + X(Math.min(a, span)).toFixed(1) + " " + Y(b).toFixed(1);
  $("#livePath").setAttribute("d", d || "M0 0");
  $("#liveFill").setAttribute("d", d ? d + `L${X(Math.min(x, span)).toFixed(1)} ${Y(0)}L${X(0)} ${Y(0)}Z` : "M0 0");
}
function liveCardHTML() {
  const W = 340, H = 150, pl = 30, pr = 8, pt = 8, pb = 22, span = Math.max(5, liveSpan()), ym = 12;
  const X = (v) => pl + (v / span) * (W - pl - pr), Y = (v) => pt + (1 - v / ym) * (H - pt - pb);
  let grid = ""; for (const v of [3, 6, 9, 12]) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`;
  for (const t of niceTicks(0, span, 6)) grid += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${t}</text>`;
  return `<div id="liveBox" style="display:contents"><div class="st-label">Speed</div><div class="st-big"><span id="liveV">0.00</span><small>m/s</small></div>
    <div class="st-row"><div><div class="st-label">Distance</div><div class="st-mid"><span id="liveD">0.0</span><small>m</small></div></div><div class="st-ev" id="liveTop" style="color:var(--blue)"></div></div>
    <svg class="live-svg" viewBox="0 0 ${W} ${H}" aria-label="Live speed along the run"><defs><linearGradient id="lvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--purple);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--purple);stop-opacity:0"/></linearGradient></defs>
      ${grid}<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-opacity=".5"/>
      <path id="liveFill" d="M0 0" fill="url(#lvg)"/><path id="livePath" d="M0 0" fill="none" stroke="var(--pink)" stroke-width="3" stroke-linejoin="round"/></svg></div>`;
}

async function download() {
  fetching = true; cap.phase = "processing"; render();
  try {
    const buf = await (await fetch("/data", { cache: "no-store" })).arrayBuffer();
    const dv = new DataView(buf), n = dv.getUint32(0, true), maxCm = dv.getUint32(4, true);
    const t = new Array(n), d = new Array(n);
    for (let i = 0; i < n; i++) { t[i] = dv.getUint32(8 + i * 8, true); d[i] = dv.getUint16(12 + i * 8, true); }
    finishCapture({ t, d, maxCm });
  } catch (e) { cap.error = "Download from the sensor failed. Tap Start to try again."; cap.phase = "setup"; render(); }
  fetching = false;
}
function ctxFor(c) {
  const a = athleteById(c.athleteId);
  return c.mode === "sprint" ? { mode: "sprint", target: c.target, mass: a.kg || null } : { mode: "vault", setup: c.setup, mass: a.kg || null };
}
function finishCapture(raw) {
  const res = Engine.process(raw, ctxFor(cap));
  const live = !cap.simRun;
  if (res.error) {
    // a false start or a bad run: the same athlete goes again
    toast(res.error + " Same athlete, go again.");
    if (settings.solo) { arm(); return; }
    cap.error = res.error; arm(); return;
  }
  const run = { id: uid(), ts: Date.now(), athleteId: cap.athleteId, mode: cap.mode, res };
  if (cap.simRun) { run.sim = true; cap.simRun = false; if (run.mode === "vault") simPodPeak(run); }
  if (cap.mode === "sprint") run.target = cap.target; else run.setup = cap.setup;
  if (live && cap.armId != null) showOnSensor(run, cap.armId);
  if (settings.solo) {
    keepRun(run);
    say((cap.queue.length > 1 ? `${firstName(run.athleteId)}. ` : "") + speech(run) + (cap.queue.length > 1 ? ` Next up, ${firstName(cap.athleteId)}.` : ""));
    // results stay on screen until the next athlete steps in and the sensor arms
    cap.lastRun = run; cap.lastSaved = true; arm();
  } else { cap.run = run; cap.phase = "review"; say(speech(run)); render(); }
}
// the result on the sensor's own screen (the numbers that matter, formatted for it)
function showOnSensor(run, armId) {
  const R = run.res, f2s = (v) => (v != null && isFinite(v) ? v.toFixed(2) : "\u2013"), ft = (v) => (v != null && isFinite(v) ? ftLabel(v) : "\u2013");
  const n = (cap.session ? cap.session.ids.filter((id) => { const x = runs.find((r) => r.id === id); return x && x.athleteId === run.athleteId; }).length : 0) + 1;
  const p = { run: armId, hu: "m/s", fl: `${firstName(run.athleteId)} \u00b7 run ${n}`, fr: settings.solo ? "saved to phone" : "on the phone" };
  const cells = [];
  if (run.mode === "sprint") {
    p.strip = `${settings.solo ? "RUN SAVED" : "RUN DONE"} \u00b7 SPRINT`; p.h = "TOP SPEED"; p.hv = f2s(R.top && R.top.speed);
    if (R.cum && R.cum[10] != null) cells.push(["0\u201310 M", f2s(R.cum[10]), "s"]);
    if (R.fly10) cells.push(["FLY 10", f2s(R.fly10.time), "s"]);
    cells.push([`${run.target} M`, f2s(R.time), "s"]);
  } else {
    const pole = SETUPS[run.setup] && SETUPS[run.setup].pole, mid = settings.midOut;
    p.strip = `${settings.solo ? "RUN SAVED" : "RUN DONE"} \u00b7 ${pole ? "POLE RUN" : "VAULT"}`; p.h = "LAST 5 M"; p.hv = f2s(R.last5 && R.last5.speed);
    const c = contactsOf(run).find((x) => x.left && x.out === mid);
    cells.push(["TOP", f2s(R.top && R.top.speed), "m/s"], ["LEFTS", String(R.steps && R.steps.lefts || "\u2013"), ""],
      ["TAKEOFF", ft(R.takeoff && R.takeoff.outFt), ""], [`${mid}L MID`, c ? ft(spotFt(run, c)) : "\u2013", ""]);
  }
  cells.slice(0, 4).forEach(([k, v, u], i) => { p["k" + (i + 1)] = k; p["v" + (i + 1)] = v; p["u" + (i + 1)] = u; });
  fetch("/show", { method: "POST", body: new URLSearchParams(p), cache: "no-store" }).catch(() => {});
}
// ---------------- big display (a second device, e.g. an iPad on the tripod facing the athletes) ----------------
// Shows what the sensor's own screen shows, big: who's up next, the live run, the result.
const disp = { on: false, manual: false, dismissed: false, busy: false, data: null, menu: false, picker: false, pending: null, pendingAt: 0, rosterKey: "", dragging: false, order: null };
function startDisplay(manual) {
  if (disp.on) return;
  Object.assign(disp, { on: true, manual: !!manual, menu: false, data: null });
  let el = $("#disp"); if (!el) { el = document.createElement("div"); el.id = "disp"; document.body.appendChild(el); }
  el.onclick = (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const a = b.dataset.d;
    if (a === "menu") { disp.menu = !disp.menu; drawDisplay(); }
    else if (a === "claim") fetch(`/claim?dev=${DEVICE_ID}`, { cache: "no-store" }).then(() => { sensor.role = "control"; disp.dismissed = true; stopDisplay(); toast("This device is the controller now."); }).catch(() => toast("Couldn't reach the sensor."));
    else if (a === "close") { disp.dismissed = true; stopDisplay(); }
    else if (a === "picker") { disp.picker = true; drawDisplay(); }
    else if (a === "pickclose") { disp.picker = false; drawDisplay(); }
    else if (a === "pick") {
      const name = b.dataset.name; disp.pending = name; disp.pendingAt = Date.now(); disp.picker = false; drawDisplay();
      fetch("/pick", { method: "POST", body: new URLSearchParams({ name }), cache: "no-store" }).catch(() => toast("Couldn't reach the sensor."));
    }
  };
  document.documentElement.classList.add("disp-on");
  try { if (!wakeLock && navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { wakeLock = w; w.addEventListener("release", () => (wakeLock = null)); }).catch(() => {}); } catch (e) {}
  drawDisplay(); dispLoop();
}
function stopDisplay() {
  disp.on = false; const el = $("#disp"); if (el) el.remove();
  document.documentElement.classList.remove("disp-on"); render();
}
async function dispLoop() {
  if (!disp.on) return;
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 1500);
    disp.data = await (await fetch("/screen", { cache: "no-store", signal: ctl.signal })).json(); clearTimeout(to); disp.lost = 0;
  } catch (e) { if (++disp.lost > 8) disp.data = null; }
  drawDisplay();
  setTimeout(dispLoop, 200);
}
// the big display's in-air bar: flies the takeoff speed (h = v·t − g·t²/2) up to its peak, every frame
function dispAirTick() {
  if (dispAirTick.on) return; dispAirTick.on = true;
  const f = () => {
    const A = disp.air, fill = $("#dJfill"), val = $("#dJval");
    if (!A || !disp.on || !fill) { dispAirTick.on = false; return; }
    const g = 9.80665, t = (performance.now() - A.t0) / 1000, tp = A.v / g, peak = (A.v * A.v) / (2 * g);
    const h = t >= tp ? peak : Math.max(0, A.v * t - (g * t * t) / 2), top = parseFloat(fill.parentElement.dataset.top) || 0.7;
    fill.style.height = `${Math.min(100, (100 * h) / top)}%`; if (val) val.textContent = (h * 100).toFixed(0);
    if (t >= tp) { const n = $("#dJnote"); if (n && !n.dataset.peak) { n.dataset.peak = "1"; n.textContent = "PEAK \u00b7 EXACT NUMBER NEXT"; } }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
function drawDisplay() {
  const el = $("#disp"); if (!el) return;
  const j = disp.data, E = esc;
  // a name just tapped shows straight away, until the sensor confirms it
  if (j && disp.pending) {
    const cur = j.s === "result" ? j.next : j.who;
    if (cur === disp.pending || Date.now() - disp.pendingAt > 4000) disp.pending = null; else if (j.s === "result") j.next = disp.pending; else j.who = disp.pending;
  }
  const roster = (j && j.roster) || [];
  const dist = (m, vault, dp = 2) => (m == null ? "\u2013" : vault ? ftLabel(m / FT) : `${m.toFixed(dp)}<small>m</small>`);
  const strip = (cls, label, right = "", act = "") => `<div class="d-strip ${cls}"${act ? ` data-d="${act}"` : ""}><span>${E(label)}</span><span>${right}</span></div>`;
  const evl = j ? [j.evs, j.evl].filter(Boolean).map(E).join(" \u00b7 ") : "";
  let body = "", st = "";
  if (!j) { st = strip("d-dim", "NO SENSOR"); body = `<div class="d-center"><div class="d-xl">JOIN THE WI-FI</div><div class="d-sub">SpeedLidar \u00b7 password vault1234</div></div>`; }
  else if (j.s === "aim") {
    const col = j.sig > 70 ? "d-green" : j.sig > 35 ? "d-amber" : "d-red", n = 8, on = Math.round((j.sig / 100) * n);
    let bars = ""; for (let i = 0; i < n; i++) bars += `<i class="${i < on ? "on" : ""}" style="height:${30 + 70 * i / (n - 1)}%"></i>`;
    let rbars = ""; for (let i = n - 1; i >= 0; i--) rbars += `<i class="${i < on ? "on" : ""}" style="height:${30 + 70 * i / (n - 1)}%"></i>`;
    st = strip(col, "AIMING", `${j.sig}%`);
    body = `<div class="d-aim ${col}"><div class="d-bars">${bars}</div><div class="d-target ${on >= n ? "on" : ""}"></div><div class="d-bars">${rbars}</div></div>
      <div class="d-sub">${on >= n ? "Locked on: leave the tripod there" : "Turn the tripod slowly \u00b7 aim at athlete\u2019s back"}</div>`;
  } else if (j.s === "armed") {
    st = strip("d-pink", "ARMED", E(j.who), roster.length ? "picker" : "");
    body = `<div class="d-fit d-pulse">${innerHeight > innerWidth ? `<div>GO</div><div>WHEN</div>` : `<div>GO WHEN</div>`}<div class="d-pinkt">READY</div></div>`;
  } else if (j.s === "rec") {
    const prog = j.runTarget > 0 ? Math.min(1, j.runDist / j.runTarget) : 0;
    st = strip("d-purple", "RECORDING", E(j.who));
    body = `<div class="d-label">SPEED</div><div class="d-num">${j.speed.toFixed(2)}<small>m/s</small></div>
      <div class="d-bar"><b style="width:${(prog * 100).toFixed(1)}%"></b></div>`;
  } else if (j.s === "saving") {
    st = strip("d-blue", "RUN DONE", E(j.who));
    body = `<div class="d-center"><div class="d-xl d-pulse">WORKING IT OUT</div><div class="d-sub">The result shows here in a second.</div></div>`;
  } else if (j.s === "result") {
    st = strip("d-blue", j.strip || "RESULT", E((j.fl || "").split(" \u00b7 ")[0].split(" ")[0]));
    body = `<div class="d-res"><div><div class="d-label">${E(j.head)}</div><div class="d-num d-bluet">${E(j.hv)}<small>${E(j.hu)}</small></div></div>
      <div class="d-cells">${(j.cells || []).map(([k, v, u]) => `<div><div class="d-label">${E(k)}</div><div class="d-cell">${E(v)}<small>${E(u)}</small></div></div>`).join("")}</div></div>
      ${j.next ? `<div class="d-next"${roster.length ? ' data-d="picker"' : ""}><span>UP NEXT</span><b>${E(j.next)}</b>${roster.length ? "<i>change</i>" : ""}</div>` : ""}`;
  } else if (j.s === "jump") {
    // the Jump test (waist pods): up now → set → in the air (a bar rising with the height) → result
    const ph = j.jPh || 0;
    if (ph !== 2 && ph !== 3) disp.air = null;
    if (j.jRes) {
      st = strip("d-blue", "VERTICAL JUMP", E(j.jRw));
      body = `<div class="d-res"><div><div class="d-label">TAKEOFF TO PEAK</div><div class="d-num d-bluet">${E(j.jH)}<small>cm</small></div></div>
        <div class="d-cells">${j.jHs ? `<div><div class="d-label">STANDING TO PEAK</div><div class="d-cell">${E(j.jHs)}<small>cm</small></div></div>` : ""}${j.jHm ? `<div><div class="d-label">JUMP MAT</div><div class="d-cell">${E(j.jHm)}<small>cm</small></div></div>` : ""}</div></div>
        ${j.jNext ? `<div class="d-next"><span>UP NEXT</span><b>${E(j.jNext)}</b></div>` : ""}`;
    } else if ((ph === 2 || ph === 3) && j.jV > 0) {
      if (!disp.air || disp.air.v !== j.jV) disp.air = { v: j.jV, t0: performance.now() - (j.jAir || 0) };
      const best = parseFloat(j.jBest) / 100 || 0, peak = (j.jV * j.jV) / (2 * 9.80665), top = Math.max(0.7, Math.ceil(Math.max(best, peak) * 1.2 * 10) / 10);
      let ticks = ""; for (let c = 10; c < top * 100; c += 10) ticks += `<i style="bottom:${(100 * c) / 100 / top}%"><span>${c}</span></i>`;
      st = strip("d-purple", ph === 2 ? "IN THE AIR" : "LANDED", E(j.jWho));
      body = `<div class="d-jump"><div class="d-jbar" data-top="${top}">${ticks}<b id="dJfill"></b>${best ? `<em style="bottom:${(100 * best) / top}%"><span>BEST ${E(j.jBest)}</span></em>` : ""}</div>
        <div class="d-jread"><div class="d-label">HEIGHT</div><div class="d-num"><span id="dJval">0</span><small>cm</small></div><div class="d-sub" id="dJnote">${E(j.jPod)}</div></div></div>`;
      dispAirTick();
    } else if (ph === 1) {
      st = strip("d-pink", "SET", E(j.jWho));
      body = `<div class="d-fit d-pulse">${innerHeight > innerWidth ? `<div>JUMP</div><div>WHEN</div>` : `<div>JUMP WHEN</div>`}<div class="d-pinkt">READY</div></div>`;
    } else if (ph === 3) {
      st = strip("d-purple", "LANDED", E(j.jWho));
      body = `<div class="d-center"><div class="d-xl">STAND STILL</div><div class="d-sub">The height shows here in a second.</div></div>`;
    } else {
      st = strip("d-green", "JUMP TEST", E(j.jPod));
      body = `<div class="d-label">UP NOW</div><div class="d-name">${E(j.jWho || "\u2013")}</div>
        <div class="d-ev">Vertical jump${j.jBest ? ` \u00b7 best today ${E(j.jBest)} cm` : ""}</div><div class="d-cue">Stand still \u00b7 jump \u00b7 stand still</div>`;
    }
  } else if (j.s === "nolidar") {
    st = strip("d-amber", "NO LIDAR");
    body = `<div class="d-center"><div class="d-xl d-ambert">NO SIGNAL</div><div class="d-sub">The LiDAR isn\u2019t sending anything. Check its cable and the power bank.</div></div>`;
  } else if (j.s === "update") {
    st = strip("d-purple", "UPDATING");
    body = `<div class="d-center"><div class="d-num">${j.pct}%</div><div class="d-bar"><b style="width:${j.pct}%"></b></div></div>`;
  } else {
    // ready / boot / wi-fi: who's up next
    const holding = j.inZone && j.hold > 0.15;
    st = strip(j.armed ? "d-green" : "d-dim", j.armed ? "READY" : "WAITING", j.dist != null ? dist(j.dist, j.vault) : "");
    body = j.armed && j.who ? `<div class="d-label">UP NEXT</div><div class="d-name">${E(j.who)}</div><div class="d-ev">${evl}</div>
        ${holding ? `<div class="d-hold"><span>HOLD STILL</span><div class="d-bar"><b style="width:${(j.hold * 100).toFixed(0)}%"></b></div></div>` : `<div class="d-cue">Stand at the start to arm</div>`}`
      : `<div class="d-center"><div class="d-xl">WAITING</div><div class="d-sub">Set up the next run on the controller.</div></div>`;
  }
  // The roster: always beside UP NEXT; over the armed and result screens when you tap the name.
  // It lives in its own element (only rebuilt when it changes) so scrolling it isn't interrupted.
  const sName = j ? (j.s === "boot" || j.s === "wifi" ? "ready" : j.s === "jump" ? (j.jRes ? "result" : j.jPh === 1 ? "armed" : "jump") : j.s) : "none";
  const side = !!(j && roster.length && sName === "ready" && j.armed && j.who);
  const pop = !!(j && roster.length && disp.picker && (sName === "armed" || sName === "result" || sName === "ready"));
  let main = el.querySelector(".d-main"), rs = el.querySelector(".d-roster");
  if (!main) { el.innerHTML = `<div class="d-main"></div><div class="d-roster" hidden></div>`; main = el.querySelector(".d-main"); rs = el.querySelector(".d-roster"); }
  main.innerHTML = `${st}<div class="d-body s-${sName}${side ? " d-side" : ""}">${body}</div>
    <button class="d-menu" data-d="menu" aria-label="Display options">\u2022\u2022\u2022</button>
    ${disp.menu ? `<div class="d-pop"><button data-d="claim">Use this device as the controller</button><button data-d="close">Close the display</button></div>` : ""}
    ${pop && !side ? `<div class="d-shade" data-d="pickclose"></div>` : ""}`;
  const cur = j ? (sName === "result" ? j.next || j.who : j.who) : "";
  // a just-dragged order shows straight away, until the sensor has it
  let names = roster, lineup = Math.min((j && j.lineup) || 0, roster.length);
  if (disp.order) { if ((j && j.order) > disp.order.after || Date.now() - disp.order.at > 4000) disp.order = null; else ({ names, lineup } = disp.order); }
  const mode = side ? "side" : pop ? "pop" : "", key = `${mode}|${cur}|${lineup}|${names.join("|")}`;
  if (key !== disp.rosterKey && !disp.dragging) {
    disp.rosterKey = key;
    rs.hidden = !mode; rs.className = `d-roster ${mode}`;
    rs.innerHTML = mode ? `<div class="d-label">${mode === "pop" ? (sName === "result" ? "WHO\u2019S UP NEXT?" : "WHO\u2019S UP?") : "TAP TO PICK \u00b7 HOLD &amp; DRAG TO MOVE"}</div>` +
      names.map((n, i) => (i === lineup && lineup > 0 ? `<div class="d-div">NOT IN TODAY\u2019S LINEUP</div>` : "") +
        `<button data-d="pick" data-name="${E(n)}" class="${n === cur ? "on" : ""}"><span class="nm">${E(n)}</span><span class="d-grip" data-d="grip" aria-label="Drag to move">\u2261</span></button>`).join("") : "";
    if (!rs.dataset.drag) { rs.dataset.drag = "1"; rosterDrag(rs, (order, lu) => {
      disp.order = { names: order, lineup: lu, at: Date.now(), after: (disp.data && disp.data.order) || 0 }; disp.rosterKey = ""; drawDisplay();
      fetch("/order", { method: "POST", body: new URLSearchParams({ roster: order.join("\n"), lineup: lu }), cache: "no-store" }).catch(() => toast("Couldn't reach the sensor."));
    }); }
  }
  if (mode) { const sh = main.querySelector(".d-strip"); rs.style.top = `${sh ? sh.offsetHeight : 0}px`; }
  // GO WHEN READY: as big as the screen allows (2 lines across, 3 when the screen stands up)
  const fit = el.querySelector(".d-fit");
  if (fit) {
    const box = fit.parentElement, cw = box.clientWidth, ch = box.clientHeight;
    fit.style.fontSize = "100px";
    const k = Math.min(cw / fit.scrollWidth, ch / fit.scrollHeight);
    fit.style.fontSize = `${Math.floor(100 * k * 0.97)}px`;
  }
}
// rearrange the roster: hold a name anywhere on its card (or grab its \u2261 straight away) and drag it up or down, also across
// the lineup line. Fingers go through touch events (iPhone Safari cancels pointer events once it thinks you're scrolling,
// and preventing touchmove is the one thing it always honours); a mouse or pen goes through pointer events.
function rosterDrag(rs, onDrop, st = disp, attr = "name") {
  let d = null, hold = null, eat = false;
  const items = () => [...rs.children].filter((c) => c.tagName === "BUTTON" || c.classList.contains("d-div"));
  const rowOf = (t) => { const it = t && t.closest && t.closest("button"); return it && it.parentElement === rs ? it : null; };
  const start = (it, y) => {
    cancelHold();
    d = { it, y, moved: false, gap: parseFloat(getComputedStyle(rs).rowGap) || 0 };
    st.dragging = true; it.classList.add("drag"); eat = true;
    try { navigator.vibrate && navigator.vibrate(12); } catch (x) {}
  };
  const cancelHold = () => { if (hold) { clearTimeout(hold.t); hold = null; } };
  const arm = (it, x, y) => { cancelHold(); eat = false; hold = { x, y, t: setTimeout(() => { const h = hold; hold = null; if (h) start(it, h.y); }, 280) }; };
  const move = (x, y) => {
    if (hold && Math.hypot(x - hold.x, y - hold.y) > 10) cancelHold();
    if (!d) return;
    // near the top or bottom edge: scroll the list along
    const box = rs.getBoundingClientRect(), edge = 50;
    const toward = y - d.y;
    const sc = y < box.top + edge && toward < -20 ? -10 : y > box.bottom - edge && toward > 20 ? 10 : 0;
    if (sc) { const before = rs.scrollTop; rs.scrollTop += sc; d.y -= rs.scrollTop - before; }
    let dy = y - d.y; if (Math.abs(dy) > 4) d.moved = true;
    const list = items(), i = list.indexOf(d.it), r = d.it.getBoundingClientRect(), mid = r.top + r.height / 2 - (parseFloat(d.it.style.transform.slice(11)) || 0) + dy;
    const next = list[i + 1], prev = list[i - 1];
    if (next) { const nr = next.getBoundingClientRect(); if (mid > nr.top + nr.height / 2) { rs.insertBefore(next, d.it); d.y += nr.height + d.gap; } }
    if (prev) { const pr = prev.getBoundingClientRect(); if (mid < pr.top + pr.height / 2) { rs.insertBefore(d.it, prev); d.y -= pr.height + d.gap; } }
    dy = y - d.y; d.it.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    cancelHold();
    if (!d) return;
    const { it, moved } = d; d = null; st.dragging = false;
    it.style.transform = ""; it.classList.remove("drag");
    setTimeout(() => (eat = false), 400);
    if (!moved) return;
    const list = items(), order = list.filter((c) => c.tagName === "BUTTON").map((c) => c.dataset[attr]);
    const div = list.findIndex((c) => c.classList.contains("d-div"));
    onDrop(order, div >= 0 ? div : order.length);
  };
  // fingers
  rs.addEventListener("touchstart", (e) => {
    const it = rowOf(e.target); if (!it || e.touches.length > 1) { cancelHold(); return; }
    const t = e.touches[0];
    if (e.target.closest(".d-grip")) { e.preventDefault(); eat = false; start(it, t.clientY); return; }
    arm(it, t.clientX, t.clientY);
  }, { passive: false });
  rs.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (d) e.preventDefault(); move(t.clientX, t.clientY); }, { passive: false });
  rs.addEventListener("touchend", end); rs.addEventListener("touchcancel", end);
  // mouse and pen
  rs.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    const it = rowOf(e.target); if (!it || e.button !== 0) return;
    if (e.target.closest(".d-grip")) { e.preventDefault(); eat = false; start(it, e.clientY); } else arm(it, e.clientX, e.clientY);
    try { rs.setPointerCapture(e.pointerId); } catch (x) {}
  });
  rs.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") move(e.clientX, e.clientY); });
  rs.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") end(); });
  rs.addEventListener("pointercancel", (e) => { if (e.pointerType !== "touch") end(); });
  rs.addEventListener("contextmenu", (e) => { if (d || hold) e.preventDefault(); });
  // a drag (or a hold) isn't a tap
  rs.addEventListener("click", (e) => { if (eat) { e.stopPropagation(); e.preventDefault(); eat = false; } }, true);
}
function devicesCardHTML() {
  if (WEB_COPY) return "";
  const role = sensor.connected ? sensor.role : null;
  return `<div class="card"><div class="label">Devices</div>
    <div class="small muted" style="margin:4px 0 10px">${role === "control" ? "This device is the <b>controller</b>: it sets up runs and saves them." : role === "display" ? "This device is a <b>display</b>: it shows the runs big for the athletes, and doesn\u2019t save them." : "Connect to the sensor to see this device\u2019s role."}
      The first device to connect is the controller; any other one becomes a big display (an iPad on the tripod, facing the athletes).${sensor.phones > 1 ? ` ${sensor.phones} devices are on the sensor now.` : ""}</div>
    <div class="row"><button class="btn" data-act="disp-show">Show the big display</button>${role === "display" ? `<button class="btn" data-act="disp-claim">Make this the controller</button>` : ""}</div></div>`;
}
// ---------------- sensor firmware update (over the sensor's Wi-Fi) ----------------
const FIRMWARE_URL = "https://github.com/paytonpittspv/LiDAR-Sensor-App/releases/download/firmware/SpeedLidar.bin";
let fwUpload = null;   // { pct, msg }
function updateFirmware(file) {
  if (!file) return;
  if (!/\.bin$/i.test(file.name) || file.size < 100000) { toast("Pick the SpeedLidar.bin file."); return; }
  fwUpload = { pct: 0, msg: "Sending to the sensor\u2026" }; render();
  const x = new XMLHttpRequest();
  x.open("POST", "/update");
  x.setRequestHeader("Content-Type", "application/octet-stream");
  x.upload.onprogress = (e) => { if (e.lengthComputable) { fwUpload.pct = Math.round((100 * e.loaded) / e.total); const el = $("#fwPct"); if (el) el.textContent = `${fwUpload.pct}%`; } };
  x.onload = () => {
    let j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
    fwUpload = j && j.ok ? { pct: 100, msg: "Updated. The sensor restarts by itself: reconnect to its Wi-Fi in a few seconds." } : { pct: 0, msg: `Update failed${j && j.error ? `: ${j.error}` : ""}. Nothing changed on the sensor.` };
    render();
  };
  x.onerror = () => { fwUpload = { pct: 0, msg: "Lost the sensor during the update. If its screen says UPDATING, wait for it to finish; otherwise try again." }; render(); };
  x.send(file);
}
// how long the sensor has been on, and why it last started (tells a power cut from a crash)
function restartLine(t) {
  const m = Math.floor(t.up / 60), on = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  const why = { power: "the power came on (a power cut, or switched on)", brownout: "the power dipped too low", crash: "the software crashed", froze: "the software froze and restarted itself", restart: "it was restarted (after an update)" }[t.reset] || "something else";
  const bad = t.reset === "crash" || t.reset === "froze" || t.reset === "brownout";
  return `On for <b>${on}</b> · started ${t.boots} time${t.boots === 1 ? "" : "s"} in all · last start: <b style="color:${bad ? "var(--bad)" : "var(--text)"}">${why}</b>`;
}
function firmwareCardHTML() {
  if (WEB_COPY) return "";
  return `<div class="card"><div class="label">Sensor firmware</div>
    <div class="small muted" style="margin:4px 0 10px">${sensor.connected && sensor.fw ? `The sensor is running <b>${esc(sensor.fw)}</b>.` : "Connect to the sensor to see its version."} To update it: with internet, <a href="${FIRMWARE_URL}">download SpeedLidar.bin</a> to Files; then on the SpeedLidar Wi-Fi, pick it here. Takes about 30 seconds.</div>
    ${sensorTls && sensorTls.up != null ? `<div class="small" style="margin:-2px 0 10px">${restartLine(sensorTls)}</div>` : ""}
    <div class="row"><label class="btn" style="cursor:pointer">Update firmware<input type="file" id="fwFile" accept=".bin,application/octet-stream" class="hidden"></label>
    ${sensor.connected ? `<button class="btn" data-act="about-show">Show About on the sensor</button>` : ""}</div>
    ${fwUpload ? `<div class="small" style="margin-top:8px"><b id="fwPct">${fwUpload.pct}%</b> ${esc(fwUpload.msg)}</div>` : ""}</div>`;
}
// no sensor: play a simulated run through the same live view, in real time
function simulateRun() {
  const seed = Math.floor(Math.random() * 1e6) + 1, vmax = 8.4 + Math.random() * 1.0;
  let raw;
  if (cap.mode === "sprint") raw = Engine.simulate({ seed, vmax, target: cap.target, back: 3 }).raw;
  else {
    const steps = 2 * (7 + Math.floor(Math.random() * 3)) + 1;   // start on the mark + 14-18 steps
    const pole = SETUPS[cap.setup].pole;
    raw = Engine.simulate({ seed, vmax, steps, hop: Math.random() < 0.3, back: 3, finish: (Math.random() - 0.5) * 0.8, popup: pole, flight: 0.5 + Math.random() * 0.2 }).raw;
    {
      // shift so the takeoff lands a realistic distance from the box
      const box = SETUPS[cap.setup].boxFt * FT, probe = Engine.process(raw, { mode: "vault", setup: cap.setup, noBox: true });
      if (!probe.error) { const shift = Math.round((box - (11 + Math.random() * 3) * FT - 0.5 - probe.takeoff.sensor) * 100); raw.d = raw.d.map((cm) => (cm > 0 ? Math.max(1, cm + shift) : cm)); }
    }
  }
  const t0 = raw.t[0], n = raw.t.length; let i = 0;
  cap.sim = true; cap.simRun = true; startLive(0); cap.sim = true;
  const t0wall = performance.now();
  const step = () => {
    if (cap.phase !== "recording" || !cap.live) return;
    const now = (performance.now() - t0wall) * 1000, pts = [];
    while (i < n && raw.t[i] - t0 <= now) { if (i % 20 === 0) pts.push([Math.round((raw.t[i] - t0) / 1000), raw.d[i]]); i++; }
    liveAdd(pts);
    if (i < n) setTimeout(step, 100); else { cap.phase = "processing"; render(); setTimeout(() => { cap.sim = null; finishCapture(raw); }, 250); }
  };
  step();
}

// ---------------- SVG charts ----------------
function niceTicks(a, b, n) {
  const span = b - a || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(6)); return out;
}
function svgChart(o) {
  const W = o.w || 640, H = o.h || 260, [pl, pr, pt, pb] = o.pad || [40, 12, 14, 30];
  const X = (x) => pl + ((x - o.x0) / (o.x1 - o.x0 || 1)) * (W - pl - pr);
  const Y = (y) => pt + (1 - (y - o.y0) / (o.y1 - o.y0 || 1)) * (H - pt - pb);
  const tc = o.textColor || "var(--muted)", gc = o.gridColor || "var(--line)", fz = o.font || 11;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "chart")}" xmlns="http://www.w3.org/2000/svg">`;
  for (const sh of o.shades || []) s += `<rect x="${X(sh.a)}" y="${pt}" width="${Math.max(0, X(sh.b) - X(sh.a))}" height="${H - pt - pb}" fill="${sh.color}" opacity="${sh.op || 0.18}"/>`;
  for (const t of o.yt || []) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke="${gc}" stroke-width="1"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="${fz}" fill="${tc}">${o.yfmt ? o.yfmt(t) : t}</text>`;
  for (const t of o.xt || []) s += `<text x="${X(t)}" y="${H - pb + 16}" text-anchor="middle" font-size="${fz}" fill="${tc}">${o.xfmt ? o.xfmt(t) : t}</text>`;
  if (o.xl) s += `<text x="${(pl + W - pr) / 2}" y="${H - 2}" text-anchor="middle" font-size="${fz}" fill="${tc}">${esc(o.xl)}</text>`;
  if (o.yl) s += `<text transform="translate(11 ${(pt + H - pb) / 2}) rotate(-90)" text-anchor="middle" font-size="${fz}" fill="${tc}">${esc(o.yl)}</text>`;
  for (const v of o.vlines || []) {
    s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${pt - (v.label ? 0 : 0)}" y2="${H - pb}" stroke="${v.color || tc}" stroke-width="${v.w || 1}" ${v.dash ? `stroke-dasharray="${v.dash}"` : ""}/>`;
    if (v.label) s += `<text x="${X(v.x) + 3}" y="${pt + 10}" font-size="${fz - 1}" font-weight="700" fill="${v.tcolor || tc}">${esc(v.label)}</text>`;
    if (v.label2) s += `<text x="${X(v.x) + 3}" y="${pt + 22}" font-size="${fz - 1.5}" fill="${v.tcolor2 || tc}" font-family="ui-monospace,Menlo,monospace">${esc(v.label2)}</text>`;
  }
  for (const h of o.hlines || []) {
    s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-width="${h.w || 1.2}" ${h.dash ? `stroke-dasharray="${h.dash}"` : ""}/>`;
    if (h.label) s += `<text x="${pl + 4}" y="${Y(h.y) - 5}" font-size="${fz - 1}" fill="${h.tcolor || tc}" font-family="ui-monospace,Menlo,monospace">${esc(h.label)}</text>`;
  }
  let gid = 0;
  for (const se of o.series || []) {
    if (!se.fill) continue;
    let d = "", xa = null, xb = null;
    for (let i = 0; i < se.x.length; i++) { if (se.x[i] < o.x0 - 1e-9 || se.x[i] > o.x1 + 1e-9 || !isFinite(se.y[i])) continue; if (xa == null) xa = se.x[i]; xb = se.x[i]; d += (d ? "L" : "M") + X(se.x[i]).toFixed(1) + " " + Y(Math.max(o.y0, Math.min(o.y1, se.y[i]))).toFixed(1); }
    const id = "svgf" + Math.random().toString(36).slice(2, 8) + gid++;
    s += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity="${se.fillOp || 0.28}"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient></defs>`;
    if (d) s += `<path d="${d}L${X(xb).toFixed(1)} ${Y(o.y0)}L${X(xa).toFixed(1)} ${Y(o.y0)}Z" fill="url(#${id})"/>`;
  }
  for (const se of o.series || []) {
    let d = "";
    for (let i = 0; i < se.x.length; i++) { if (se.x[i] < o.x0 - 1e-9 || se.x[i] > o.x1 + 1e-9 || !isFinite(se.y[i])) continue; d += (d ? "L" : "M") + X(se.x[i]).toFixed(1) + " " + Y(Math.max(o.y0, Math.min(o.y1, se.y[i]))).toFixed(1); }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 2}" stroke-linejoin="round" stroke-linecap="round" ${se.op ? `opacity="${se.op}"` : ""} ${se.dash ? `stroke-dasharray="${se.dash}"` : ""}/>`;
  }
  for (const p of o.segs || []) s += `<line x1="${X(p.x0)}" x2="${X(p.x1)}" y1="${Y(p.y)}" y2="${Y(p.y)}" stroke="${p.color}" stroke-width="${p.w || 1.4}"/>`;
  for (const p of o.dots || []) {
    s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 4}" fill="${p.fill || "#fff"}" stroke="${p.stroke || "none"}" stroke-width="${p.sw || 2}" ${p.attrs || ""}/>`;
    if (p.label) s += `<text x="${X(p.x) + (p.dx || 0)}" y="${Y(p.y) + (p.dy || 16)}" text-anchor="middle" font-size="${fz - 1}" fill="${p.tcolor || tc}" font-weight="700" ${p.mono ? 'font-family="ui-monospace,Menlo,monospace"' : ""}>${esc(p.label)}</text>`;
  }
  if (o.extra) s += o.extra(X, Y);
  return s + "</svg>";
}
// ---------------- live charts (drawn at the real width, like a native app chart) ----------------
// spec: { h, x0, x1, y0, y1, xTitle, yUnit, xfmt, yfmt, series:[{x,y,color,fill,w,detail}], bands:[{a,b,label}],
//         marks:[{x,y}], dots:[{x,y,attrs}], vlines:[{x,label}], focus:{x}, fmtPill(x, vals), detailToggle }
let LC = {}, lcN = 0, lcDetail = false;
function lcSlot(spec) { const k = "lc" + ++lcN; LC[k] = spec; return `<div class="lc" data-lc="${k}" style="height:${spec.h || 240}px"></div>`; }
function lcInterp(xs, ys, x) {
  if (!xs.length) return NaN;
  const tol = 0.02 * Math.abs(xs[xs.length - 1] - xs[0]);
  if (x < xs[0] - tol || x > xs[xs.length - 1] + tol) return NaN;
  x = Math.max(xs[0], Math.min(xs[xs.length - 1], x));
  let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; }
  const f = (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1e-9); return ys[lo] + f * (ys[hi] - ys[lo]);
}
function lcDraw(el) {
  const o = LC[el.dataset.lc]; if (!o) return;
  const W = Math.max(240, el.clientWidth), H = o.h || 240, pl = 34, pr = 14, pt = 34, pb = 38;
  const X = (x) => pl + ((x - o.x0) / ((o.x1 - o.x0) || 1)) * (W - pl - pr);
  const Y = (y) => pt + (1 - (Math.max(o.y0, Math.min(o.y1, y)) - o.y0) / ((o.y1 - o.y0) || 1)) * (H - pt - pb);
  const yb = H - pb, fz = 11, mono = 'font-variant-numeric="tabular-nums"';
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "chart")}" xmlns="http://www.w3.org/2000/svg" style="touch-action:pan-y">`;
  s += `<defs>${o.series.map((se, i) => se.fill ? `<linearGradient id="${el.dataset.lc}g${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${se.color};stop-opacity:.32"/><stop offset="1" style="stop-color:${se.color};stop-opacity:0"/></linearGradient>` : "").join("")}</defs>`;
  // bands (e.g. last 5 m)
  for (const b of o.bands || []) {
    s += `<rect x="${X(b.a)}" y="${pt}" width="${Math.max(0, X(b.b) - X(b.a))}" height="${yb - pt}" fill="var(--purple)" opacity=".13" rx="3"/>`;
    if (b.label) s += `<text x="${(X(b.a) + X(b.b)) / 2}" y="${yb - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--purple)">${esc(b.label)}</text>`;
  }
  // grid + axes
  for (const t of niceTicks(o.y0, o.y1, 4)) { if (t <= o.y0 + 1e-9) continue; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="${fz}" fill="var(--muted)" ${mono}>${o.yfmt ? o.yfmt(t) : t}</text>`; }
  s += `<line x1="${pl}" x2="${W - pr}" y1="${yb}" y2="${yb}" stroke="var(--muted)" stroke-opacity=".5" stroke-width="1"/>`;
  const nx = Math.max(3, Math.min(7, Math.floor((W - pl - pr) / 60)));
  for (const t of o.xt || niceTicks(o.x0, o.x1, nx)) s += `<text x="${X(t)}" y="${yb + 15}" text-anchor="middle" font-size="${fz}" fill="var(--muted)" ${mono}>${o.xfmt ? o.xfmt(t) : t}</text>`;
  if (o.xTitle) s += `<text x="${(pl + W - pr) / 2}" y="${H - 4}" text-anchor="middle" font-size="${fz}" fill="var(--muted)">${esc(o.xTitle)}</text>`;
  if (o.yUnit) s += `<text x="4" y="14" font-size="${fz}" fill="var(--muted)">${esc(o.yUnit)}</text>`;
  for (const v of o.vlines || []) {
    s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${pt}" y2="${yb}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>`;
    if (v.label) s += `<text x="${X(v.x) - 4}" y="${pt + 11}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(v.label)}</text>`;
  }
  // series
  const path = (se) => { let d = ""; for (let i = 0; i < se.x.length; i++) { if (se.x[i] < o.x0 - 1e-9 || se.x[i] > o.x1 + 1e-9 || !isFinite(se.y[i])) continue; d += (d ? "L" : "M") + X(se.x[i]).toFixed(1) + " " + Y(se.y[i]).toFixed(1); } return d; };
  o.series.forEach((se, i) => {
    if (se.detail) { if (lcDetail) s += `<path d="${path(se)}" fill="none" stroke="var(--muted)" stroke-width="1.1" opacity=".75" stroke-linejoin="round"/>`; return; }
    const d = path(se); if (!d) return;
    if (se.fill) { const xsIn = se.x.filter((x) => x >= o.x0 && x <= o.x1); s += `<path d="${d}L${X(xsIn[xsIn.length - 1]).toFixed(1)} ${yb}L${X(xsIn[0]).toFixed(1)} ${yb}Z" fill="url(#${el.dataset.lc}g${i})"/>`; }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  for (const m of o.marks || []) s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="3.2" fill="var(--card)" stroke="${m.color || "var(--pink)"}" stroke-width="1.8"/>${m.label ? `<text x="${X(m.x)}" y="${Y(m.y) + 15}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--muted)">${m.label}</text>` : ""}`;
  for (const p of o.dots || []) s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="6" fill="${p.color || "var(--pink)"}" stroke="var(--card)" stroke-width="2" ${p.attrs || ""}/><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="16" fill="transparent" ${p.attrs || ""}/>`;
  s += `<g class="lcf"></g><rect class="lch" x="${pl}" y="${pt - 20}" width="${W - pl - pr}" height="${yb - pt + 20}" fill="transparent" ${o.dots ? 'pointer-events="none"' : ""}/></svg>`;
  el.innerHTML = s;
  const g = el.querySelector(".lcf");
  const focus = (x) => {
    if (!o.fmtPill || (o.focus == null && x == null)) { g.innerHTML = ""; return; }
    const def = x == null; x = Math.max(o.x0, Math.min(o.x1, x == null ? o.focus.x : x));
    const main = o.series.filter((se) => !se.detail), vals = main.map((se) => lcInterp(se.x, se.y, x));
    let h = `<line x1="${X(x)}" x2="${X(x)}" y1="${pt - 4}" y2="${yb}" stroke="var(--text)" stroke-opacity=".55" stroke-width="1" stroke-dasharray="4 3"/>`;
    main.forEach((se, i) => { if (isFinite(vals[i])) h += `<circle cx="${X(x)}" cy="${Y(vals[i])}" r="4.5" fill="var(--card)" stroke="${se.color}" stroke-width="2.2"/>`; });
    const txt = o.fmtPill(x, vals, def), tw = txt.replace(/<[^>]+>/g, "").length * 6.4 + 18, px = Math.max(2, Math.min(W - tw - 2, X(x) - tw / 2));
    h += `<rect x="${px}" y="${pt - 30}" width="${tw}" height="22" rx="11" fill="var(--card2)" stroke="var(--line)"/><text x="${px + tw / 2}" y="${pt - 15}" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--text)" ${mono}>${txt}</text>`;
    g.innerHTML = h;
  };
  focus(null);
  const hit = el.querySelector(".lch"), toX = (e) => { const r = el.getBoundingClientRect(); return o.x0 + ((e.clientX - r.left - pl) / (W - pl - pr)) * (o.x1 - o.x0); };
  if (!o.dots && o.fmtPill) {
    hit.addEventListener("pointerdown", (e) => { hit.setPointerCapture(e.pointerId); focus(toX(e)); });
    hit.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") focus(toX(e)); });
    hit.addEventListener("pointerleave", () => focus(null));
    hit.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") setTimeout(() => focus(null), 1200); });
  }
}
function lcDrawAll() { document.querySelectorAll(".lc[data-lc]").forEach(lcDraw); }
let lcRT; window.addEventListener("resize", () => { clearTimeout(lcRT); lcRT = setTimeout(lcDrawAll, 120); });
function lcLegend(items, detail) {
  return `<div class="lcleg">${items.map(([kind, color, text]) => `<span>${kind === "line" ? `<i class="ln" style="background:${color}"></i>` : kind === "dash" ? `<i class="ds"></i>` : `<i class="mk" style="border-color:${color}"></i>`}${text}</span>`).join("")}${detail ? `<button class="detail" data-act="lc-detail" aria-pressed="${lcDetail}">Detail</button>` : ""}</div>`;
}

// speed over distance for one run (app view)
function runChart(run) {
  const R = run.res, c = R.curve, sprint = run.mode === "sprint";
  const end = sprint ? run.target : R.takeoff.dist;
  let k = c.d.findIndex((x) => x > end + 0.05); if (k < 0) k = c.d.length;
  const k0 = Math.max(0, c.t.findIndex((t) => t >= 0));
  const xs = c.d.slice(k0, k), v = c.v.slice(k0, k), vr = c.vr.slice(k0, k);
  const ymax = Math.ceil(Math.max(R.top.speed, ...v) + 1.2);
  const bands = [], marks = [];
  if (sprint && R.fly10) bands.push({ a: R.fly10.from, b: R.fly10.to, label: "fastest 10 m" });
  if (!sprint && R.last5) bands.push({ a: R.takeoff.dist - 5, b: R.takeoff.dist, label: "last 5 m" });
  if (!sprint && R.steps.times.length) {
    const n = R.steps.times.length;
    R.steps.times.forEach((t, i) => { if ((n - 1 - i) % 2) return; const j = Math.max(0, c.t.findIndex((x) => x >= t)); if (j < k) marks.push({ x: c.d[j], y: c.v[j] }); });
  }
  return lcSlot({
    aria: "Speed along the run", h: 250, x0: 0, x1: Math.ceil(end), y0: 0, y1: ymax, xTitle: "Distance (m)", yUnit: "m/s", bands, marks,
    focus: { x: R.top.dist },
    fmtPill: (x, [val], def) => (def ? `Top ${f2(R.top.speed)} m/s at ${f1(R.top.dist)} m` : `${f2(val)} m/s at ${f1(x)} m`),
    series: [{ x: xs, y: vr, detail: true }, { x: xs, y: v, color: "var(--pink)", fill: true, w: 2.6 }],
  });
}

// ---------------- results block ----------------
function cardHTML(label, value, unit, sub, hero, extra) {
  return `<div class="res${hero ? " hero" : ""}"><div class="label">${label}</div><div class="v">${value}${unit ? `<span class="u">${unit}</span>` : ""}</div>${sub ? `<div class="s">${sub}</div>` : ""}${extra || ""}</div>`;
}
// ---------------- where each left landed (vault) ----------------
// every foot contact with its spot in feet: from the back of the box (runway) or from the start (pole runs)
function contactsOf(r) {
  const R = r.res; if (!R || r.mode !== "vault") return [];
  if (R.contacts) return R.contacts.map((c) => {   // count lefts the vault way (see recountLefts)
    const fromEnd = R.contacts.length - 1 - R.contacts.indexOf(c), lefts = Math.floor(R.contacts.length / 2);
    const first = fromEnd % 2 === 0 && lefts - fromEnd / 2 < 1, left = fromEnd % 2 === 0 && !first;
    return Object.assign({}, c, { left, first, out: left ? fromEnd / 2 : null, n: left ? lefts - fromEnd / 2 : null });
  });
  // runs saved before this was added: work it out from the step times and the curve
  const st = R.steps.times, n = st.length, cv = R.curve, box = R.box || null;
  return st.map((t, i) => { const fromEnd = n - 1 - i, left = fromEnd % 2 === 0, k = Math.max(0, cv.t.findIndex((x) => x >= t)), lead = fromEnd === 0 ? 0.5 : 0.4;
    const first = left && Math.floor(n / 2) - fromEnd / 2 < 1;
    return { t, left: left && !first, first, takeoff: fromEnd === 0, out: left && !first ? fromEnd / 2 : null, n: left && !first ? Math.floor(n / 2) - fromEnd / 2 : null,
      boxFt: box ? (box - (cv.d[k] + R.start.d + lead)) / FT : null, startFt: (cv.d[k] + lead) / FT, v: cv.v[k] }; });
}
const hasBox = (r) => r.mode === "vault";
const spotFt = (r, c) => (hasBox(r) ? c.boxFt : c.startFt);
const outLabel = (o) => (o === 0 ? "Takeoff" : `${o} out`);
// into the box: speed change over the last half second before the plant
function finishTag(R) {
  const f = R.finish; if (!f) return null;
  const c = f.change, word = c >= 0.1 ? "Speeding up" : c <= -0.1 ? "Slowing" : "Holding speed";
  return { c, cls: c >= 0.1 ? "up" : c <= -0.1 ? "down" : "flat", text: `${word} into the box`, value: `${c >= 0 ? "+" : "−"}${Math.abs(c).toFixed(2)}`, accel: f.accel };
}
// the sensor seen from above: case with the lens facing down the runway (toward the box on the right)
function sensorGlyph(x, y, s = 1, lensRight = true) {
  const w = 13 * s, h = 9 * s;
  return `<g aria-hidden="true"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${2 * s}" fill="var(--text)"/>`
    + `<rect x="${lensRight ? x + w / 2 - 1.2 * s : x - w / 2 - 0.8 * s}" y="${y - 2.6 * s}" width="${2 * s}" height="${5.2 * s}" rx="${0.8 * s}" fill="var(--blue)"/>`
    + `<circle cx="${x - (lensRight ? 2.2 : -2.2) * s}" cy="${y}" r="${1.1 * s}" fill="var(--card)" opacity=".55"/></g>`;
}
// runway map: one lane per jump, box on the right, the sensor at its tripod mark;
// lefts pink with their spot in feet, rights grey
function runwayMap(items, o = {}) {
  if (!items.length) return "";
  const run0 = items[0].run, box = hasBox(run0), setup = SETUPS[run0.setup] || {}, single = items.length === 1;
  const W = o.W || 360, pl = o.gutter || 8, pr = box ? 22 : 10;
  const laneH = single ? 64 : o.laneH || 38, top = single ? 4 : o.gutter ? 9 : 6, axisH = 26, H = top + items.length * laneH + axisH;
  let far = 20;
  for (const { run } of items) { for (const c of contactsOf(run)) far = Math.max(far, spotFt(run, c) || 0); if (box && run.res.startMarkFt) far = Math.max(far, run.res.startMarkFt); }
  const tripod = box && setup.boxFt ? setup.boxFt : null;
  if (tripod) far = Math.max(far, tripod);
  far = Math.ceil((far + 4) / 10) * 10;
  const X = (ft) => (box ? pl + ((far - ft) / far) * (W - pl - pr) : pl + (ft / far) * (W - pl - pr));
  const y1 = top + items.length * laneH, step = far > 110 ? 20 : 10;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;font-variant-numeric:tabular-nums" role="img" aria-label="Where each left landed">`;
  // feet scale
  s += `<line x1="${pl}" x2="${X(0)}" y1="${y1 + 4}" y2="${y1 + 4}" stroke="var(--line)"/>`;
  for (let f = 0; f <= far; f += 5) {
    const major = f % step === 0, x = X(f);
    s += `<line x1="${x}" x2="${x}" y1="${y1 + 4}" y2="${y1 + (major ? 9 : 6.5)}" stroke="var(--muted)" stroke-opacity="${major ? 0.7 : 0.35}"/>`;
    if (major && f > 0 && !(tripod && Math.abs(f - tripod) < step / 2)) s += `<text x="${x}" y="${y1 + 19}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${f}'</text>`;
  }
  // the box: a slim column at 0 ft
  if (box) s += `<rect x="${X(0) + 4}" y="${top + 4}" width="5" height="${y1 - top - 4}" rx="1.5" fill="var(--purple)" opacity=".55"/><text x="${X(0) + 6.5}" y="${y1 + 19}" text-anchor="middle" font-size="8" font-weight="700" letter-spacing=".06em" fill="var(--purple)">${setup.pole ? "MARK" : "BOX"}</text>`;
  // the sensor on its tripod mark, on the scale
  if (tripod) s += sensorGlyph(X(tripod), y1 + 15, 0.85);
  // mid mark: the average spot of the chosen left
  if (o.mid != null) {
    const xs = []; for (const { run } of items) for (const c of contactsOf(run)) if (c.left && c.out === o.mid) xs.push(spotFt(run, c));
    if (xs.length) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; s += `<line x1="${X(m)}" x2="${X(m)}" y1="${top}" y2="${y1 + 2}" stroke="var(--purple)" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>`; }
  }
  items.forEach(({ run, label }, li) => {
    const y0 = top + li * laneH, yl = y0 + (single ? 30 : o.gutter ? laneH / 2 - 2 : 23), cs = contactsOf(run), R = run.res, bh = single ? 12 : o.gutter ? 7 : 9;
    if (label) s += o.gutter ? `<text x="4" y="${yl + 3}" font-size="9" font-weight="600" fill="var(--text)">${esc(label)}</text>`
      : `<text x="${pl}" y="${y0 + 9}" font-size="9" font-weight="600" fill="var(--muted)">${esc(label)}</text>`;
    // the run-up: a thin track from the start mark (or first step) to the takeoff
    const xs = cs.map((c) => X(spotFt(run, c))), startX = box && R.startMarkFt != null ? X(R.startMarkFt) : box ? null : X(0);
    const a = startX != null ? startX : xs[0], b = xs.length ? xs[xs.length - 1] : a;
    if (a != null) s += `<rect x="${Math.min(a, b)}" y="${yl - bh / 2}" width="${Math.abs(b - a)}" height="${bh}" rx="${bh / 2}" fill="var(--line)" opacity=".55"/>`;
    if (tripod) s += `<line x1="${X(tripod)}" x2="${Math.min(a, b)}" y1="${yl}" y2="${yl}" stroke="var(--blue)" stroke-opacity=".35" stroke-dasharray="1.5 2.5"/>`;
    if (startX != null) s += `<line x1="${startX}" x2="${startX}" y1="${yl - bh / 2 - 3}" y2="${yl + bh / 2 + 3}" stroke="var(--blue)" stroke-width="1.6" stroke-linecap="round"/>`
      + (single ? `<text x="${startX - 5}" y="${yl + 2.8}" text-anchor="end" font-size="7.5" font-weight="700" letter-spacing=".06em" fill="var(--blue)" paint-order="stroke" stroke="var(--card)" stroke-width="3">START</text>` : "");
    // labels never overlap: a label is skipped (multi) or lifted (single) when it would touch the one before
    let lastLx = -1e9, lift = false;
    cs.forEach((c, i) => {
      const x = xs[i];
      if (!c.left) { s += `<circle cx="${x}" cy="${yl}" r="${single ? 1.9 : 1.5}" fill="var(--muted)" opacity=".7"/>`; return; }
      s += c.takeoff ? `<circle cx="${x}" cy="${yl}" r="${single ? 3.6 : 2.9}" fill="var(--card)" stroke="var(--pink)" stroke-width="1.6"/>`
        : `<circle cx="${x}" cy="${yl}" r="${single ? 3.1 : 2.5}" fill="var(--pink)"/>`;
      const ft = spotFt(run, c);
      if (single) {
        lift = Math.abs(x - lastLx) < 22 ? !lift : false; lastLx = x;
        s += `<text x="${x}" y="${yl - bh / 2 - 4 - (lift ? 10 : 0)}" text-anchor="middle" font-size="9" font-weight="600" fill="var(--text)">${Math.round(ft)}'</text>`;
        s += `<text x="${x}" y="${yl + bh / 2 + 11}" text-anchor="middle" font-size="7.5" font-weight="700" letter-spacing=".04em" fill="var(--pink)">${c.takeoff ? "TO" : "L" + c.n}</text>`;
      } else if (x - lastLx >= 17 || c.takeoff) { lastLx = x; s += `<text x="${x}" y="${o.gutter ? yl - 5 : yl + 12}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${Math.round(ft)}'</text>`; }
    });
  });
  return s + `</svg>`;
}
const MAPKEY = () => {
  const g = (inner, w = 14) => `<svg width="${w}" height="10" viewBox="0 0 ${w} 10" style="display:inline;vertical-align:-1px">${inner}</svg>`;
  return `<div class="mapkey">${g(sensorGlyph(7, 5, 0.75), 14)} sensor <span>${g(`<line x1="5" x2="5" y1="1" y2="9" stroke="var(--blue)" stroke-width="1.6" stroke-linecap="round"/>`, 10)} start mark</span><span>${g(`<circle cx="5" cy="5" r="3" fill="var(--pink)"/>`, 10)} lefts</span><span>${g(`<circle cx="5" cy="5" r="1.9" fill="var(--muted)" opacity=".7"/>`, 10)} rights</span><span>${g(`<circle cx="5" cy="5" r="3.3" fill="none" stroke="var(--pink)" stroke-width="1.5"/>`, 10)} takeoff</span></div>`;
};
// table: one row per jump, one column per left counted back from the takeoff
function leftsMatrix(list, o = {}) {
  const box = hasBox(list[0]);
  const maxOut = Math.max(0, ...list.map((r) => Math.max(0, ...contactsOf(r).filter((c) => c.left).map((c) => c.out))));
  const cols = []; for (let k = 0; k <= Math.min(maxOut, 9); k++) cols.push(k);
  const cell = (r, k) => { const c = contactsOf(r).find((x) => x.left && x.out === k); return c ? spotFt(r, c) : null; };
  let h = `<div class="tw"><table class="lm"><thead><tr><th>${o.rowHead || "Jump"}</th>${box ? "<th>Start</th>" : ""}${cols.map((k) => `<th class="${k === o.mid ? "mid" : ""}">${k === 0 ? "TO" : k + " out"}</th>`).join("")}<th>Lefts</th></tr></thead><tbody>`;
  for (const r of list) h += `<tr data-act="open-run" data-id="${r.id}" style="cursor:pointer"><td>${esc(o.rowLabel ? o.rowLabel(r) : timeLabel(r.ts))}</td>${box ? `<td>${r.res.startMarkFt != null ? ftLabel(r.res.startMarkFt) : "–"}</td>` : ""}${cols.map((k) => { const v = cell(r, k); return `<td class="${k === o.mid ? "mid" : ""}">${v != null ? ftLabel(v) : "–"}</td>`; }).join("")}<td>${r.res.steps.lefts || "–"}</td></tr>`;
  if (o.stats && list.length > 1) {
    const col = (k) => list.map((r) => cell(r, k)).filter((v) => v != null);
    const sm = box ? list.map((r) => r.res.startMarkFt).filter((v) => v != null) : [];
    h += `<tr class="avg"><td>Average</td>${box ? `<td>${sm.length ? ftLabel(avgOf(sm)) : "–"}</td>` : ""}${cols.map((k) => { const a = col(k); return `<td class="${k === o.mid ? "mid" : ""}">${a.length ? ftLabel(avgOf(a)) : "–"}</td>`; }).join("")}<td></td></tr>`;
    h += `<tr class="avg"><td>Spread ±</td>${box ? `<td>${sm.length > 1 ? spreadFt(sdOf(sm)).slice(1) : "–"}</td>` : ""}${cols.map((k) => { const a = col(k); return `<td class="${k === o.mid ? "mid" : ""}">${a.length > 1 ? spreadFt(sdOf(a)).slice(1) : "–"}</td>`; }).join("")}<td></td></tr>`;
  }
  return h + `</tbody></table></div>`;
}
// one jump: map + table of every left
function leftsCardHTML(run) {
  const cs = contactsOf(run); if (!cs.length) return "";
  const box = hasBox(run), lefts = cs.filter((c) => c.left);
  let rows = "";
  lefts.forEach((c, i) => {
    const prev = i ? lefts[i - 1] : null, stride = prev ? Math.abs(spotFt(run, prev) - spotFt(run, c)) : null;
    rows += `<tr><td><b style="color:var(--pink)">${c.takeoff ? "Takeoff" : "L" + c.n}</b></td><td>${c.takeoff ? "–" : outLabel(c.out)}</td><td><b>${ftLabel(spotFt(run, c))}</b></td><td>${stride != null ? ftLabel(stride) : "–"}</td><td>${f2(c.v)}</td></tr>`;
  });
  return `<div class="card"><div class="between"><div class="label">Where each left landed</div><div class="small muted">feet from the ${box ? "box" : "start"}</div></div>
    <div style="margin-top:8px">${runwayMap([{ run }])}</div>
    ${MAPKEY()}
    <div class="tw"><table class="lm"><thead><tr><th>Left</th><th>Out</th><th>From ${box ? "box" : "start"}</th><th>Stride</th><th>m/s</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="small muted" style="margin-top:6px">Stride = distance from the left before. Each spot is about ±1 ft on its own. Averages over several jumps in Analytics are steadier.</div></div>`;
}

function resultsHTML(run) {
  const R = run.res;
  let h = `<div class="grid2">`;
  if (run.mode === "sprint") {
    h += cardHTML(`${run.target} m time`, f2(R.time), "s", `avg ${f2(R.avgSpeed)} m/s · start at ${R.start.threshold.toFixed(1)} m/s`, true);
    h += cardHTML("Top speed", f2(R.top.speed), "m/s", `${f1(mph(R.top.speed))} mph · at ${f1(R.top.dist)} m`);
    h += R.fly10 ? cardHTML("Flying 10 m", f2(R.fly10.time), "s", `${f2(R.fly10.speed)} m/s · ${f1(R.fly10.from)}–${f1(R.fly10.to)} m`) : cardHTML("Average speed", f2(R.avgSpeed), "m/s");
    h += `</div><div class="card"><div class="label">Splits</div><div class="tw"><table><thead><tr><th>Segment</th><th>Time</th><th>Speed</th><th>From start</th></tr></thead><tbody>`;
    for (const s of R.splits) h += `<tr><td>${s.from}–${s.to} m</td><td>${f2(s.time)} s</td><td>${f2(s.speed)} m/s</td><td>${f2(s.at)} s</td></tr>`;
    h += `</tbody></table></div></div>`;
  } else {
    const c = changeTag(R);
    h += cardHTML("Last 5 m into takeoff", f2(R.last5 && R.last5.speed), "m/s", R.last5 ? `${R.last5.time.toFixed(3)} s · ${f1(mph(R.last5.speed))} mph` : "Run too short", true, c ? `<span class="tag ${c.cls}">${c.text}</span>` : "");
    const ft = finishTag(R);
    h += cardHTML("Into the box", ft ? ft.value : "—", ft ? "m/s" : "", ft ? `<span class="tag ${ft.cls}">${ft.text}</span> last ½ s before the plant` : "Run too short");
    h += cardHTML("Lefts", R.steps.counted ? R.steps.lefts : "—", "", R.steps.counted ? `${R.steps.counted} steps counted` : "Steps not clear enough");
    h += cardHTML("10 → 5 m out", f2(R.prev5 && R.prev5.speed), "m/s", R.prev5 ? `${R.prev5.time.toFixed(3)} s` : "");
    h += cardHTML("Top speed", f2(R.top.speed), "m/s", `${f1(mph(R.top.speed))} mph`);
    if (R.takeoff.outFt != null) h += cardHTML("Takeoff ≈", ftLabel(R.takeoff.outFt), "", "out from the box");
    if (R.startMarkFt != null) h += cardHTML("Start mark ≈", ftLabel(R.startMarkFt), "", "from the box");
    if (R.box10to5) h += cardHTML("33 → 16 ft out", f2(R.box10to5.speed), "m/s", "fixed window from the box");
    h += cardHTML("Approach", f2(R.approachTime), "s", `${f1(R.approachDist)} m to takeoff`);
    if (R.pod) h += R.pod.error ? cardHTML("Peak hip height ≈", "—", "", esc(R.pod.error)) : cardHTML("Peak hip height ≈", ftLabel(R.pod.peak / FT), "", `${R.pod.peak.toFixed(2)} m · waist pod${R.pod.sim ? " (simulated)" : R.pod.cal ? "" : " (not calibrated)"}${R.pod.note ? " · " + esc(R.pod.note) : ""}`);
    else if (!(SETUPS[run.setup] || {}).pole) h += cardHTML("Peak hip height ≈", "—", "", "Wear a waist pod to measure it");
    h += `</div>`;
  }
  if (run.mode === "vault") h += leftsCardHTML(run);
  h += `<div class="card"><div class="label">Speed · distance</div>${runChart(run)}
    ${lcLegend([["line", "var(--pink)", "Speed"], ["dash", "", "Top speed"], ...(run.mode === "vault" ? [["mark", "var(--pink)", "Left"]] : [])], true)}
    <div class="small muted" style="margin-top:6px">Drag across the chart to read the speed anywhere. Detail shows the raw readings behind the smoothed line.</div></div>`;
  return h;
}

// ---------------- compare ----------------
let compareSel = [];
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
const PRINT_COLORS = ["#e0147a", "#7444e8", "#0f8fd6", "#e08a00"];
function toggleCompare(id) {
  const i = compareSel.indexOf(id);
  if (i >= 0) compareSel.splice(i, 1); else if (compareSel.length >= 4) { toast("You can compare up to four runs."); return; } else compareSel.push(id);
  render();
}
function compareX(run) {
  // sprint: distance from the start. vault: distance before takeoff (0 = takeoff), so approaches line up
  return run.mode === "sprint" ? run.res.curve.d : run.res.curve.d.map((d) => d - run.res.takeoff.dist);
}
function interpAt(xs, ys, x) { if (x < xs[0] || x > xs[xs.length - 1]) return NaN; let j = 1; while (j < xs.length && xs[j] < x) j++; const f = (x - xs[j - 1]) / ((xs[j] - xs[j - 1]) || 1e-9); return ys[j - 1] + f * (ys[j] - ys[j - 1]); }
function compareText(list) {
  const out = [], names = list.map((r, i) => `${String.fromCharCode(65 + i)}`);
  const label = (i) => `${names[i]} (${esc(athleteById(list[i].athleteId).name.split(" ")[0])})`;
  const allSprint = list.every((r) => r.mode === "sprint"), allVault = list.every((r) => r.mode === "vault");
  if (allSprint) {
    const T = Math.min(...list.map((r) => r.target));
    const tAt = (r, x) => (x === r.target ? r.res.time : interpAt(r.res.curve.d, r.res.curve.t, x));
    const times = list.map((r) => tAt(r, T)), best = times.indexOf(Math.min(...times));
    out.push(`<b>${label(best)}</b> was fastest to ${T} m in <b>${f2(times[best])} s</b>.` + list.map((r, i) => (i === best ? "" : ` ${label(i)} was ${f2(times[i] - times[best])} s behind.`)).join(""));
    // where the gap appears
    for (let i = 0; i < list.length; i++) {
      if (i === best) continue;
      let at = null; for (let x = 5; x <= T; x += 5) if (tAt(list[i], x) - tAt(list[best], x) > 0.05) { at = x; break; }
      let worst = null, wd = 0; for (let x = 5; x <= T; x += 5) { const dd = (tAt(list[i], x) - tAt(list[i], x - 5)) - (tAt(list[best], x) - tAt(list[best], x - 5)); if (dd > wd) { wd = dd; worst = x; } }
      if (at != null) out.push(`${label(i)} fell more than 0.05 s behind by <b>${at} m</b>; the most time went in the <b>${worst - 5}–${worst} m</b> split (${f2(wd)} s).`);
    }
    const tops = list.map((r) => r.res.top.speed), tb = tops.indexOf(Math.max(...tops));
    out.push(`Highest top speed: <b>${label(tb)} ${f2(tops[tb])} m/s</b>` + (list.length > 1 ? `, ${f2(tops[tb] - Math.min(...tops))} m/s above the lowest.` : "."));
  } else if (allVault) {
    const l5 = list.map((r) => (r.res.last5 ? r.res.last5.speed : NaN)), b = l5.indexOf(Math.max(...l5.filter(isFinite)));
    if (b >= 0) out.push(`Fastest into takeoff: <b>${label(b)} ${f2(l5[b])} m/s</b> over the last 5 m.`);
    const lefts = list.map((r) => r.res.steps.lefts);
    if (new Set(lefts).size > 1) out.push(`Lefts differ: ${list.map((r, i) => `${names[i]} ${lefts[i] || "?"}`).join(", ")}.`);
    const tos = list.map((r) => r.res.takeoff.outFt).filter((x) => x != null);
    if (tos.length > 1) out.push(`Takeoff spots spread over <b>${ftLabel(Math.max(...tos) - Math.min(...tos))}</b> (${list.map((r, i) => `${names[i]} ${ftLabel(r.res.takeoff.outFt)}`).join(", ")}).`);
    list.forEach((r, i) => { const c = changeTag(r.res); if (c && c.cls === "down") out.push(`${label(i)}: ${c.text.toLowerCase()}.`); });
  } else out.push("These runs are different tests, so only the curves are shown side by side.");
  // where the curves split apart (common range, 2 m in a row more than 0.25 m/s apart)
  if (list.length >= 2 && (allSprint || allVault)) {
    const xsA = list.map(compareX), lo = Math.max(...xsA.map((x) => x[0])), hi = Math.min(...xsA.map((x) => x[x.length - 1]));
    let run = 0, where = null;
    for (let x = Math.ceil(lo); x <= hi; x += 0.5) {
      const vs = list.map((r, i) => interpAt(xsA[i], r.res.curve.v, x));
      if (Math.max(...vs) - Math.min(...vs) > 0.25) { run += 0.5; if (run >= 2 && where == null) where = x - 2; } else run = 0;
    }
    out.push(where == null ? "The speed curves stay within 0.25 m/s of each other the whole way." : `The speed curves split apart around <b>${allVault ? `${f1(Math.abs(where))} m before takeoff` : `${f1(where)} m`}</b>.`);
  }
  return out;
}
function compareHTML() {
  const list = compareSel.map((id) => runs.find((r) => r.id === id)).filter(Boolean);
  if (!list.length) return `<h1>Compare</h1><div class="card empty">Pick up to four runs in Sessions or Analytics (tap the circle next to a run), then come back here.</div>`;
  const allVault = list.every((r) => r.mode === "vault");
  const xs = list.map(compareX), x0 = Math.floor(Math.min(...xs.map((x) => x[0]))), x1 = Math.ceil(Math.max(...xs.map((x) => x[x.length - 1])));
  const ymax = Math.ceil(Math.max(...list.map((r) => r.res.top.speed)) + 0.8);
  const cut = list.map((r, i) => { const end = r.mode === "sprint" ? r.target : 0; let k = xs[i].findIndex((x) => x > end + 0.05); if (k < 0) k = xs[i].length; return { x: xs[i].slice(0, k), y: r.res.curve.v.slice(0, k) }; });
  const cx0 = allVault ? Math.max(x0, -30) : 0, cx1 = allVault ? 0 : Math.min(x1, Math.max(...list.map((r) => r.target || 0)) || x1);
  const chart = lcSlot({ aria: "Speed curves compared", h: 270, x0: cx0, x1: cx1, y0: 0, y1: ymax, xTitle: allVault ? "Distance before takeoff (m)" : "Distance (m)", yUnit: "m/s",
    xfmt: (t) => (allVault ? `${Math.abs(t)}` : `${t}`), vlines: allVault ? [{ x: -5, label: "5 m out" }] : [],
    fmtPill: (x, vals) => vals.map((v, i) => (isFinite(v) ? `${String.fromCharCode(65 + i)} ${f2(v)}` : "")).filter(Boolean).join("  ") + ` · ${f1(Math.abs(x))} m`,
    series: cut.map((c, i) => ({ x: c.x, y: c.y, color: COLORS[i], w: 2.4, fill: list.length === 1 })) });
  let h = `<div class="between"><h1>Compare</h1><button class="btn sm" data-act="cmp-clear">Clear</button></div>`;
  h += `<div class="card"><div class="chips" style="margin-bottom:8px">${list.map((r, i) => `<span class="chip" style="cursor:default"><span class="dot" style="background:${COLORS[i]}"></span>${String.fromCharCode(65 + i)} · ${esc(athleteById(r.athleteId).name)} · ${testShort(testKey(r))} · ${dayLabel(dayKey(r.ts))}</span>`).join("")}</div>
    ${chart}<div class="small muted" style="margin-top:6px">${allVault ? "Lined up at the takeoff, so different start marks still compare." : "Distance from the start."} Drag across the chart to read each run's speed.</div></div>`;
  h += `<div class="card"><div class="label">What's different</div><ul class="bullets">${compareText(list).map((t) => `<li>${t}</li>`).join("")}</ul></div>`;
  // table
  const rowsDef = list.every((r) => r.mode === "sprint")
    ? [["Time", (r) => `${f2(r.res.time)} s`], ["Top speed", (r) => `${f2(r.res.top.speed)}`], ["Flying 10 m", (r) => (r.res.fly10 ? `${f2(r.res.fly10.time)} s` : "—")],
       ...[5, 10, 15, 20, 25, 30, 40, 50, 60].filter((x) => list.some((r) => r.target >= x)).map((x) => [`0–${x} m`, (r) => (r.target >= x ? `${f2(x === r.target ? r.res.time : interpAt(r.res.curve.d, r.res.curve.t, x))}` : "—")])]
    : [["Last 5 m", (r) => f2(r.res.last5 && r.res.last5.speed)], ["10 → 5 m out", (r) => f2(r.res.prev5 && r.res.prev5.speed)], ["Top speed", (r) => f2(r.res.top.speed)], ["Lefts", (r) => r.res.steps.lefts || "—"],
       ["Takeoff ≈", (r) => (r.res.takeoff.outFt != null ? ftLabel(r.res.takeoff.outFt) : "—")], ["Approach time", (r) => `${f2(r.res.approachTime)} s`]];
  h += `<div class="card tw"><table><thead><tr><th></th>${list.map((r, i) => `<th style="color:${COLORS[i]}">${String.fromCharCode(65 + i)}</th>`).join("")}</tr></thead><tbody>`;
  for (const [k, fn] of rowsDef) h += `<tr><td>${k}</td>${list.map((r) => `<td>${fn(r)}</td>`).join("")}</tr>`;
  h += `</tbody></table></div>`;
  return h;
}

// ---------------- level & aim (the BMI160 tilt sensor in the case) ----------------
// The sensor reads its tilt 100 times a second. This page shows it as a level, works out where the beam is down
// the runway, zeroes it, and handles the bump alarm. While it's open the sensor's own screen shows the level too.
const lv = { j: null, sig: "", busy: false };
const LV_DIST = [["100 ft", 100 * FT], ["150 ft", 150 * FT], ["30 m", 30], ["60 m", 60]];
const lvImperial = () => settings.weightUnit === "lb";
const lvFmtH = (m) => (lvImperial() ? `${Math.round(m / 0.0254)} in` : `${Math.round(m * 100)} cm`);
const lvFmtD = (m) => (Math.abs(m / FT - Math.round(m / FT)) < 0.05 && Math.round(m / FT) % 50 === 0 ? `${Math.round(m / FT)} ft` : `${Math.round(m)} m`);
function lvAt() {
  if (settings.lvAt) return settings.lvAt;
  return settings.lastMode === "vault" ? (SETUPS[settings.lastSetup] || SETUPS.runway100).boxFt * FT : 30;
}
// heights are stored in metres; typed in inches or cm (the body-weight unit picks which)
const lvSensorH = () => settings.lvSensorH || 1.0, lvBackH = () => settings.lvBackH || 1.0;
const lvColour = (ap) => (ap < 0.1 ? "var(--good)" : ap < 0.4 ? "var(--warn)" : "var(--bad)");
async function lvFetch(body) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), body ? 2500 : 900);
  try {
    const url = `/level?watch=1&at=${lvAt().toFixed(2)}`;
    const r = await fetch(url, body ? { method: "POST", body: new URLSearchParams(body), cache: "no-store", signal: ctl.signal } : { cache: "no-store", signal: ctl.signal });
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(to); }
}
function lvLoop() {
  if (view !== "level") return;
  if (!lv.busy && sensor.connected && !cap.sim) {
    lvFetch().then((j) => {
      if (j) { lv.j = j; const sig = [j.ok, j.zeroed, j.half, j.front, j.ref, j.bump].join(); if (sig !== lv.sig) { lv.sig = sig; if (view === "level") render(); } else lvPaint(); }
    }).finally(() => setTimeout(lvLoop, 250));
  } else setTimeout(lvLoop, 500);
}
async function lvDo(what) {
  if (lv.busy) return; lv.busy = true;
  const j = await lvFetch({ do: what });
  lv.busy = false;
  if (!j) { toast("Couldn't reach the sensor."); return; }
  lv.j = j; lv.sig = ""; if (j.msg) toast(j.msg); render();
}
// side view: sensor on the left, the beam out to the chosen distance, the athletes' back height as a band
function lvSideSVG(pitch) {
  const D = lvAt(), h0 = lvSensorH(), back = lvBackH(), W = 320, H = 120, top = 2.0;
  const x = (d) => 14 + (d / D) * (W - 28), y = (h) => H - 12 - (h / top) * (H - 24);
  const hEnd = h0 + D * Math.tan((pitch || 0) * Math.PI / 180);
  const band = 0.1;   // ±10 cm counts as on the back
  return `<svg viewBox="0 0 ${W} ${H}" class="lv-side" role="img" aria-label="Beam from the sensor to ${lvFmtD(D)}">
    <rect x="${x(0)}" y="${y(back + band)}" width="${x(D) - x(0)}" height="${y(back - band) - y(back + band)}" rx="4" fill="var(--good)" opacity=".16"/>
    <line x1="${x(0)}" x2="${x(D)}" y1="${y(back)}" y2="${y(back)}" stroke="var(--good)" stroke-dasharray="4 4" stroke-width="1.5" opacity=".7"/>
    <line x1="4" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-width="2"/>
    <line x1="${x(0)}" x2="${x(0)}" y1="${y(0)}" y2="${y(h0)}" stroke="var(--muted)" stroke-width="2"/>
    <line id="lvBeam" x1="${x(0)}" y1="${y(h0)}" x2="${x(D)}" y2="${y(Math.max(0, Math.min(top, hEnd)))}" stroke="var(--pink)" stroke-width="3" stroke-linecap="round"/>
    <rect x="${x(0) - 9}" y="${y(h0) - 6}" width="18" height="12" rx="3" fill="var(--purple)"/>
    <text x="${x(D)}" y="${H - 1}" text-anchor="end" font-size="11" fill="var(--muted)">${lvFmtD(D)}</text>
    <text x="${x(0) + 14}" y="${y(back + band) - 4}" font-size="11" fill="var(--good)">back height</text></svg>`;
}
function lvBeamLine(pitch) {
  const D = lvAt(), hEnd = lvSensorH() + D * Math.tan((pitch || 0) * Math.PI / 180), off = hEnd - lvBackH();
  const ok = Math.abs(off) <= 0.1;
  return { hEnd, ok, text: `At ${lvFmtD(D)} the beam is <b>${lvFmtH(hEnd)}</b> off the ground: ${ok ? `<b style="color:var(--good)">on the back ✓</b>` : `<b style="color:var(--warn)">${lvFmtH(Math.abs(off))} ${off > 0 ? "above" : "below"} back height</b>`}` };
}
// update the moving parts without redrawing the page (so inputs keep focus)
function lvPaint() {
  const j = lv.j; if (!j || view !== "level") return;
  const ap = Math.abs(j.pitch), col = lvColour(ap), R = 70, k = 30;
  let bx = j.roll * k, by = -j.pitch * k; const L = Math.hypot(bx, by), lim = R - 14; if (L > lim) { bx *= lim / L; by *= lim / L; }
  const b = $("#lvDot"); if (b) { b.setAttribute("cx", 80 + bx); b.setAttribute("cy", 80 + by); b.setAttribute("fill", col); }
  const n = $("#lvNum"); if (n) { n.textContent = (ap < 0.005 ? "0.00" : (j.pitch > 0 ? "+" : "−") + ap.toFixed(2)) + "°"; n.style.color = col; }
  const w = $("#lvWord"); if (w) { w.textContent = ap < 0.1 ? "Level" : j.pitch > 0 ? "Nose up" : "Nose down"; w.style.color = col; }
  const r = $("#lvRoll"); if (r) r.textContent = `Side lean ${Math.abs(j.roll).toFixed(1)}°${Math.abs(j.roll) < 1 ? " (fine)" : ""}`;
  const st = $("#lvStill"); if (st) st.textContent = j.still ? "Still" : "Moving…";
  const D = lvAt(), h0 = lvSensorH(), top = 2.0, H = 120, y = (h) => H - 12 - (h / top) * (H - 24);
  const be = $("#lvBeam"); if (be) be.setAttribute("y2", y(Math.max(0, Math.min(top, h0 + D * Math.tan(j.pitch * Math.PI / 180)))));
  const bl = $("#lvBeamTxt"); if (bl) bl.innerHTML = lvBeamLine(j.pitch).text;
}
function levelHTML() {
  let h = `<button class="btn sm" data-act="back">‹ Back</button><h1 style="margin-top:10px">Level &amp; aim</h1>`;
  if (cap.sim || !sensor.connected) return h + `<div class="card empty">Join the SpeedLidar Wi-Fi to use the level. It reads the tilt sensor inside the case.</div>`;
  const j = lv.j;
  if (!j) return h + `<div class="card empty">Reading the tilt sensor…</div>`;
  if (!j.ok) return h + `<div class="card"><b style="color:var(--warn)">No tilt sensor found.</b><div class="small muted" style="margin-top:6px">Check the BMI160's four wires: 3V3 → 3V3, GND → GND, SDA → GPIO 4, SCL → GPIO 5. Its CS pin goes to 3V3 and SAO to GND. The sensor looks for it every 5 seconds.</div></div>`;
  const unit = lvImperial() ? "in" : "cm", toU = (m) => (lvImperial() ? Math.round(m / 0.0254) : Math.round(m * 100));
  const at = lvAt();
  // the level itself
  h += `<div class="card lv-card">
    <svg viewBox="0 0 160 160" class="lv-bubble" aria-hidden="true"><circle cx="80" cy="80" r="70" fill="none" stroke="var(--line)" stroke-width="3"/><circle cx="80" cy="80" r="9" fill="none" stroke="var(--line)" stroke-width="2"/>
      <path d="M18 80H142M80 18V142" stroke="var(--line)" stroke-width="1.5"/><circle id="lvDot" cx="80" cy="80" r="11" fill="var(--good)"/></svg>
    <div class="lv-read"><div class="label">Nose</div><div id="lvNum" class="lv-num">—</div><div id="lvWord" class="lv-word">—</div>
      <div class="small muted"><span id="lvRoll"></span> · <span id="lvStill"></span></div></div></div>
    <div class="small muted" style="margin:-4px 0 12px">Tilt the tripod head until the dot is in the middle and it turns green. The screen on the back of the sensor shows the same level while this page is open.${j.zeroed ? "" : ` <b style="color:var(--warn)">Zero it first (below), or it's only as level as the chip sits.</b>`}</div>`;
  // beam height down the runway
  h += `<div class="card"><div class="label">Where the beam goes</div>${lvSideSVG(j.pitch)}
    <div id="lvBeamTxt" class="small" style="margin:6px 0 10px">${lvBeamLine(j.pitch).text}</div>
    <div class="seg" style="margin-bottom:10px">${LV_DIST.map(([t, d]) => `<button data-act="lv-at" data-v="${d}" aria-pressed="${Math.abs(d - at) < 0.05}">${t}</button>`).join("")}</div>
    <div class="grid2"><div class="field" style="margin:0"><label for="lvSensorH">Sensor height (${unit})</label><input type="number" inputmode="decimal" id="lvSensorH" data-unit="${unit}" data-min="${lvImperial() ? 10 : 25}" data-max="${lvImperial() ? 80 : 200}" data-def="${lvImperial() ? 40 : 100}" value="${toU(lvSensorH())}"></div>
      <div class="field" style="margin:0"><label for="lvBackH">Back height (${unit})</label><input type="number" inputmode="decimal" id="lvBackH" data-unit="${unit}" data-min="${lvImperial() ? 10 : 25}" data-max="${lvImperial() ? 80 : 200}" data-def="${lvImperial() ? 40 : 100}" value="${toU(lvBackH())}"></div></div>
    <div class="small muted" style="margin-top:8px">Sensor height: the ground to the middle of the front window. Back height: where you want the beam to hit, about the middle of the lower back. Set the tripod to that height and level it, and the beam stays on the back the whole way down.</div></div>`;
  // bump alarm
  const bumpTxt = j.bumpWhy === "turned" ? `turned ${j.bumpDeg.toFixed(1)}° left or right` : j.bumpWhy === "leaned" ? `leaned ${j.bumpDeg.toFixed(1)}° to the side` : `nose ${j.bumpDeg > 0 ? "up" : "down"} ${Math.abs(j.bumpDeg).toFixed(1)}°`;
  h += `<div class="card${j.bump ? " lv-warn" : ""}"><div class="label">Bump alarm</div>
    <div style="margin:4px 0 10px">${j.bump ? `<b>The tripod moved:</b> ${bumpTxt} since it was aimed. Re-aim it (the Aiming screen saves the new aim when it locks on), or save where it points now.`
      : j.ref ? "Watching: if the tripod gets knocked, the sensor's screen and this app say so." : "Starts watching once it's aimed: when the Aiming screen locks on, or when the first run is set up."}</div>
    <button class="btn${j.bump ? " primary" : ""}" data-act="lv-do" data-v="lock">${j.ref ? "Save this aim" : "Save this aim now"}</button></div>`;
  // zero and front: once
  h += `<h2>Set up once</h2><div class="card"><div class="between"><div class="label">1 · Zero it</div>${j.zeroed ? `<span class="pill ok">Zeroed ✓</span>` : `<span class="pill">Not yet</span>`}</div>
    <div class="small muted" style="margin:6px 0 10px">Teaches it what level is. Use any flat table or the floor: it doesn't have to be level, because the two readings, turned around, cancel out the slope. Stand it on its tripod block.</div>
    ${j.half ? `<div style="margin-bottom:10px"><b>Now turn it around 180° on the same spot</b> (lens pointing the other way), let go, and tap Second reading.</div>
      <div class="row"><button class="btn primary" data-act="lv-do" data-v="zero2">Second reading</button><button class="btn" data-act="lv-do" data-v="cancel">Cancel</button></div>`
    : `<div class="row"><button class="btn${j.zeroed ? "" : " primary"}" data-act="lv-do" data-v="zero1">First reading</button><button class="btn ghost" data-act="lv-do" data-v="zero">It's level: zero here</button></div>`}</div>
    <div class="card"><div class="between"><div class="label">2 · Learn the front</div>${j.front ? `<span class="pill ok">Learned ✓</span>` : `<span class="pill">Not yet</span>`}</div>
    <div class="small muted" style="margin:6px 0 10px">So it knows nose up from side lean. On the tripod, level it, then tip the lens end <b>down</b> about 5° and hold it there while you tap.</div>
    <button class="btn${j.zeroed && !j.front ? " primary" : ""}" data-act="lv-do" data-v="front">Learn the front</button></div>`;
  return h;
}
function lvBind() {
  for (const [id, key] of [["#lvSensorH", "lvSensorH"], ["#lvBackH", "lvBackH"]]) {
    const el = $(id); if (!el) continue;
    el.oninput = () => { const v = parseFloat(el.value); if (v > 0) { settings[key] = lvImperial() ? v * 0.0254 : v / 100; saveSettings(); const svg = $(".lv-side"); if (svg && lv.j) svg.outerHTML = lvSideSVG(lv.j.pitch); lvPaint(); } };
  }
  lvPaint();
}
// the bar under the header when the tripod got knocked
function bumpBar() {
  const b = $("#bumpbar"); if (!b) return;
  const on = sensor.connected && sensor.bump && view !== "level" && !disp.on;
  b.hidden = !on;
  if (on) b.innerHTML = `<b>Tripod moved</b><span>${sensor.bumpWhy === "turned" ? `turned ${sensor.bumpDeg.toFixed(1)}°` : sensor.bumpWhy === "leaned" ? `leaned ${sensor.bumpDeg.toFixed(1)}°` : `nose ${sensor.bumpDeg > 0 ? "up" : "down"} ${Math.abs(sensor.bumpDeg).toFixed(1)}°`} since it was aimed · Check aim ›</span>`;
}

// ---------------- the waist pod (vertical: jump height, vault peak) ----------------
// The pod sends each jump to the sensor; this copy of the app reads it (/pod/data) and works the height out with
// PodEngine (pod.js). On the Jump test page a recording is a jump; otherwise, a recording that comes in shortly
// after a vault run gives that run its peak hip height.
let jumps = DB.get("jumps", []);
const saveJumps = () => DB.set("jumps", jumps);
const pod = { seq: null, msgSeq: null, busy: false, last: null, lastRes: null, calMsg: "", fwMsg: "", athleteId: null };
const POD_FW_URL = "https://github.com/paytonpittspv/LiDAR-Sensor-App/releases/download/firmware/Pod.bin";
const podIn = () => false;   // jump heights in centimetres (inches shown underneath)
const fmtJump = (m) => (podIn() ? `${(m / 0.0254).toFixed(1)}` : `${(m * 100).toFixed(1)}`), jumpUnit = () => (podIn() ? "in" : "cm");
const fmtJumpAlt = (m) => (podIn() ? `${(m * 100).toFixed(1)} cm` : `${(m / 0.0254).toFixed(1)} in`);
const podRest = () => settings.podRest || 1.0;   // the pod's height off the ground lying on the mat (m)
function parsePod(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 32 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "POD1") return null;
  const hz = dv.getUint16(6, true), n = dv.getUint32(8, true), seq = dv.getUint32(12, true), flags = dv.getUint32(16, true);
  const aL = dv.getFloat32(20, true), gL = dv.getFloat32(24, true);
  const r = { hz, seq, avg: !!(flags & 2), calibrated: !!(flags & 1), ax: [], ay: [], az: [], gx: [], gy: [], gz: [] };
  const m = Math.min(n, Math.floor((buf.byteLength - 32) / 12));
  for (let i = 0; i < m; i++) {
    const o = 32 + i * 12;
    r.ax.push(dv.getInt16(o, true) * aL); r.ay.push(dv.getInt16(o + 2, true) * aL); r.az.push(dv.getInt16(o + 4, true) * aL);
    r.gx.push(dv.getInt16(o + 6, true) * gL); r.gy.push(dv.getInt16(o + 8, true) * gL); r.gz.push(dv.getInt16(o + 10, true) * gL);
  }
  return r;
}
// several pods at once: each has an id (from the sensor), a colour you pick, and optionally who wears it
const podSt = {};
const pst = (id) => podSt[id] || (podSt[id] = { seq: null, msgSeq: null, lastPh: null, busy: false });
const POD_COLORS = { blue: ["Blue", "var(--blue)"], purple: ["Purple", "var(--purple)"], pink: ["Pink", "var(--pink)"], green: ["Green", "#16a34a"] };
function podColor(id) {
  const c = settings.podColors || (settings.podColors = {});
  if (!c[id] || !POD_COLORS[c[id]]) { const used = Object.values(c); c[id] = Object.keys(POD_COLORS).find((k) => !used.includes(k)) || "blue"; saveSettings(); }
  return c[id];
}
const podName = (id) => `${POD_COLORS[podColor(id)][0]} pod`, podCss = (id) => POD_COLORS[podColor(id)][1];
const podDot = (id) => `<span class="pdot" style="background:${podCss(id)}"></span>`;
const podsAll = () => (sensor.connected ? sensor.pods || [] : []), podsOn = () => podsAll().filter((p) => p.on);
// who's wearing this pod (an athlete id), or null: whoever is up in the lineup
const podWho = (id) => { const w = (settings.podWho || {})[id]; return w && athletes.some((a) => a.id === w) ? w : null; };
const podWearer = (id) => (id && podWho(id)) || cap.athleteId;
function podWatch() {
  if (cap.sim) return;
  let redraw = false;
  for (const P of sensor.pods || []) {
    const st = pst(P.id);
    if (P.on && !settings.podSeen) { settings.podSeen = true; saveSettings(); }
    if (st.msgSeq !== null && P.msgSeq !== st.msgSeq && P.msg) podMessage(P.msg, P.id);
    st.msgSeq = P.msgSeq;
    if (view === "jump" && pod.simPh == null) {
      const ph = P.on ? P.ph || 0 : -1, shownPod = pod.show && (jumps.find((j) => j.id === pod.show) || {}).pod;
      // the result stays until someone is set to jump again: on the same pod, only once it has moved first (handed over, or walked back)
      if (pod.show && P.id === shownPod && ph === 0) pod.sawMove = true;
      if (ph !== st.lastPh) {
        if (pod.show && ph === 1 && (P.id !== shownPod || pod.sawMove) && Date.now() - pod.showAt > 3000) pod.show = null;
        if (ph >= 1 && ph <= 3) pod.focus = P.id;
        // takeoff: the pod sends its takeoff speed about 80 ms into the flight (plus Wi-Fi); the bar flies from there
        if (ph === 2) pod.air = P.v ? { v: P.v / 100, t0: performance.now() - 120, who: podWearer(P.id) } : null;
        st.lastPh = ph; redraw = true;
      }
    }
    if (st.seq === null) { st.seq = P.seq; continue; }       // what was there before the app opened isn't new
    if (P.seq !== st.seq && !st.busy) { st.seq = P.seq; podFetch(P.id); }
  }
  if (redraw) { if (!luDrag.dragging) render(); if (pod.air) airTick(); }
  if (view === "jump") jumpScreen();
}
// The sensor's own screen shows the Jump test while it's open here: who's up, the live phases (the sensor reads
// those from the pods itself) and the result while it's up on this page. Sent about once a second.
function jumpScreen(off) {
  if (!sensor.connected || cap.sim || disp.on) return;
  if (!off && Date.now() - (jumpScreen.at || 0) < 900) return;
  jumpScreen.at = Date.now();
  const b = { who: "", pod: "", best: "", next: "" };
  if (off) b.off = 1;
  else {
    const on = podsOn(), P = on.find((p) => p.id === pod.focus) || on[0], wid = podWearer(P && P.id), a = athletes.find((x) => x.id === wid);
    b.who = a ? a.name.slice(0, 23) : ""; b.pod = P && on.length > 1 ? podName(P.id) : on.length ? "Waist pod" : "No pod";
    const best = jumps.filter((j) => j.athleteId === wid && dayKey(j.ts) === dayKey(Date.now())).reduce((m, j) => Math.max(m, j.h), 0);
    if (best) b.best = (best * 100).toFixed(1);
    const nx = athletes.find((x) => x.id === cap.athleteId); b.next = nx ? nx.name.slice(0, 23) : "";
    const s = pod.show && jumps.find((j) => j.id === pod.show);
    if (s) Object.assign(b, { res: 1, h: (s.h * 100).toFixed(1), hs: s.hStand != null ? (s.hStand * 100).toFixed(1) : "", hm: (s.hFlight * 100).toFixed(1), rw: athleteById(s.athleteId).name.slice(0, 23) });
  }
  fetch("/jump", { method: "POST", body: new URLSearchParams(b), cache: "no-store" }).catch(() => {});
}
function podMessage(m, id) {
  const [what, res] = m.split(":"), who = (sensor.pods || []).length > 1 ? `${podName(id)}: ` : "";
  if (what.startsWith("cal")) {
    pod.calMsg = res === "ok" ? "Got that side." : res === "done" ? "Calibrated. All six sides measured." : res === "moved" ? "It moved: hold it still on that side and try again." : res === "sides" ? "Some sides were missing or the same twice: start again with all six." : "";
    toast(who + pod.calMsg); if (view === "settings" || view === "podcal") render();
  } else if (what === "update") { pod.fwMsg = who + (res === "ok" ? "updated and restarted." : "couldn't update. Try again."); toast(pod.fwMsg); render(); }
  else if (what === "uncal") { pod.calMsg = "Calibration cleared."; render(); }
}
async function podFetch(id) {
  const st = pst(id); st.busy = true; pod.focus = id; if (view === "jump") render();
  try {
    const rec = parsePod(await (await fetch(`/pod/data?id=${encodeURIComponent(id)}`, { cache: "no-store" })).arrayBuffer());
    if (!rec) return;
    pod.last = rec;
    if (view === "jump") podJump(rec, false, id); else podVault(rec);
  } catch (e) {} finally { st.busy = false; }
}
function podJump(rec, sim, podId) {
  const R = PodEngine.analyzeJump(rec);
  pod.lastRes = R;
  if (!R.ok) { toast(R.why); render(); return; }
  jumpInit();
  const worn = podId && podWho(podId), a = worn || cap.athleteId || settings.lastAthlete || (athletes[0] && athletes[0].id);
  const j = { id: uid(), ts: Date.now(), athleteId: a, h: R.height, hStand: R.heightStanding, hFlight: R.heightFlight, t: R.flightTime, agree: R.agree, cal: rec.calibrated, sim: !!sim, pod: podId || null };
  jumps.unshift(j); saveJumps();
  // the result stays up (see jumpHTML); whoever is next is lined up behind it (a pod someone wears keeps them)
  pod.show = j.id; pod.showAt = Date.now(); pod.sawMove = false; pod.air = null;
  if (!worn) {
    pod.turn = (pod.turn || 0) + 1;
    if (pod.turn >= (settings.jumpEach || 1)) { pod.turn = 0; if (cap.queue.length > 1 && cap.queue.includes(a)) cap.athleteId = cap.queue[(cap.queue.indexOf(a) + 1) % cap.queue.length]; }
  }
  settings.lastAthlete = cap.athleteId; saveSettings();
  say(`${(podsOn().length > 1 ? firstName(a) + ", " : "")}${(R.height * 100).toFixed(0)} centimeters`);
  render();
  jumpScreen.at = 0; jumpScreen();
}
// a simulated vault run (no pod): what a waist pod would have given, through the same math
function simPodPeak(run) {
  if ((SETUPS[run.setup] || {}).pole || !run.res) return;
  const sp = (run.res.last5 && run.res.last5.speed) || 8.3, S = PodSim.simVault(sp), R = PodEngine.analyzeVault(S.rec, S.rest);
  run.res.pod = R.ok ? { peak: R.peak, impact: R.impactSpeed, flight: R.flightTime, note: R.note, cal: true, sim: true } : { error: R.why };
}
function podVault(rec) {
  // the latest vault run on the runway (not a pole run: that has no pit landing), finished within the last 90 s
  const cand = [cap.run, ...runs].filter(Boolean).find((r) => r.mode === "vault" && !(SETUPS[r.setup] || {}).pole && Date.now() - r.ts < 90000 && !(r.res && r.res.pod));
  if (!cand) return;
  const R = PodEngine.analyzeVault(rec, podRest());
  cand.res.pod = R.ok ? { peak: R.peak, impact: R.impactSpeed, flight: R.flightTime, note: R.note, cal: rec.calibrated } : { error: R.why };
  if (runs.includes(cand)) saveRuns();
  toast(R.ok ? `Peak hip height ${ftLabel(R.peak / FT)} (${R.peak.toFixed(2)} m)` : `Waist pod: ${R.why}`);
  render();
}
function podCmd(body) {
  return fetch("/pod/cmd", { method: "POST", body: new URLSearchParams(Object.fromEntries(Object.entries(body).filter(([, v]) => v != null && v !== ""))), cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.online) toast("That pod isn't connected: switch it on near the sensor."); return j; }).catch(() => toast("Couldn't reach the sensor."));
}
function podFirmware(file) {
  if (!file) return;
  if (!/\.bin$/i.test(file.name) || file.size < 100000) { toast("Pick the Pod.bin file."); return; }
  pod.fwMsg = "Sending to the sensor…"; render();
  fetch("/pod/fw", { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" }, cache: "no-store" }).then((r) => r.json())
    .then((j) => { pod.fwMsg = j.ok ? `Handed to the sensor. ${j.pods > 1 ? `All ${j.pods} pods pick` : "The pod picks"} it up within a few seconds, updates and restarts (about 20 s).` : `Couldn't send it${j.error ? `: ${j.error}` : ""}.`; render(); })
    .catch(() => { pod.fwMsg = "Couldn't reach the sensor."; render(); });
}
function podStatusLine(P) {
  if (!sensor.connected) return "Connect to the sensor to see the pods.";
  if (!P || !P.on) return "Not connected. Switch it on near the sensor (shake it to wake it).";
  if (!P.imu) return "Connected, but its motion sensor isn't answering: check the BMI160's wires.";
  return `Connected · ${P.cal ? "calibrated" : "<b style=\"color:var(--warn)\">not calibrated</b>"} · signal ${P.rssi} dBm · ${esc(P.fw)}`;
}
// Settings card
function podCardHTML() {
  const unit = lvImperial() ? "in" : "cm", v = lvImperial() ? Math.round(podRest() / 0.0254) : Math.round(podRest() * 100);
  // three separate things: the jump test (its own page), the vault's mat height (a setting), the pods themselves
  const jumpRow = `<div class="card between"><div><b>Vertical jump test</b><div class="small muted">${WEB_COPY || !podsOn().length ? "Try it with simulated jumps" : "Jump height with the waist pods"}</div></div><button class="btn" data-act="go-jump">Open</button></div>`;
  const rest = `<div class="card"><div class="label">Vault landing</div><div class="field" style="margin:8px 0 0"><label for="podRest">Pod height lying on the mat (${unit})</label><input type="number" inputmode="decimal" id="podRest" data-unit="${unit}" data-min="${lvImperial() ? 10 : 25}" data-max="${lvImperial() ? 70 : 180}" data-def="${lvImperial() ? 39 : 100}" value="${v}"></div>
    <div class="small muted" style="margin-top:8px">For the vault's peak hip height only. Lie on the landing mat the way you land, pod on, and measure from the ground to the pod, once.</div></div>`;
  // this copy of the app can't reach the pods (they talk to the sensor)
  if (WEB_COPY) return jumpRow + rest + `<div class="card"><div class="small muted">The pods' status, calibration and updates are on the sensor's page (join the SpeedLidar Wi-Fi).</div></div>`;
  const list = podsAll();
  let h = jumpRow;
  h += list.length ? list.map((P) => `<div class="card"><div class="between"><div class="label" style="display:flex;align-items:center;gap:8px">${podDot(P.id)}${podName(P.id)}</div>
      <div class="pcolors">${Object.entries(POD_COLORS).map(([k, [nm, css]]) => `<button data-act="pod-color" data-id="${P.id}" data-v="${k}" aria-label="${nm}" aria-pressed="${podColor(P.id) === k}" style="background:${css}"></button>`).join("")}</div></div>
      <div class="small" style="margin:6px 0 10px">${podStatusLine(P)}</div>
      <div class="row"><button class="btn" data-act="go-podcal" data-id="${P.id}">Calibrate</button><button class="btn ghost" data-act="pod-send" data-id="${P.id}">Send a test recording</button></div></div>`).join("")
    : `<div class="card"><div class="small muted">${sensor.connected ? "No pod connected. Switch one on near the sensor (shake it to wake it)." : "Connect to the sensor to see the pods."}</div></div>`;
  h += rest;
  h += `<div class="card"><div class="label">Pod firmware</div><div class="small muted" style="margin:6px 0 10px">With internet, <a href="${POD_FW_URL}">download Pod.bin</a>; then on the SpeedLidar Wi-Fi, pick it here. The sensor hands it to every pod.</div>
    <label class="btn" style="cursor:pointer">Update the pods<input type="file" id="podFwFile" accept=".bin,application/octet-stream" class="hidden"></label>
    ${pod.fwMsg ? `<div class="small" style="margin-top:8px">${esc(pod.fwMsg)}</div>` : ""}</div>`;
  return h;
}
// 6-side calibration: once, with the pod on a table
const POD_SIDES = ["Dome up, flat on its base", "Dome down (prop it so it can't rock)", "On one long side", "On the other long side", "Standing on the USB-C end", "Standing on the battery end"];
function podCalHTML(id) {
  const P = podsAll().find((p) => p.id === id) || podsOn()[0] || podsAll()[0], pid = P ? P.id : "", done = (P && P.sides) || 0, next = POD_SIDES.findIndex((_, i) => !(done & (1 << i)));
  let h = `<button class="btn sm" data-act="back">‹ Back</button><h1 style="margin-top:10px;display:flex;align-items:center;gap:10px">${P ? `${podDot(pid)}Calibrate the ${podName(pid).toLowerCase()}` : "Calibrate the pod"}</h1>
    <div class="card"><div class="small" style="margin-bottom:8px">${podStatusLine(P)}</div>
    <div class="small muted">Once, on a table. It measures the motion sensor's own small errors on each axis, which is what makes the vault height accurate (without it, a vault can be off by 10 cm or more). Set the pod on each of its six sides in turn, let go so it's still, and tap Measure. Any order works; propping it with something is fine.</div></div>
    <div class="card list">${POD_SIDES.map((t, i) => `<div class="item"><div><b>${i + 1}. ${t}</b></div><div class="r">${done & (1 << i) ? `<span class="pill ok">✓</span>` : `<button class="btn sm${i === next ? " primary" : ""}" data-act="pod-cal" data-id="${pid}" data-v="${i}">Measure</button>`}</div></div>`).join("")}</div>
    ${pod.calMsg ? `<div class="card"><b>${esc(pod.calMsg)}</b></div>` : ""}
    <button class="btn ghost" data-act="pod-uncal" data-id="${pid}">Clear the calibration</button>`;
  return h;
}
// Jump test page: laid out like the sprint/vault run screen (stage + lineup)
function jumpInit() {
  if (!cap.queue.length) cap.queue = (settings.lastQueue || []).filter((id) => athletes.some((a) => a.id === id));
  if (!cap.queue.length && athletes.length) cap.queue = athletes.map((a) => a.id);
  if (!cap.athleteId || !athletes.some((a) => a.id === cap.athleteId)) cap.athleteId = cap.queue[0] || (athletes[0] && athletes[0].id) || null;
}
function jumpHTML() {
  jumpInit();
  const on = podsOn(), P = on.find((p) => p.id === pod.focus) || on[0], podOn = !!(P && P.imu);
  const ph = pod.simPh != null ? pod.simPh : P && pst(P.id).busy ? 4 : podOn ? P.ph || 0 : -1;
  const wid = pod.simPh != null ? cap.athleteId : podWearer(P && P.id), a = wid && athletes.find((x) => x.id === wid), name = esc(a ? a.name : "");
  const today = jumps.filter((j) => dayKey(j.ts) === dayKey(Date.now()));
  const shown = pod.show && jumps.find((j) => j.id === pod.show);
  const stage = (color, left, right, body, cls = "") => `<section class="stage short ${cls}"><div class="st-strip ${color}"><span>${left}</span><span>${right}</span></div><div class="st-body">${body}</div></section>`;
  const upNow = (cue) => `<div class="st-label">Up now${P && on.length > 1 ? ` · <span style="color:${podCss(P.id)}">${podName(P.id)}</span>` : ""}</div><div class="st-name">${name}</div><div class="st-ev">${cue}</div>`;
  let h = `<div class="between" style="margin-bottom:10px"><button class="btn sm" data-act="back">‹ Back</button><span class="small muted">Vertical jump</span></div>`;
  if (!athletes.length) h += stage("d-amber", "No athletes", "", `<div class="st-ev" style="color:var(--text)">Add who's jumping first.</div>`);
  else if (shown) {
    const who = esc(athleteById(shown.athleteId).name);
    h += stage("d-blue", "Result", who, `<div class="st-label">Takeoff to peak${shown.sim ? " · simulated" : ""}${shown.pod && on.length > 1 ? ` · <span style="color:${podCss(shown.pod)}">${podName(shown.pod)}</span>` : ""}</div><div class="st-big" style="color:var(--blue)">${fmtJump(shown.h)}<small>cm</small></div>
      <div class="st-ev">${shown.hStand != null ? `Standing to peak <b style="color:var(--text)">${fmtJump(shown.hStand)} cm</b> · ` : ""}${fmtJumpAlt(shown.h)}</div>
      <div class="small muted" style="margin-top:8px">A jump mat would read ${fmtJump(shown.hFlight)} cm (flight ${shown.t.toFixed(3)} s)${shown.agree ? "" : ": higher because of the lower landing, which doesn't change the numbers above"}${shown.cal ? "" : " · pod not calibrated"}</div>`);
    const nx = athletes.find((x) => x.id === cap.athleteId);
    h += `<div class="card between"><div><div class="small muted">Next up</div><b style="font-size:20px">${esc(nx ? nx.name : "")}</b><div class="small muted">${podOn ? "Switches when someone stands still with a pod on" : ""}</div></div><button class="btn primary" style="white-space:nowrap" data-act="jump-next">Next ›</button></div>`;
  } else if (ph === -1) h += stage("d-amber", WEB_COPY || !sensor.connected ? "No pod" : "Waiting for the pod", "", upNow("No pod connected. Try it with a simulated jump."));
  else if (ph === 0) h += stage("d-green", "Ready", "Pod on", upNow(`<span class="st-cue">Stand still to start</span>`));
  else if (ph === 1) h += stage("d-pink", "Set", name, `<div class="st-go"><div>Jump when</div><div class="pk">ready</div></div>`, "armed");
  else if ((ph === 2 || ph === 3) && pod.air) h += stage("d-purple", ph === 2 ? "In the air" : "Landed · stand still", name, airBarHTML());
  else if (ph === 2) h += stage("d-purple", "In the air", name, `<div class="st-center"><div class="st-xl st-pulse">In the air</div></div>`);
  else if (ph === 3) h += stage("d-purple", "Landed", name, `<div class="st-center"><div class="st-xl">Stand still</div><div class="st-ev" style="margin-top:14px">The height shows up in a second.</div></div>`);
  else h += stage("d-blue", "Jump done", name, `<div class="st-center"><div class="st-xl st-pulse">Working it out</div></div>`);
  if (!podOn && athletes.length && pod.simPh == null) h += `<div class="card"><button class="btn${shown ? "" : " primary"}" style="width:100%" data-act="jump-sim">Simulate a jump · ${esc(firstName(cap.athleteId))}</button></div>`;
  if (pod.lastRes && !pod.lastRes.ok && !shown && pod.simPh == null) h += `<div class="card"><b>${esc(pod.lastRes.why)}</b></div>`;
  // the pods, and who's wearing each (someone for good, or whoever is up in the lineup)
  if (on.length) h += `<div class="card pods">${on.map((p) => { const w = podWho(p.id), pp = p.ph || 0;
    return `<div class="prow">${podDot(p.id)}<div class="pname"><b>${podName(p.id)}</b><span class="small muted">${!p.imu ? "sensor not answering" : pst(p.id).busy ? "working it out" : ["moving", "set", "in the air", "landed"][pp] || ""}${p.cal ? "" : " · not calibrated"}</span></div>
      <select data-pod="${p.id}" aria-label="Who's wearing the ${podName(p.id)}"><option value="">Who's up</option>${athletes.map((x) => `<option value="${x.id}" ${x.id === w ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>`; }).join("")}</div>`;
  if (athletes.length) {
    const n = settings.jumpEach || 1;
    h += `<div class="lu-head"><div class="label">Lineup</div><span>Tap who's up · hold &amp; drag to move</span></div>
      <div class="between" style="margin:-4px 0 10px"><span class="small muted">Jumps each before the next one's up</span><div class="seg" style="width:150px">${[1, 2, 3].map((k) => `<button data-act="jump-each" data-v="${k}" aria-pressed="${k === n}">${k}</button>`).join("")}</div></div>${lineupHTML("run")}`;
  }
  h += `<button class="lu-add" data-act="ath-new">+ Add athlete</button>`;
  if (today.length) {
    const best = {}; today.forEach((j) => { if (!best[j.athleteId] || j.h > best[j.athleteId]) best[j.athleteId] = j.h; });
    h += `<div class="card" style="margin-top:14px"><div class="between"><div class="label">Today · ${today.length} jump${today.length === 1 ? "" : "s"}</div><span class="small muted">takeoff / standing, cm</span></div>
      <div class="list" style="margin-top:6px">${today.map((j) => `<div class="item"><div><b>${esc(athleteById(j.athleteId).name)}</b> <span class="small muted">${timeLabel(j.ts)}${j.sim ? " · sim" : ""}</span></div><div class="r"><b>${fmtJump(j.h)}</b>${j.hStand != null ? ` <span class="small muted">/ ${fmtJump(j.hStand)}</span>` : ""}${j.h === best[j.athleteId] ? ` <span class="pill ok">best</span>` : ""} <button class="btn sm ghost" data-act="jump-del" data-id="${j.id}" aria-label="Delete">✕</button></div></div>`).join("")}</div></div>`;
  }
  return h;
}
// the rising bar while in the air: flies the takeoff speed (h = v·t − g·t²/2) up to its peak and holds it there.
// A live preview; the real number comes from the full recording a moment after landing.
function airScale() {
  const who = (pod.air && pod.air.who) || cap.athleteId, mine = jumps.filter((j) => j.athleteId === who && dayKey(j.ts) === dayKey(Date.now()));
  const best = mine.reduce((b, j) => Math.max(b, j.h), 0), peak = pod.air ? (pod.air.v * pod.air.v) / (2 * PodEngine.G) : 0;
  return { best, top: Math.max(0.7, Math.ceil((Math.max(best, peak) * 1.2) * 10) / 10) };
}
function airBarHTML() {
  const { best, top } = airScale(), pct = (m) => `${Math.min(100, (100 * m) / top).toFixed(1)}%`;
  let ticks = ""; for (let c = 10; c < top * 100; c += 10) ticks += `<div class="jbar-tick" style="bottom:${pct(c / 100)}"><span>${c}</span></div>`;
  return `<div class="jbar-wrap"><div class="jbar">${ticks}<div class="jbar-fill" id="jbFill"></div>${best ? `<div class="jbar-best" style="bottom:${pct(best)}"><span>best ${fmtJump(best)}</span></div>` : ""}</div>
    <div class="jbar-read"><div class="st-label">Height</div><div class="st-big"><span id="jbVal">0</span><small>cm</small></div><div class="st-ev" id="jbNote">live from the takeoff speed</div></div></div>`;
}
function airTick() {
  if (airTick.on) return; airTick.on = true;
  const f = () => {
    const A = pod.air;
    if (!A || view !== "jump") { airTick.on = false; return; }
    const G = PodEngine.G, t = (performance.now() - A.t0) / 1000, tp = A.v / G, peak = (A.v * A.v) / (2 * G);
    const hNow = t >= tp ? peak : Math.max(0, A.v * t - (G * t * t) / 2);
    const fill = $("#jbFill"), val = $("#jbVal"), { top } = airScale();
    if (fill) fill.style.height = `${Math.min(100, (100 * hNow) / top)}%`;
    if (val) val.textContent = (hNow * 100).toFixed(0);
    if (t >= tp) { const n = $("#jbNote"); if (n) n.textContent = "peak · exact number in a second"; }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
// no pod: a simulated jump through the same math (PodSim makes what the pod's chip would read)
function jumpSim() {
  if (pod.simPh != null || !cap.athleteId) return;
  pod.show = null;
  const rec = PodSim.simJump(0.3 + 0.35 * Math.random()).rec, R = PodEngine.analyzeJump(rec);
  const flight = R.ok ? R.flightTime * 1000 : 560, steps = [[1, 1100], [2, flight], [3, 1000], [4, 500]];
  let i = 0;
  const next = () => {
    if (i < steps.length) {
      pod.simPh = steps[i][0];
      if (pod.simPh === 2) pod.air = R.ok ? { v: R.takeoffSpeed, t0: performance.now(), who: cap.athleteId } : null;
      render(); if (pod.simPh === 2 && pod.air) airTick();
      setTimeout(next, steps[i++][1]); return;
    }
    pod.simPh = null; pod.air = null;
    podJump(rec, true);
  };
  next();
}

// ---------------- views ----------------
let view = "home", viewArg = null;
function go(v, arg, resume) {
  if (view === "jump" && v !== "jump") jumpScreen(true);   // the sensor's screen goes back to normal
  view = v; viewArg = arg == null ? null : arg;
  // New session opens on its first page (sprint or vault, who's running, where to stop) unless a run is being recorded
  // right now, or you're coming back to it (from adding an athlete, say): then it stays where you were
  if (v === "new" && !resume && cap.phase !== "recording" && cap.phase !== "processing" && cap.phase !== "summary") { if (cap.phase === "ready") stopNow(); cap.phase = "setup"; cap.step = "event"; cap.error = null; }
  render(); window.scrollTo(0, 0);
  if (v === "settings" && sensor.connected) certSync();   // fresh up-time and restart info for the firmware card
  if (v === "level") { lv.sig = ""; lvLoop(); }
}
function voiceCard() {
  return `<div class="card between" style="margin-top:6px"><div><b>Voice</b><div class="small muted">Says "${cap.queue.length > 1 ? "Name, ready" : "Ready"}" after the chime and reads every result aloud. Off: chime only.</div></div><label class="switch"><input type="checkbox" id="voiceSw" ${settings.voice ? "checked" : ""}><span></span></label></div>`;
}
function sessionBar() {
  if (!cap.session) return "";
  const n = cap.session.ids.length, mins = Math.max(0, Math.round((Date.now() - cap.session.start) / 60000));
  return `<div class="sessbar"><div><b>Session</b><span>${n} run${n === 1 ? "" : "s"} saved · ${mins} min</span></div><button class="btn sm" data-act="cap-end">End session</button></div>`;
}
function summaryHTML() {
  const s = cap.session, list = s ? runs.filter((r) => s.ids.includes(r.id)).sort((x, y) => x.ts - y.ts) : [];
  let h = `<div class="between" style="align-items:center"><h1 style="margin:0">Session ended</h1></div>
    <div class="card tint"><div class="small muted">${s ? `${dayLabel(dayKey(s.start), true)} · ${timeLabel(s.start)}` : ""} · ${list.length} run${list.length === 1 ? "" : "s"}</div>
    <div class="grid2" style="margin-top:10px"><button class="btn primary" data-act="session-report" ${list.length ? "" : "disabled"}>Print report (PDF)</button><button class="btn" data-act="cap-close">Done</button></div></div>`;
  h += sendCardHTML(true);
  if (!list.length) return h + `<div class="card empty">No runs were saved in this session.</div>`;
  const byA = {}; for (const r of list) (byA[r.athleteId] = byA[r.athleteId] || []).push(r);
  for (const [aid, rs] of Object.entries(byA)) {
    const s2 = rs.filter((r) => r.mode === "sprint"), v = rs.filter((r) => r.mode === "vault" && r.res.last5), bits = [];
    if (s2.length) bits.push(`top ${f2(Math.max(...s2.map((r) => r.res.top.speed)))} m/s`, `best ${f2(Math.min(...s2.map((r) => r.res.time)))} s`);
    if (v.length) bits.push(`last 5 m ${f2(Math.max(...v.map((r) => r.res.last5.speed)))} m/s`);
    h += `<div class="card"><b style="font-size:17px">${esc(athleteById(aid).name)}</b><div class="small muted" style="margin-top:2px">${rs.length} run${rs.length > 1 ? "s" : ""} · ${bits.join(" · ")}</div><div class="list">${rs.map((r) => runRow(r, false)).join("")}</div></div>`;
  }
  return h;
}
function runRow(r, selectable) {
  const h = headline(r), on = compareSel.includes(r.id);
  return `<div class="item" data-act="open-run" data-id="${r.id}">
    ${selectable ? `<button class="check ${on ? "on" : ""}" data-act="cmp-toggle" data-id="${r.id}" aria-label="Compare this run" aria-pressed="${on}">${on ? compareSel.indexOf(r.id) + 1 : ""}</button>` : ""}
    <div style="flex:1;min-width:0"><b>${esc(athleteById(r.athleteId).name)}</b><div class="small muted">${r.sim ? `<span style="color:var(--purple);font-weight:700">Simulated</span> · ` : ""}${testName(testKey(r))} · ${timeLabel(r.ts)}${r.mode === "vault" && r.res.steps.counted ? ` · ${r.res.steps.lefts} lefts` : ""}</div></div>
    <div class="r">${h.text}<div class="small muted" style="font-weight:500">${r.mode === "sprint" ? `top ${f2(r.res.top.speed)}` : `top ${f2(r.res.top.speed)}`}</div></div></div>`;
}
function compareBar() {
  if (!compareSel.length) return "";
  return `<div class="card tint between"><div><b>${compareSel.length} selected</b><div class="small muted">Pick up to four runs</div></div><div class="row"><button class="btn sm" data-act="cmp-clear">Clear</button><button class="btn sm primary" data-go="compare">Compare</button></div></div>`;
}

// ---------------- home: greeting and quick recaps (the full lists live in Sessions and Analytics) ----------------
function greeting() {
  const d = new Date(), hr = d.getHours();
  const sets = hr < 5 ? [["Rest is training too.", "Late one. Recover well and come back fast."], ["Welcome back!", "Your numbers are waiting."]]
    : hr < 11 ? [["Good morning!", "Fresh legs, fast runs."], ["Time to record some speed!", "Set up the tripod and let's go."], ["Early reps count.", "One step closer to a new best."]]
    : hr < 17 ? [["Welcome back!", "Ready for today's session?"], ["Time to record some speed!", "Every run gets you closer."], ["One step closer…", "to your fastest approach yet."]]
    : hr < 22 ? [["Evening session?", "Let's see what the legs have left."], ["One step closer…", "to your fastest approach yet."], ["Welcome back!", "Here's where things stand."]]
    : [["Welcome back!", "Here's how today went."], ["Rest up.", "Speed is built in recovery too."]];
  // the same line for the whole hour, so it doesn't change every time the screen redraws
  const seed = d.getFullYear() * 1e4 + (d.getMonth() + 1) * 100 + d.getDate() + hr * 7;
  return sets[seed % sets.length];
}
// every time an athlete beat their own best (not counting their first run)
function prEvents() {
  const asc = runs.slice().sort((a, b) => a.ts - b.ts), best = {}, ev = [];
  const metrics = [
    ["Top speed", (r) => r.mode === "sprint" && r.res.top && r.res.top.speed, "high", (v) => `${f2(v)} m/s`],
    ["Flying 10 m", (r) => r.mode === "sprint" && r.res.fly10 && r.res.fly10.time, "low", (v) => `${f2(v)} s`],
    ["Last 5 m into takeoff", (r) => r.mode === "vault" && r.res.last5 && r.res.last5.speed, "high", (v) => `${f2(v)} m/s`],
  ];
  for (const r of asc) for (const [name, pick, better, fmt] of metrics) {
    const v = pick(r); if (!v || !isFinite(v)) continue;
    const k = r.athleteId + name, b = best[k];
    if (b == null) { best[k] = v; continue; }
    if (better === "low" ? v < b : v > b) { ev.push({ r, name, text: fmt(v), gain: better === "low" ? `−${f2(b - v)} s` : `+${f2(v - b)} m/s` }); best[k] = v; }
  }
  return ev.reverse();
}
function homeHTML() {
  const [hi, sub] = greeting(), now = Date.now(), todayK = dayKey(now);
  const today = runs.filter((r) => dayKey(r.ts) === todayK), week = runs.filter((r) => now - r.ts < 7 * 864e5);
  const prs = prEvents().filter((e) => now - e.r.ts < 30 * 864e5);
  // one line under the greeting that says something real
  let line = sub;
  if (prs.length && now - prs[0].r.ts < 3 * 864e5) line = `New best: ${esc(athleteById(prs[0].r.athleteId).name)}, ${prs[0].name.toLowerCase()} ${prs[0].text}.`;
  else if (today.length) line = `${today.length} run${today.length > 1 ? "s" : ""} recorded today. ${sub}`;
  let h = `<div class="hello"><div class="hi">${hi}</div><div class="muted">${line}</div></div>`;
  // the sensor, as a strip in the screen's colours: green connected, amber no LiDAR signal, dim not connected
  const noLidar = sensor.connected && !sensor.rate;
  const hs = !sensor.connected ? ["d-dim", "No sensor", ""] : noLidar ? ["d-amber", "No LiDAR signal", ""] : ["d-green", "Sensor ready", sensor.phones > 1 ? `${sensor.phones} devices` : ""];
  h += `<div class="card home-sensor"><div class="st-strip ${hs[0]}"><span>${hs[1]}</span><span>${hs[2]}</span></div><div class="hs-body">
      ${sensor.connected && !noLidar ? `<div class="between" style="align-items:flex-end"><div><div class="label">Distance</div><div class="hs-d"><span data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</span><small>m</small></div></div><div class="small muted" style="text-align:right">${sensor.rate} readings/s</div></div>`
        : `<div class="small muted">${noLidar ? "Connected, but the LiDAR isn't sending anything. Check its cable and the power bank." : WEB_COPY ? `This copy can't reach the sensor. To record, join the SpeedLidar Wi-Fi and open ${SECURE_HOST} (or 192.168.4.1). New session here is a simulated practice run.` : "Join the SpeedLidar Wi-Fi to record."}</div>`}
    <button class="btn big primary" style="margin-top:14px" data-go="new">New session</button>
    ${settings.podSeen ? `<button class="btn" style="margin-top:10px;width:100%" data-act="go-jump">Jump test${sensor.pod && sensor.pod.on ? "" : " · pod not connected"}</button>` : ""}</div></div>`;
  h += sendCardHTML(true) + (WEB_COPY ? getCardHTML() : "");
  if (!athletes.length) return h + `<div class="card"><b>Start here</b><div class="small muted" style="margin:4px 0 10px">Add the athletes you'll be timing. Body weight is optional and only used for power.</div><button class="btn" data-act="ath-new">Add an athlete</button></div>`;
  // quick numbers
  const tile = (v, k, go) => `<button class="qt" ${go ? `data-go="${go}"` : ""}><b>${v}</b><span>${k}</span></button>`;
  h += `<div class="qtiles">${tile(today.length, "runs today", "sessions")}${tile(week.length, "this week", "sessions")}${tile(prs.filter((e) => now - e.r.ts < 7 * 864e5).length, "PRs this week", "analytics")}</div>`;
  if (!runs.length) return h + `<div class="card"><b>No runs yet</b><div class="small muted" style="margin-top:4px">Tap New session, pick sprint, vault or vertical jump and who's going, and the sensor does the rest. No sensor yet? Settings → Add demo data.</div></div>`;
  // last session recap
  const lastK = dayKey(runs.reduce((p, q) => (q.ts > p.ts ? q : p)).ts), last = runs.filter((r) => dayKey(r.ts) === lastK);
  const byA = {}; for (const r of last) (byA[r.athleteId] = byA[r.athleteId] || []).push(r);
  const lines = Object.entries(byA).slice(0, 4).map(([aid, rs]) => {
    const s = rs.filter((r) => r.mode === "sprint"), v = rs.filter((r) => r.mode === "vault" && r.res.last5);
    const bits = [];
    if (s.length) bits.push(`top ${f2(Math.max(...s.map((r) => r.res.top.speed)))} m/s`);
    if (v.length) bits.push(`last 5 m ${f2(Math.max(...v.map((r) => r.res.last5.speed)))} m/s`);
    return `<div class="rl"><b>${esc(athleteById(aid).name)}</b><span>${rs.length} run${rs.length > 1 ? "s" : ""} · ${bits.join(" · ")}</span></div>`;
  }).join("");
  const more = Object.keys(byA).length > 4 ? `<div class="small muted">+${Object.keys(byA).length - 4} more</div>` : "";
  h += `<div class="card" data-act="open-session" data-id="${lastK}" style="cursor:pointer"><div class="between"><div class="label">${lastK === todayK ? "Today's session" : "Last session"}</div><div class="small muted">${dayLabel(lastK, true)} ›</div></div><div style="margin-top:8px">${lines}${more}</div></div>`;
  // recent bests
  if (prs.length) h += `<div class="card"><div class="label" style="margin-bottom:6px">Recent personal bests</div>${prs.slice(0, 3).map((e) => `<div class="pr" data-act="open-run" data-id="${e.r.id}"><span class="badge">PR</span><div style="flex:1;min-width:0"><b>${esc(athleteById(e.r.athleteId).name)}</b><div class="small muted">${e.name} · ${dayLabel(dayKey(e.r.ts))}</div></div><div class="r">${e.text}<div class="small" style="color:var(--good);font-weight:600">${e.gain}</div></div></div>`).join("")}</div>`;
  // fastest right now (last 30 days), across the team
  const recent = runs.filter((r) => now - r.ts < 30 * 864e5);
  const lead = (pick) => { let b = null; for (const r of recent) { const v = pick(r); if (v && isFinite(v) && (!b || v > b.v)) b = { v, r }; } return b; };
  const ts = lead((r) => r.mode === "sprint" && r.res.top.speed), tv = lead((r) => r.mode === "vault" && r.res.last5 && r.res.last5.speed);
  if ((ts || tv) && athletes.length > 1) h += `<div class="card" data-go="analytics" style="cursor:pointer"><div class="between"><div class="label">Fastest in the last 30 days</div><div class="small muted">Analytics ›</div></div><div class="grid2" style="margin-top:8px">
      ${ts ? `<div><div class="small muted">Sprint top speed</div><div class="big2">${f2(ts.v)}<small> m/s</small></div><div class="small">${esc(athleteById(ts.r.athleteId).name)}</div></div>` : ""}
      ${tv ? `<div><div class="small muted">Last 5 m into takeoff</div><div class="big2">${f2(tv.v)}<small> m/s</small></div><div class="small">${esc(athleteById(tv.r.athleteId).name)}</div></div>` : ""}</div></div>`;
  return h;
}

// ---------------- New session: one question at a time ----------------
// Event → Distance (sprint: where to stop; vault: distance and sensor placement) → Who's running → Get ready.
// Chime, voice and Hands Free live in Settings so setting up a run stays quick.
const WIZ = ["event", "distance", "who"];
const chimeCard = () => `<div class="card" style="margin-top:6px"><b>Ready chime</b><div class="small muted">Plays every time an athlete has stood in long enough and the sensor is armed. Turn the phone volume up: it plays with the silent switch on and through a Bluetooth speaker.</div>
  <div class="between" style="margin-top:10px;gap:8px;flex-wrap:wrap"><div class="chips">${[["original", "Original"], ["gatecam", "GateCamLive"]].map(([k, l]) => `<button class="chip sm" data-act="chime-kind" data-v="${k}" aria-pressed="${(CHIMES[settings.chime] ? settings.chime : "original") === k}">${l}</button>`).join("")}</div><button class="btn sm" data-act="chime-test">▶ Play chime</button></div></div>`;
function wizardHTML() {
  if (!WIZ.includes(cap.step)) cap.step = "event";
  const i = WIZ.indexOf(cap.step), vault = cap.mode === "vault";
  const titles = { event: "Choose event", distance: vault ? "Distance and Sensor Placement" : "Distance", who: "Who's running?" };
  const subs = { event: "", distance: vault ? "Where you're jumping and how far the tripod is from the box." : "Where the run stops being recorded.", who: "" };
  let h = sessionBar() + `<div class="wiz-top">${i ? `<button class="wiz-back" data-act="wiz-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Back</button>` : `<span></span>`}<span class="small muted">Step ${i + 1} of ${WIZ.length}</span></div>
    <div class="wiz-bar" aria-hidden="true">${WIZ.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>
    <h1 style="margin-bottom:4px">${titles[cap.step]}</h1>${subs[cap.step] ? `<div class="muted" style="margin-bottom:14px">${subs[cap.step]}</div>` : `<div style="height:10px"></div>`}`;
  if (cap.error) h += `<div class="card" style="border-color:var(--bad)"><b style="color:var(--bad)">${esc(cap.error)}</b></div>`;
  if (cap.step === "event") {
    const tile = (v, name, sub, icon) => `<button class="tile" data-act="cap-mode" data-v="${v}" aria-pressed="${cap.mode === v}">${icon}<b>${name}</b><span>${sub}</span></button>`;
    h += `<div class="tiles">${tile("sprint", "Sprint", "Top speed, splits and the fastest flying 10 m", `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4a1.5 1.5 0 1 0 0 .01"/><path d="M7 21l3-6 3 2v5M10 15l1-5 4 2 3-1M11 10l-3 1-2 3"/></svg>`)}
      ${tile("vault", "Vault", "Lefts, top speed and the last 5 m into the box", `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21L20 4"/><path d="M8 21l3-5 3 1"/><path d="M12 9.5a1.5 1.5 0 1 0 0 .01"/></svg>`)}
      <button class="tile" data-act="go-jump"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a1.5 1.5 0 1 0 0 .01"/><path d="M8 11l4-3 4 3M12 8v6l-3 4M12 14l3 4"/><path d="M4 21h16"/><path d="M19 4v6M17 6l2-2 2 2"/></svg><b>Vertical jump</b><span>Jump height from the waist pod</span></button></div>`;
  } else if (cap.step === "distance" && !vault) {
    h += `<div class="label" style="margin-bottom:8px">Stop at</div><div class="bigchips">${[10, 20, 30, 40, 60].map((d) => `<button class="chip big" data-act="cap-target" data-v="${d}" aria-pressed="${cap.target === d}">${d} m</button>`).join("")}</div>
      <div class="row" style="gap:8px;margin-top:12px"><input type="number" id="customTarget" inputmode="numeric" min="5" max="80" data-def="50" data-unit="m" data-title="Stop at" data-then="cap-target-custom" placeholder="Other distance" style="flex:1" value="${[10, 20, 30, 40, 60].includes(cap.target) ? "" : cap.target}"><button class="btn" data-act="cap-target-custom" hidden>Next</button></div>
      <div class="small muted" style="margin-top:14px">Recording starts by itself when the athlete moves and stops at this distance.</div>`;
  } else if (cap.step === "distance") {
    const pole = !!SETUPS[cap.setup].pole, far = SETUPS[cap.setup].boxFt === 150;
    const pick = (p, f) => (p ? "polerun" : "runway") + (f ? "150" : "100");
    h += `<div class="label" style="margin:2px 0 8px">Where</div><div class="grid2">
        <button class="opt" data-act="cap-setup" data-v="${pick(false, far)}" aria-pressed="${!pole}"><b>On runway</b><span>Jumping into the box</span></button>
        <button class="opt" data-act="cap-setup" data-v="${pick(true, far)}" aria-pressed="${pole}"><b>Off runway</b><span>Pole runs, no box</span></button></div>
      <div class="label" style="margin:16px 0 8px">Sensor placement</div><div class="grid2">
        <button class="opt" data-act="cap-setup" data-v="${pick(pole, false)}" aria-pressed="${!far}"><b>100 ft</b><span>Short approach</span></button>
        <button class="opt" data-act="cap-setup" data-v="${pick(pole, true)}" aria-pressed="${far}"><b>150 ft</b><span>Long approach</span></button></div>
      <button class="btn big primary" style="margin-top:16px" data-act="wiz-next">Next</button>
      <details class="howto-d"><summary>How to set up the tripod</summary>${setupGuide(cap.setup)}</details>`;
  } else {
    const what = vault ? SETUPS[cap.setup].name : `${cap.target} m sprint`, q = cap.queue.filter((id) => athletes.some((a) => a.id === id));
    h += `<div class="ev-sum"><div><div class="label">Event</div><b>${esc(what)}</b></div><button class="btn sm" data-act="wiz-edit">Change</button></div>`;
    if (!athletes.length) h += `<div class="card"><div class="muted small" style="margin-bottom:8px">Add who's running first.</div><button class="btn" data-act="ath-new">Add athlete</button></div>`;
    else h += `<div class="lu-head"><div class="label">Lineup</div><span>Tap to add or take off · hold &amp; drag to move</span></div>${lineupHTML("setup")}<button class="lu-add" data-act="ath-new">+ Add athlete</button>`;
    h += `<div class="small muted" style="text-align:center;margin-top:14px">Hands Free Mode is <b>${settings.solo ? "on" : "off"}</b> · chime, voice and Hands Free are in <a href="#" data-go="settings">Settings</a></div>`;
    h += `<div class="dock"><button class="btn primary" data-act="cap-ready" ${q.length ? "" : "disabled"}>${!q.length ? "Tap who's running" : q.length === 1 ? `Get ready · ${esc(firstName(q[0]))}` : `Get ready · ${q.length} taking turns`}</button></div>`;
  }
  return h;
}
function newHTML() {
  const a = cap.athleteId && athletes.find((x) => x.id === cap.athleteId);
  if (cap.phase === "summary") return summaryHTML();
  if (cap.phase === "setup" || cap.phase === "ready-error") return wizardHTML();
  const test = cap.mode === "sprint" ? `${cap.target} m sprint` : SETUPS[cap.setup].name, rule = armRule(), name = esc(a ? a.name : "");
  const lastBlock = () => {
    const r = cap.lastRun; if (!r) return "";
    return `<h2 style="margin-top:18px">Last run · ${esc(athleteById(r.athleteId).name)}</h2>` + resultsHTML(r)
      + `<div class="row" style="justify-content:flex-end;margin-top:-4px"><span class="small muted" style="margin-right:auto">${cap.lastSaved ? "Saved" : ""}</span><button class="btn sm" data-act="open-report" data-id="${r.id}">Report</button></div>`;
  };
  const sessLine = () => { if (!cap.session) return ""; const n = cap.session.ids.length, mins = Math.max(0, Math.round((Date.now() - cap.session.start) / 60000));
    return `<div class="sessline"><span><b>Session</b> · ${n} run${n === 1 ? "" : "s"} saved · ${mins} min</span><button class="btn sm" data-act="cap-end">End session</button></div>`; };
  const lineup = () => (athletes.length > 1 ? `<div class="lu-head"><div class="label">Lineup</div><span>Tap who's up · hold &amp; drag to move</span></div>${lineupHTML("run")}<div style="height:8px"></div>` : "");
  const stage = (color, left, right, body, cls = "") => `<section class="stage ${cls}"><div class="st-strip ${color}"><span>${left}</span><span>${right}</span></div><div class="st-body">${body}</div></section>`;
  const dist = `<span data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</span> m`;
  if (cap.phase === "waiting") {
    let h = cap.error ? stage("d-amber", "No connection", "", `<div class="st-label">Up now</div><div class="st-name">${name}</div><div class="st-ev" style="color:var(--text)">${esc(cap.error)}</div>`)
      : stage("d-green", "Ready", sensor.connected ? dist : "", `<div class="st-label">Up now</div><div class="st-name">${name}</div><div class="st-ev">${test}</div><div class="st-push" id="stcue">${cueHTML()}</div>`);
    h += sessLine();
    if (settings.solo) h += `<div class="small muted" style="margin:-6px 0 14px">Hands Free Mode: every run is saved and read out, then it waits for the next athlete.</div>`;
    if (!sensor.connected) h += `<div class="card"><div class="small muted" style="margin-bottom:8px">No sensor connected. Try it with a simulated athlete.</div><button class="btn" data-act="cap-sim-in">Simulate: athlete stands in</button></div>`;
    h += lineup() + lastBlock();
    return h + `<div class="dock"><button class="btn" data-act="cap-cancel">Cancel</button><button class="btn" data-act="cap-armnow">Arm now</button></div>`;
  }
  if (cap.phase === "ready") {
    let h = stage("d-pink", "Armed", name, `<div class="st-go"><div>Go when</div><div class="pk">ready</div></div>
      <div class="st-row"><div class="st-ev">${cap.mode === "sprint" ? `Clock starts on the first move · stops at ${cap.target} m` : "Records the lefts and the last 5 m · stops after takeoff"}</div><div class="st-ev" style="color:var(--text);white-space:nowrap">${dist}</div></div>`, "armed");
    h += sessLine();
    if (!sensor.connected) h += `<div class="card"><div class="small muted" style="margin-bottom:8px">No sensor connected. Try it with a simulated run.</div><button class="btn" data-act="cap-sim">Simulate a run</button></div>`;
    h += lineup() + lastBlock();
    return h + `<div class="dock"><button class="btn" data-act="cap-cancel">Cancel</button><button class="btn" data-act="cap-rewait">Not ready</button></div>`;
  }
  if (cap.phase === "recording") return stage("d-purple", "Recording", name, liveCardHTML()) + `<div class="dock"><button class="btn" data-act="cap-stop">Stop now</button></div>`;
  if (cap.phase === "processing") return stage("d-blue", "Run done", name, `<div class="st-center"><div class="st-xl st-pulse">Working it out</div><div class="st-ev" style="margin-top:14px">The result shows here in a second.</div></div>`);
  // review (Hands Free off): save or throw away
  const run = cap.run, hd = headline(run);
  let h = stage("d-blue", "Result", esc(athleteById(run.athleteId).name), `<div class="st-label">${hd.label}</div><div class="st-big" style="color:var(--blue)">${f2(hd.value)}<small>${hd.unit}</small></div><div class="st-ev">${test}</div>`, "short");
  h += `<div class="run-res">${resultsHTML(run)}</div>`;
  h += `<div class="dock"><button class="btn danger" data-act="cap-discard">Throw away</button><button class="btn primary" data-act="cap-save">Save${cap.queue.length > 1 ? ` · next ${esc(firstName(nextUp(run.athleteId)))}` : ""}</button></div>`;
  return h;
}
// under the name while waiting: what to do, or how far through the stand-still they are
function cueHTML() {
  if (sensor.connected && sensor.inZone && sensor.hold > 0.15) return `<div class="st-hold"><span>HOLD STILL</span><div class="d-bar"><b style="width:${Math.round(sensor.hold * 100)}%"></b></div></div>`;
  if (sensor.connected && sensor.inZone) return `<div class="st-cue pk">Stand still…</div>`;
  return `<div class="st-cue">${cap.mode === "sprint" ? "Stand still within 5 m to arm" : "Stand still on your mark to arm"}</div>`;
}
// The lineup, like the big display's roster: today's order above the line, everyone else below it.
//   setup: tap adds or takes someone off · during a run: tap = who's up now · both: hold a name (or grab ≡) and drag to reorder, also across the line
function lineupHTML(mode) {
  const q = cap.queue.filter((id) => athletes.some((a) => a.id === id));
  const rest = athletes.filter((a) => !q.includes(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  const row = (a, i) => {
    const inQ = i != null, up = mode === "run" && a.id === cap.athleteId;
    return `<button class="lu-row${inQ ? " in" : ""}${up ? " up" : ""}" data-act="lu-tap" data-id="${a.id}"><span class="lu-n">${inQ ? i + 1 : "+"}</span><span class="nm">${esc(a.name)}</span>${up ? `<span class="lu-tag">UP</span>` : ""}<span class="d-grip" aria-label="Drag to move">≡</span></button>`;
  };
  return `<div class="lu" id="lineup" data-mode="${mode}">${q.map((id, i) => row(athleteById(id), i)).join("")}<div class="d-div lu-div">${q.length ? "Not in today's lineup" : "Tap to add to the lineup"}</div>${rest.map((a) => row(a)).join("")}</div>`;
}
const luDrag = { dragging: false };
function lineupDrop(order, n) {
  cap.queue = order.slice(0, n);
  if (!cap.queue.includes(cap.athleteId) && cap.phase === "setup") cap.athleteId = cap.queue[0] || null;
  settings.lastQueue = cap.queue.slice(); saveSettings(); render();
  // tell the sensor, so the big display shows the same order
  if (cap.phase !== "setup" && sensor.connected && !cap.sim) {
    const names = order.map((id) => athleteById(id).name.slice(0, 23));
    fetch("/order", { method: "POST", body: new URLSearchParams({ roster: names.join("\n"), lineup: n }), cache: "no-store" }).catch(() => {});
  }
}
function lineupTap(id) {
  if (view === "jump") {
    if (!cap.queue.includes(id)) cap.queue.push(id);
    if (cap.athleteId !== id) pod.turn = 0;
    cap.athleteId = id;
  } else if (cap.phase === "setup") {
    const i = cap.queue.indexOf(id); if (i >= 0) cap.queue.splice(i, 1); else cap.queue.push(id);
    cap.athleteId = cap.queue[0] || null;
  } else {
    if (!cap.queue.includes(id)) cap.queue.push(id);
    if (id === cap.athleteId) return;
    cap.athleteId = id;
    if (!cap.sim && sensor.connected && (cap.phase === "waiting" || cap.phase === "ready")) { settings.lastQueue = cap.queue.slice(); settings.lastAthlete = id; saveSettings(); arm(sensor.state === 2); return; }
  }
  settings.lastQueue = cap.queue.slice(); settings.lastAthlete = cap.athleteId; saveSettings(); render();
}
function setupGuide(setup) {
  const ft = SETUPS[setup].boxFt, m = (ft * FT).toFixed(2);
  if (SETUPS[setup].pole) return `<div class="card howto"><div class="label">Pole runs · same setup every time · ${ft} ft</div><ol>
    <li>Pick where the box would be and put a <b>cone</b> there: the <b>box mark</b>. Everything is measured from it, just like the box on the runway.</li>
    <li>Run a tape from the cone straight back up the lane to <b>${ft} ft</b> and stand the tripod so the sensor window is right over that mark.</li>
    <li>Aim straight down the lane at the cone, at about lower-back height. <a href="#" data-act="go-level">Level it</a> so the beam stays at that height.</li>
    <li><b>Check it:</b> stand at the cone. The live distance should read about <b>${m} m</b>. Here: <b data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</b> m.</li>
    <li>Take off where you would on the runway. There's no box to hit, so the takeoff is found from the moment your feet leave the ground (the steps stop and speed drops at the pop-up), then the lefts are counted back from there.</li></ol>
    <div class="small muted">Start marks, lefts and the takeoff are in feet from the box mark, exactly like runway jumps, so the two compare directly.</div></div>`;
  return `<div class="card howto"><div class="label">Same setup every time · ${ft} ft</div><ol>
    <li>Run a tape from the <b>back of the box</b> straight up the middle of the runway to <b>${ft} ft</b>. Mark it with tape so it's there next time.</li>
    <li>Stand the tripod so the <b>front of the case</b> (the sensor window) is right over that mark.</li>
    <li>Aim straight down the runway at the box, at about lower-back height. <a href="#" data-act="go-level">Level it</a> so the beam stays at that height.</li>
    <li><b>Check it:</b> stand in the box. The live distance should read about <b>${m} m</b>. Here: <b data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</b> m.</li>
    <li>Run-ups up to about ${ft - 8} ft fit in front of the tripod.${setup === "runway100" ? " For longer run-ups, use the 150 ft setup." : ""}</li></ol>
    <div class="small muted">Everything is measured from the box, so you don't enter run-ups: start marks, takeoff spots, lefts and the last 5 m are worked out on every jump.</div></div>`;
}

function runHTML(id) {
  const r = runs.find((x) => x.id === id);
  if (!r) return `<div class="card empty">That run was deleted.</div>`;
  const on = compareSel.includes(r.id);
  let h = `<button class="btn sm" data-act="back">‹ Back</button><div class="between" style="margin-top:10px"><h1 style="margin-bottom:2px">${esc(athleteById(r.athleteId).name)}</h1><span class="pill">${testShort(testKey(r))}</span></div>
    <div class="muted small" style="margin-bottom:12px">${dayLabel(dayKey(r.ts), true)} · ${timeLabel(r.ts)}</div>`;
  h += resultsHTML(r);
  h += `<div class="grid3"><button class="btn" data-act="open-report" data-id="${r.id}">Report</button><button class="btn" data-act="cmp-toggle" data-id="${r.id}">${on ? "In compare ✓" : "Compare"}</button><button class="btn danger" data-act="del-run" data-id="${r.id}">Delete</button></div>`;
  h += compareBar();
  return h;
}

let sessPick = false;   // Sessions > Print report: showing the list of sessions to print
function sessionsHTML() {
  if (!runs.length && !jumps.length) return `<h1>Sessions</h1><div class="card empty">No runs saved yet.</div>`;
  const days = {}; for (const r of runs) (days[dayKey(r.ts)] = days[dayKey(r.ts)] || []).push(r);
  const jdays = {}; for (const j of jumps) (jdays[dayKey(j.ts)] = jdays[dayKey(j.ts)] || []).push(j);
  const keys = [...new Set([...Object.keys(days), ...Object.keys(jdays)])].sort().reverse();
  for (const k of keys) days[k] = days[k] || [];
  let h = `<div class="between" style="align-items:center"><h1>Sessions</h1><button class="btn sm" data-act="sess-print" aria-expanded="${!!sessPick}">Print report</button></div>`;
  // pick which session to print (the most recent ones)
  if (sessPick) h += `<div class="card"><div class="between"><div class="label">Print which session?</div><button class="btn sm ghost" data-act="sess-print">Close</button></div>
    <div class="list" style="margin-top:6px">${keys.slice(0, 10).map((k) => `<div class="item" data-act="day-report" data-id="${k}"><div><b>${dayLabel(k, true)}</b><div class="small muted">${days[k].length} run${days[k].length > 1 ? "s" : ""} · ${esc([...new Set(days[k].map((r) => athleteById(r.athleteId).name))].join(", "))}</div></div><div class="r" style="color:var(--purple);font-weight:700">Print</div></div>`).join("")}</div></div>`;
  h += compareBar();
  for (const k of keys) {
    const list = days[k], jl = jdays[k] || [], who = [...new Set(list.concat(jl).map((r) => athleteById(r.athleteId).name))];
    const tests = [...new Set(list.map(testKey))].map(testShort); if (jl.length) tests.push("Vertical jump");
    const count = [list.length ? `${list.length} run${list.length > 1 ? "s" : ""}` : "", jl.length ? `${jl.length} jump${jl.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    h += `<div class="card list"><div class="item" data-act="open-session" data-id="${k}" style="padding-top:0"><div><b>${dayLabel(k, true)}</b><div class="small muted">${count} · ${esc(who.join(", "))}</div><div class="small muted">${esc(tests.join(" · "))}</div></div><div class="r">›</div></div></div>`;
  }
  return h;
}
function sessionHTML(k) {
  const list = runs.filter((r) => dayKey(r.ts) === k);
  let h = `<div class="between" style="align-items:center"><button class="btn sm" data-act="back">‹ Sessions</button>${list.length ? `<button class="btn sm" data-act="day-report" data-id="${k}">Print report</button>` : ""}</div><h1 style="margin-top:10px">${dayLabel(k, true)}</h1>` + compareBar();
  const jl = jumps.filter((j) => dayKey(j.ts) === k);
  if (jl.length) {
    const byJ = {}; for (const j of jl) (byJ[j.athleteId] = byJ[j.athleteId] || []).push(j);
    h += `<div class="card"><div class="between"><b style="font-size:17px">Vertical jump</b><span class="small muted">takeoff / standing, cm</span></div>${Object.entries(byJ).map(([aid, js]) => { const b = js.reduce((x, j) => (j.h > x.h ? j : x));
      return `<div class="label" style="margin:12px 0 4px">${esc(athleteById(aid).name)} · best ${(b.h * 100).toFixed(1)} cm</div><div class="list">${js.slice().reverse().map((j) => `<div class="item"><div>${timeLabel(j.ts)}${j.sim ? ` <span class="small muted">sim</span>` : ""}</div><div class="r"><b>${(j.h * 100).toFixed(1)}</b>${j.hStand != null ? ` <span class="small muted">/ ${(j.hStand * 100).toFixed(1)}</span>` : ""}${j === b ? ` <span class="pill ok">best</span>` : ""}</div></div>`).join("")}</div>`; }).join("")}</div>`;
  }
  if (!list.length) return h + (jl.length ? "" : `<div class="card empty">No runs on this day.</div>`);
  const byA = {}; for (const r of list) (byA[r.athleteId] = byA[r.athleteId] || []).push(r);
  for (const [aid, rs] of Object.entries(byA)) {
    const best = {};
    for (const r of rs) { const key = testKey(r), hl = headline(r); if (hl.value == null) continue; if (!best[key] || (hl.better === "low" ? hl.value < best[key].v : hl.value > best[key].v)) best[key] = { v: hl.value, t: hl.text }; }
    let lefts = "";
    for (const key of [...new Set(rs.filter((r) => r.mode === "vault").map(testKey))]) {
      const vs = rs.filter((r) => testKey(r) === key && contactsOf(r).length).sort((x, y) => x.ts - y.ts);
      if (!vs.length) continue;
      lefts += `<div class="label" style="margin:14px 0 6px">Where the lefts landed · ${testShort(key)}</div>${runwayMap(vs.map((r) => ({ run: r, label: timeLabel(r.ts) })), { mid: settings.midOut })}
        ${leftsMatrix(vs, { stats: vs.length > 1, mid: settings.midOut })}`;
    }
    h += `<div class="card"><b style="font-size:17px">${esc(athleteById(aid).name)}</b><div class="small muted" style="margin-top:2px">Best · ${Object.entries(best).map(([key, b]) => `${testShort(key)}: <b style="color:var(--text)">${b.t}</b>`).join(" · ")}</div>${lefts}<div class="list">${rs.slice().reverse().map((r) => runRow(r, true)).join("")}</div></div>`;
  }
  return h;
}

// analytics: one athlete in depth, then compare athletes on the same test
const anState = { athleteId: null, test: null, cmp: null };
const ANC = ["var(--pink)", "var(--purple)", "var(--blue)", "#e08a00"];
function bestOf(list, pick, better) {
  let best = null; for (const r of list) { const v = pick(r); if (v == null || !isFinite(v)) continue; if (!best || (better === "low" ? v < best.v : v > best.v)) best = { v, r }; }
  return best;
}
const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sdOf = (a) => { if (a.length < 2) return null; const m = avgOf(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const modeOf = (a) => { const c = {}; let b = null; for (const x of a) { c[x] = (c[x] || 0) + 1; if (b == null || c[x] > c[b]) b = x; } return b; };
const sprintTopFor = (aid) => bestOf(runs.filter((r) => r.athleteId === aid && r.mode === "sprint"), (r) => r.res.top.speed, "high");
const signed = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
// the number each test is compared on: sprint = top speed, vault = last 5 m into takeoff
const keyMetric = (test) => (test.startsWith("sprint") ? { label: "top speed", pick: (r) => r.res.top.speed } : { label: "last 5 m", pick: (r) => r.res.last5 && r.res.last5.speed });
function bestPerDay(list, pick) {
  const by = {}; for (const r of list) { const v = pick(r); if (v == null || !isFinite(v)) continue; const k = dayKey(r.ts); if (!by[k] || v > by[k].v) by[k] = { v, r }; }
  return by;
}
const spreadFt = (ft) => (ft < 1 ? `±${Math.round(ft * 12)}"` : `±${ftLabel(ft)}`);
const statRow = (k, v, sub) => `<div class="item" style="cursor:default"><div>${k}${sub ? `<div class="small muted">${sub}</div>` : ""}</div><div class="r">${v}</div></div>`;

function sprintProfileCard(mine, tr) {
  const by = bestPerDay(tr, (r) => r.res.top.speed), days = Object.keys(by).sort();
  if (!days.length) return "";
  const bestTop = bestOf(tr, (r) => r.res.top.speed, "high"), bestFly = bestOf(tr, (r) => r.res.fly10 && r.res.fly10.time, "low");
  const first = by[days[0]].v, last = by[days[days.length - 1]].v, weeks = (new Date(days[days.length - 1]) - new Date(days[0])) / 6048e5;
  const t0 = new Date(days[0]).getTime(), X = days.map((d) => (new Date(d).getTime() - t0) / 864e5), Y = days.map((d) => by[d].v);
  const lo = Math.min(...Y), hi = Math.max(...Y), pad = Math.max(0.08, (hi - lo) * 0.3);
  const chart = lcSlot({ aria: "Top speed per day", h: 200, x0: -0.5, x1: Math.max(1, X[X.length - 1]) + 0.5, y0: lo - pad, y1: hi + pad, yUnit: "m/s", yfmt: (t) => t.toFixed(2),
    xt: X.length > 1 ? [X[0], X[X.length - 1]] : [X[0]], xfmt: (t) => dayLabel(days[X.indexOf(t)] || days[0]),
    series: [{ x: X, y: Y, color: "var(--pink)", w: 2.4, fill: true }], dots: X.map((x, i) => ({ x, y: Y[i], attrs: `data-act="open-run" data-id="${by[days[i]].r.id}" style="cursor:pointer"` })) });
  const B = bestTop.r.res, st = B.stride, reach = B.reach || {};
  const vault = runs.filter((r) => r.athleteId === anState.athleteId && r.mode === "vault"), bestL5 = bestOf(vault, (r) => r.res.last5 && r.res.last5.speed, "high");
  let h = `<div class="card"><div class="between"><div class="label">Max velocity</div><div class="small muted">best top speed per day</div></div>${chart}
    <div class="list" style="margin-top:6px">
    ${statRow("Best top speed", `${f2(bestTop.v)} m/s`, `${f1(mph(bestTop.v))} mph · ${dayLabel(dayKey(bestTop.r.ts))}`)}
    ${days.length > 1 ? statRow("Change since first test", `<span style="color:${last >= first ? "var(--good)" : "var(--bad)"}">${signed(last - first)} m/s</span>`, `${days.length} test days over ${weeks < 1 ? Math.round(weeks * 7) + " days" : f1(weeks) + " weeks"}`) : ""}
    ${bestFly ? statRow("Best flying 10 m", `${f2(bestFly.v)} s`, `${f2(10 / bestFly.v)} m/s average`) : ""}
    ${st ? statRow("Step rate × length on best run", `${f2(st.freq)} × ${f2(st.length)} m`, "steps per second × metres per step (estimate)") : ""}
    ${reach[98] != null ? statRow("Run-up needed for 98% of top speed", `${f1(reach[98])} m`, `${f1(reach[98] / FT)} ft on the best run`) : ""}
    ${bestL5 ? statRow("Runway speed carried", `${Math.round((bestL5.v / bestTop.v) * 100)}%`, `best last 5 m ${f2(bestL5.v)} m/s ÷ best sprint top speed`) : ""}
    </div></div>`;
  return h;
}

function vaultProfileCard(tr) {
  const ok = tr.filter((r) => r.res.last5);
  if (!ok.length) return "";
  const setup = anState.test.split("-")[1], hasBox = true;
  const L5 = ok.map((r) => r.res.last5.speed), lefts = ok.map((r) => r.res.steps.lefts).filter(Boolean);
  const TO = ok.map((r) => r.res.takeoff.outFt).filter((x) => x != null), SM = ok.map((r) => r.res.startMarkFt).filter((x) => x != null);
  const sTop = sprintTopFor(anState.athleteId);
  const lastLeft = ok.map((r) => { const n = r.res.steps.times.length; if (!n) return null; const k = r.res.curve.t.findIndex((t) => t >= r.res.steps.times[n - 3 >= 0 ? n - 3 : 0]); return k >= 0 ? r.res.curve.v[k] : null; }).filter((x) => x != null);
  let h = `<div class="card"><div class="between"><div class="label">${esc(SETUPS[setup].name)} · consistency</div><div class="small muted">${ok.length} jump${ok.length > 1 ? "s" : ""}</div></div>`;
  if (hasBox && TO.length >= 2) {
    // does more speed move the takeoff? each dot is one jump
    const pts = ok.filter((r) => r.res.takeoff.outFt != null), xs = pts.map((r) => r.res.takeoff.outFt), ys = pts.map((r) => r.res.last5.speed);
    const xa = Math.floor(Math.min(...xs) - 1), xb = Math.ceil(Math.max(...xs) + 1), ya = Math.min(...ys), yb = Math.max(...ys), pad = Math.max(0.1, (yb - ya) * 0.3);
    h += `<div class="small muted" style="margin-top:4px">Each dot is a jump: speed into the takeoff against the takeoff spot.</div>` + lcSlot({ aria: "Last 5 m against takeoff spot", h: 200, x0: xa, x1: xb, y0: ya - pad, y1: yb + pad, yUnit: "m/s", xTitle: "Takeoff, feet out from the box", yfmt: (t) => t.toFixed(1),
      series: [], dots: pts.map((r, i) => ({ x: xs[i], y: ys[i], attrs: `data-act="open-run" data-id="${r.id}" style="cursor:pointer"` })) });
  }
  // where the lefts land, jump after jump (last 10)
  const lj = ok.filter((r) => contactsOf(r).length).sort((x, y) => x.ts - y.ts).slice(-10);
  if (lj.length) {
    const mid = settings.midOut, col = []; for (const r of lj) { const c = contactsOf(r).find((x) => x.left && x.out === mid); if (c) col.push(spotFt(r, c)); }
    const midTxt = col.length ? `${ftLabel(avgOf(col))}${col.length > 1 ? ` ${spreadFt(sdOf(col))}` : ""}` : "—";
    h += `<div class="label" style="margin:14px 0 6px">Where the lefts land · last ${lj.length} jump${lj.length > 1 ? "s" : ""}</div>
      ${runwayMap(lj.map((r) => ({ run: r, label: `${dayLabel(dayKey(r.ts))} ${timeLabel(r.ts)}` })), { mid })}
      <div class="between" style="margin:8px 0 4px;gap:8px;flex-wrap:wrap"><span class="small muted">Mid mark at</span><div class="chips">${[2, 3, 4, 5, 6].map((k) => `<button class="chip sm" data-act="mid-out" data-v="${k}" aria-pressed="${k === mid}">${k} lefts out</button>`).join("")}</div></div>
      <div class="midbox"><div><div class="small muted">Mid mark · ${mid} lefts out from takeoff</div><div class="big2">${midTxt}</div></div><div class="small muted" style="text-align:right">${SETUPS[setup].pole ? "from the box mark" : "from the box"}<br>${col.length} jump${col.length === 1 ? "" : "s"}</div></div>
      ${leftsMatrix(lj, { stats: true, mid, rowLabel: (r) => `${dayLabel(dayKey(r.ts))} ${timeLabel(r.ts)}` })}
      <div class="small muted" style="margin-top:4px">Each column is a left counted back from the takeoff. A small spread means that left lands in the same spot every jump. If the takeoff column moves but the mid mark doesn't, the change is in the last steps.</div>`;
  }
  const fin = ok.map((r) => r.res.finish && r.res.finish.change).filter((x) => x != null && isFinite(x));
  h += `<div class="list" style="margin-top:6px">
    ${fin.length ? statRow("Into the box", `${avgOf(fin) >= 0 ? "+" : "−"}${Math.abs(avgOf(fin)).toFixed(2)} m/s`, `average speed change in the last ½ s before the plant · ${fin.filter((x) => x <= -0.1).length} of ${fin.length} slowed`) : ""}
    ${statRow("Last 5 m", `${f2(avgOf(L5))} m/s`, `average · best ${f2(Math.max(...L5))} · spread ±${f2(sdOf(L5) || 0)}`)}
    ${sTop ? statRow("Carried from sprint top speed", `${Math.round((avgOf(L5) / sTop.v) * 100)}%`, `average last 5 m ÷ best sprint top speed (${f2(sTop.v)} m/s)`) : statRow("Carried from sprint top speed", "—", "save a sprint test to see this")}
    ${lastLeft.length ? statRow("Speed 3 steps before takeoff", `${f2(avgOf(lastLeft))} m/s`, "average") : ""}
    ${lefts.length ? statRow("Lefts", `${modeOf(lefts)}`, Math.min(...lefts) === Math.max(...lefts) ? "every jump" : `most often · range ${Math.min(...lefts)}–${Math.max(...lefts)}`) : ""}
    ${TO.length ? statRow("Takeoff spot", ftLabel(avgOf(TO)), TO.length > 1 ? `average · spread ${spreadFt(sdOf(TO))} · range ${ftLabel(Math.min(...TO))}–${ftLabel(Math.max(...TO))}` : "one jump") : ""}
    ${SM.length ? statRow("Start mark", ftLabel(avgOf(SM)), SM.length > 1 ? `average · spread ${spreadFt(sdOf(SM))}` : "") : ""}
  </div></div>`;
  return h;
}

function compareAthletesCard(test) {
  const isSprint = test.startsWith("sprint"), km = keyMetric(test);
  const withRuns = athletes.filter((a) => runs.some((r) => r.athleteId === a.id && testKey(r) === test));
  if (withRuns.length < 2) return `<div class="card"><div class="label">Compare athletes · ${testName(test)}</div><div class="small muted" style="margin-top:6px">Only one athlete has ${testName(test)} runs so far. Add another athlete's runs to compare.</div></div>`;
  if (!anState.cmp) anState.cmp = withRuns.slice(0, 4).map((a) => a.id);
  const sel = anState.cmp.filter((id) => withRuns.some((a) => a.id === id));
  // one row per athlete with this test
  const rows = withRuns.map((a) => {
    const tr = runs.filter((r) => r.athleteId === a.id && testKey(r) === test);
    const best = bestOf(tr, km.pick, "high"), sTop = sprintTopFor(a.id), last = tr.reduce((p, q) => (q.ts > p.ts ? q : p));
    const o = { a, n: tr.length, best, last };
    if (isSprint) { o.fly = bestOf(tr, (r) => r.res.fly10 && r.res.fly10.time, "low"); o.time = bestOf(tr, (r) => r.res.time, "low"); }
    else { const vs = tr.filter((r) => r.res.last5); o.avg = avgOf(vs.map((r) => r.res.last5.speed)); o.carry = sTop && best ? best.v / sTop.v : null; o.lefts = modeOf(tr.map((r) => r.res.steps.lefts).filter(Boolean));
      const TO = tr.map((r) => r.res.takeoff.outFt).filter((x) => x != null); o.toSd = sdOf(TO); }
    return o;
  }).filter((o) => o.best).sort((x, y) => y.best.v - x.best.v);
  const top = rows[0].best.v, low = rows[rows.length - 1].best.v, bw = (v) => (top === low ? 100 : 35 + 65 * ((v - low) / (top - low)));
  let h = `<div class="card"><div class="between"><div class="label">Compare athletes · ${testName(test)}</div><div class="small muted">ranked by best ${km.label}</div></div>${isSprint ? "" : `<div class="small muted" style="margin-top:4px">Carry = best last 5 m as a % of sprint top speed. TO ± = how much the takeoff spot moves.</div>`}
    <div class="chips" style="margin:10px 0 4px">${withRuns.map((a) => { const i = sel.indexOf(a.id); return `<button class="chip" data-act="an-cmp" data-id="${a.id}" aria-pressed="${i >= 0}">${i >= 0 ? `<span class="dot" style="background:${ANC[i]}"></span>` : ""}${esc(a.name)}</button>`; }).join("")}</div>`;
  // speed curves: each selected athlete's best run, overlaid (lined up like Compare: from the start for sprints, at
  // the takeoff for vaults)
  const bestRuns = sel.map((id) => { const o = rows.find((x) => x.a.id === id); return o ? o.best.r : null; });
  const shown = bestRuns.map((r, i) => ({ r, i })).filter((x) => x.r && x.r.res && x.r.res.curve);
  if (shown.length) {
    const vault = !isSprint, xs = shown.map(({ r }) => compareX(r));
    const end = isSprint ? Math.max(...shown.map(({ r }) => r.target || 0)) : 0;
    const cut = shown.map(({ r }, k) => { const lim = isSprint ? r.target : 0; let j = xs[k].findIndex((x) => x > lim + 0.05); if (j < 0) j = xs[k].length; return { x: xs[k].slice(0, j), y: r.res.curve.v.slice(0, j) }; });
    const ymax = Math.ceil(Math.max(...shown.map(({ r }) => r.res.top.speed)) + 0.8);
    const x0 = vault ? Math.max(Math.floor(Math.min(...xs.map((x) => x[0]))), -30) : 0;
    h += lcSlot({ aria: "Speed curves of each athlete's best run", h: 230, x0, x1: vault ? 0 : end || Math.ceil(Math.max(...xs.map((x) => x[x.length - 1]))), y0: 0, y1: ymax,
      xTitle: vault ? "Distance before takeoff (m)" : "Distance (m)", yUnit: "m/s", xfmt: (t) => `${Math.abs(t)}`, vlines: vault ? [{ x: -5, label: "5 m out" }] : [],
      fmtPill: (x, vals) => vals.map((v, k) => (isFinite(v) ? `${esc(firstName(shown[k].r.athleteId))} ${f2(v)}` : "")).filter(Boolean).join("  ") + ` · ${f1(Math.abs(x))} m`,
      series: cut.map((c, k) => ({ x: c.x, y: c.y, color: ANC[shown[k].i], w: 2.4 })) });
    h += `<div class="small muted">Each athlete's best run (by ${km.label}). Drag across to read their speeds at the same spot.</div>`;
  }
  // overlaid trend: best key metric per day, one line per athlete (only once there's more than one day to show)
  const series = [], dots = [], allDays = new Set();
  const per = sel.map((id) => { const by = bestPerDay(runs.filter((r) => r.athleteId === id && testKey(r) === test), km.pick); Object.keys(by).forEach((d) => allDays.add(d)); return by; });
  const dl = [...allDays].sort();
  if (dl.length > 1) {
    const t0 = new Date(dl[0]).getTime(), dx = (d) => (new Date(d).getTime() - t0) / 864e5; let lo = 1e9, hi = -1e9;
    per.forEach((by, i) => { const ds = Object.keys(by).sort(), X = ds.map(dx), Y = ds.map((d) => by[d].v); Y.forEach((y) => { lo = Math.min(lo, y); hi = Math.max(hi, y); });
      series.push({ x: X, y: Y, color: ANC[i], w: 2.4 }); X.forEach((x, j) => dots.push({ x, y: Y[j], color: ANC[i], attrs: `data-act="open-run" data-id="${by[ds[j]].r.id}" style="cursor:pointer"` })); });
    const pad = Math.max(0.08, (hi - lo) * 0.25), xEnd = Math.max(1, dx(dl[dl.length - 1]));
    h += lcSlot({ aria: "Athletes compared over time", h: 210, x0: -0.5, x1: xEnd + 0.5, y0: lo - pad, y1: hi + pad, yUnit: "m/s", yfmt: (t) => t.toFixed(2),
      xt: dl.length > 1 ? [0, xEnd] : [0], xfmt: (t) => dayLabel(t === 0 ? dl[0] : dl[dl.length - 1]), series, dots });
    h += `<div class="small muted">Best ${km.label} per day for each athlete. Tap a dot to open that run.</div>`;
  }
  // ranking with bars
  h += `<div class="rank">${rows.map((o, i) => `<div class="rk" data-act="an-ath" data-id="${o.a.id}"><span class="n">${i + 1}</span><span class="nm">${esc(o.a.name)}<small>${o.n} run${o.n > 1 ? "s" : ""} · last ${dayLabel(dayKey(o.last.ts))}</small></span>
      <span class="bar"><i style="width:${bw(o.best.v).toFixed(1)}%"></i></span><b>${f2(o.best.v)}</b></div>`).join("")}</div>`;
  // table
  const th = isSprint ? `<th>Athlete</th><th>Top<small>m/s</small></th><th>Fly 10<small>s</small></th><th>${test.split("-")[1]} m<small>s</small></th><th>Gap<small>m/s</small></th>` : `<th>Athlete</th><th>Best<small>m/s</small></th><th>Avg<small>m/s</small></th><th>Carry</th><th>Lefts</th><th>TO ±</th>`;
  const tds = (o) => isSprint
    ? `<td>${esc(o.a.name)}</td><td><b>${f2(o.best.v)}</b></td><td>${o.fly ? f2(o.fly.v) : "—"}</td><td>${o.time ? f2(o.time.v) : "—"}</td><td>${o.best.v === top ? "—" : signed(o.best.v - top)}</td>`
    : `<td>${esc(o.a.name)}</td><td><b>${f2(o.best.v)}</b></td><td>${o.avg ? f2(o.avg) : "—"}</td><td>${o.carry ? Math.round(o.carry * 100) + "%" : "—"}</td><td>${o.lefts || "—"}</td><td>${o.toSd != null ? spreadFt(o.toSd) : "—"}</td>`;
  h += `<div class="tw" style="margin-top:10px"><table class="cmpt"><thead><tr>${th}</tr></thead><tbody>${rows.map((o) => `<tr data-act="an-ath" data-id="${o.a.id}" style="cursor:pointer">${tds(o)}</tr>`).join("")}</tbody></table></div>`;
  // the main differences, written out
  const notes = [], a0 = rows[0], a1 = rows[1];
  notes.push(`${esc(a0.a.name)} has the best ${km.label}: ${f2(a0.best.v)} m/s, ${f2(a0.best.v - a1.best.v)} m/s ahead of ${esc(a1.a.name)}.`);
  if (isSprint) { const f = rows.filter((o) => o.fly).sort((x, y) => x.fly.v - y.fly.v); if (f.length > 1) notes.push(`Fastest flying 10 m: ${esc(f[0].a.name)} (${f2(f[0].fly.v)} s).`); }
  else {
    const c = rows.filter((o) => o.carry).sort((x, y) => y.carry - x.carry);
    if (c.length > 1) notes.push(`${esc(c[0].a.name)} carries the most sprint speed to the plant (${Math.round(c[0].carry * 100)}%); ${esc(c[c.length - 1].a.name)} the least (${Math.round(c[c.length - 1].carry * 100)}%).`);
    const t = rows.filter((o) => o.toSd != null).sort((x, y) => x.toSd - y.toSd);
    if (t.length > 1) notes.push(`Most consistent takeoff: ${esc(t[0].a.name)} (±${spreadFt(t[0].toSd).slice(1)}).`);
  }
  h += `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul><div class="small muted">Tap an athlete to see their numbers above.</div>
    <button class="btn" style="width:100%;margin-top:10px" data-act="cmp-report" ${sel.length > 1 ? "" : "disabled"}>Print comparison report (PDF)</button></div>`;
  return h;
}

function analyticsHTML() {
  if (!athletes.length) return `<h1>Analytics</h1><div class="card empty">Add an athlete and save some runs to see trends.</div>`;
  if (!anState.athleteId || !athletes.find((a) => a.id === anState.athleteId)) anState.athleteId = settings.lastAthlete && athletes.find((a) => a.id === settings.lastAthlete) ? settings.lastAthlete : athletes[0].id;
  const mine = runs.filter((r) => r.athleteId === anState.athleteId), myJumps = jumps.filter((j) => j.athleteId === anState.athleteId);
  const anReady = runs.some((r) => r.athleteId === anState.athleteId);
  let h = `<div class="between" style="align-items:center"><h1>Analytics</h1>${anReady ? `<button class="btn sm" data-act="an-report" aria-label="Print report">Print report</button>` : ""}</div><div class="chips" style="margin-bottom:12px">${athletes.map((a) => `<button class="chip" data-act="an-ath" data-id="${a.id}" aria-pressed="${a.id === anState.athleteId}">${esc(a.name)}</button>`).join("")}</div>`;
  if (!mine.length && !myJumps.length) return h + `<div class="card empty">No runs or jumps for ${esc(athleteById(anState.athleteId).name)} yet.</div>`;
  const tests = [...new Set(mine.map(testKey))].sort(); if (myJumps.length) tests.push("jump");
  if (!anState.test || !tests.includes(anState.test)) anState.test = tests[0];
  h += `<div class="chips" style="margin-bottom:12px">${tests.map((t) => `<button class="chip" data-act="an-test" data-v="${t}" aria-pressed="${t === anState.test}">${t === "jump" ? "Vertical jump" : testShort(t)}</button>`).join("")}</div>`;
  if (anState.test === "jump") return h + jumpAnalyticsHTML(myJumps);
  const tr = mine.filter((r) => testKey(r) === anState.test);
  const isSprint = anState.test.startsWith("sprint");
  // best per day
  const byDay = {}; for (const r of tr) { const v = headline(r).value; if (v == null || !isFinite(v)) continue; const k = dayKey(r.ts); if (!byDay[k] || (isSprint ? v < byDay[k].v : v > byDay[k].v)) byDay[k] = { v, r }; }
  const days = Object.keys(byDay).sort();
  if (days.length) {
    const t0 = new Date(days[0]).getTime(), X = days.map((d) => (new Date(d).getTime() - t0) / 864e5), Y = days.map((d) => byDay[d].v);
    const lo = Math.min(...Y), hi = Math.max(...Y), padY = Math.max(0.05, (hi - lo) * 0.25);
    const x1 = Math.max(1, X[X.length - 1]);
    const chart = lcSlot({ aria: "Best per day", h: 230, x0: -0.5, x1: x1 + 0.5, y0: lo - padY, y1: hi + padY, yUnit: isSprint ? "s" : "m/s",
      yfmt: (t) => t.toFixed(2), xt: X.length > 1 ? [X[0], X[X.length - 1]] : [X[0]], xfmt: (t) => dayLabel(days[X.indexOf(t)] || days[0]),
      series: [{ x: X, y: Y, color: "var(--purple)", w: 2.4, fill: !isSprint }],
      dots: X.map((x, i) => ({ x, y: Y[i], attrs: `data-act="open-session" data-id="${days[i]}" style="cursor:pointer"` })) });
    h += `<div class="card"><div class="between"><div class="label">Best ${isSprint ? "time" : "last 5 m"} per day</div><div class="small muted">${isSprint ? "lower is better" : "higher is better"}</div></div>${chart}<div class="small muted">Tap a dot to open that session.</div></div>`;
  }
  // records
  h += `<div class="card"><div class="label" style="margin-bottom:6px">Personal records · ${testName(anState.test)}</div><div class="list">`;
  const rec = (label, pick, better, fmt) => {
    const best = bestOf(tr, pick, better);
    return best ? `<div class="item" data-act="open-run" data-id="${best.r.id}"><div>${label}<div class="small muted">${dayLabel(dayKey(best.r.ts))}</div></div><div class="r">${fmt(best.v)}</div></div>` : "";
  };
  if (isSprint) {
    h += rec("Time", (r) => r.res.time, "low", (v) => `${f2(v)} s`) + rec("Top speed", (r) => r.res.top.speed, "high", (v) => `${f2(v)} m/s`) + rec("Flying 10 m", (r) => r.res.fly10 && r.res.fly10.time, "low", (v) => `${f2(v)} s`);
  } else {
    h += rec("Last 5 m", (r) => r.res.last5 && r.res.last5.speed, "high", (v) => `${f2(v)} m/s`) + rec("Top speed", (r) => r.res.top.speed, "high", (v) => `${f2(v)} m/s`);
  }
  { const kg = tr.some((r) => r.res.fv && r.res.fv.P0abs); h += rec("Power", (r) => r.res.fv && (kg ? r.res.fv.P0abs : r.res.fv.P0), "high", (v) => (kg ? `${Math.round(v)} W` : `${f1(v)} W/kg`)); }
  h += `</div></div>`;
  // what matters for this test
  h += isSprint ? sprintProfileCard(mine, tr) : vaultProfileCard(tr);
  // fastest at each distance (all sprints)
  if (isSprint) {
    const sprints = mine.filter((r) => r.mode === "sprint");
    let rows = "";
    for (const x of [5, 10, 15, 20, 25, 30, 40, 50, 60]) {
      let bc = null, bs = null;
      for (const r of sprints) {
        if (r.target < x) continue;
        const tc = x === r.target ? r.res.time : interpAt(r.res.curve.d, r.res.curve.t, x);
        if (isFinite(tc) && (!bc || tc < bc.v)) bc = { v: tc, r };
        const sp = r.res.splits.find((s) => s.to === x); if (sp && (!bs || sp.time < bs.v)) bs = { v: sp.time, r };
      }
      if (bc) rows += `<tr data-act="open-run" data-id="${bc.r.id}" style="cursor:pointer"><td>${x} m</td><td>${f2(bc.v)} s</td><td>${bs ? `${f2(bs.v)} s` : "—"}</td><td class="muted">${dayLabel(dayKey(bc.r.ts))}</td></tr>`;
    }
    if (rows) h += `<div class="card tw"><div class="label" style="margin-bottom:6px">Fastest at each distance · all sprints</div><table><thead><tr><th>Distance</th><th>From start</th><th>5 m split</th><th>When</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  h += compareAthletesCard(anState.test);
  h += `<h2>Runs</h2>` + compareBar() + `<div class="card list">${tr.slice(0, 30).map((r) => runRow(r, true)).join("")}</div>`;
  return h;
}

// Analytics · Vertical jump: best per day (both heights), records, everyone's bests, every jump
function jumpAnalyticsHTML(mine) {
  const cm = (m) => (m * 100).toFixed(1);
  const byDay = {}; for (const j of mine) { const k = dayKey(j.ts); const d = byDay[k] || (byDay[k] = { h: 0, s: 0, n: 0 }); d.h = Math.max(d.h, j.h); d.s = Math.max(d.s, j.hStand || 0); d.n++; }
  const days = Object.keys(byDay).sort();
  let h = "";
  if (days.length) {
    const t0 = new Date(days[0]).getTime(), X = days.map((d) => (new Date(d).getTime() - t0) / 864e5);
    const Y = days.map((d) => byDay[d].h * 100), S = days.map((d) => (byDay[d].s ? byDay[d].s * 100 : null));
    const all = Y.concat(S.filter((v) => v != null)), lo = Math.min(...all), hi = Math.max(...all), pad = Math.max(2, (hi - lo) * 0.2), x1 = Math.max(1, X[X.length - 1]);
    const sx = X.filter((_, i) => S[i] != null), sy = S.filter((v) => v != null);
    const chart = lcSlot({ aria: "Best jump per day", h: 220, x0: -0.5, x1: x1 + 0.5, y0: Math.max(0, lo - pad), y1: hi + pad, yUnit: "cm",
      yfmt: (t) => t.toFixed(0), xt: X.length > 1 ? [X[0], X[X.length - 1]] : [X[0]], xfmt: (t) => dayLabel(days[X.indexOf(t)] || days[0]),
      series: [{ x: X, y: Y, color: "var(--purple)", w: 2.4, fill: true }].concat(sy.length ? [{ x: sx, y: sy, color: "var(--pink)", w: 2, dash: "5 4" }] : []),
      dots: X.map((x, i) => ({ x, y: Y[i] })) });
    h += `<div class="card"><div class="between"><div class="label">Best jump per day</div><div class="small muted"><b style="color:var(--purple)">━</b> takeoff · <b style="color:var(--pink)">┅</b> standing</div></div>${chart}</div>`;
  }
  const best = (k) => mine.reduce((b, j) => (j[k] != null && (!b || j[k] > b[k]) ? j : b), null), bh = best("h"), bs = best("hStand");
  h += `<div class="card"><div class="label" style="margin-bottom:6px">Personal records · Vertical jump</div><div class="list">
    ${bh ? `<div class="item"><div>Takeoff to peak<div class="small muted">${dayLabel(dayKey(bh.ts))}${bh.sim ? " · sim" : ""}</div></div><div class="r"><b>${cm(bh.h)} cm</b> <span class="small muted">${(bh.h / 0.0254).toFixed(1)} in</span></div></div>` : ""}
    ${bs ? `<div class="item"><div>Standing to peak<div class="small muted">${dayLabel(dayKey(bs.ts))}${bs.sim ? " · sim" : ""}</div></div><div class="r"><b>${cm(bs.hStand)} cm</b> <span class="small muted">${(bs.hStand / 0.0254).toFixed(1)} in</span></div></div>` : ""}
    <div class="item"><div>Jumps</div><div class="r">${mine.length} over ${days.length} day${days.length === 1 ? "" : "s"}</div></div></div></div>`;
  // everyone's best, as bars
  const tops = athletes.map((a) => ({ a, j: jumps.filter((j) => j.athleteId === a.id).reduce((b, j) => (!b || j.h > b.h ? j : b), null) })).filter((x) => x.j).sort((x, y) => y.j.h - x.j.h);
  if (tops.length > 1) {
    const mx = tops[0].j.h;
    h += `<div class="card"><div class="label" style="margin-bottom:8px">Everyone's best · takeoff to peak</div>${tops.map(({ a, j }) => `<div class="jrank${a.id === anState.athleteId ? " me" : ""}" data-act="an-ath" data-id="${a.id}"><span class="nm">${esc(a.name)}</span><span class="bar"><b style="width:${((100 * j.h) / mx).toFixed(1)}%"></b></span><span class="v">${cm(j.h)}</span></div>`).join("")}</div>`;
  }
  h += `<h2>Jumps</h2><div class="card list">${mine.slice(0, 60).map((j) => `<div class="item"><div><b>${dayLabel(dayKey(j.ts))}</b> <span class="small muted">${timeLabel(j.ts)}${j.sim ? " · sim" : ""}</span></div><div class="r"><b>${cm(j.h)}</b>${j.hStand != null ? ` <span class="small muted">/ ${cm(j.hStand)}</span>` : ""} cm <button class="btn sm ghost" data-act="jump-del" data-id="${j.id}" aria-label="Delete">✕</button></div></div>`).join("")}</div>
    <div class="small muted" style="text-align:center">takeoff to peak / standing to peak</div>`;
  return h;
}

function settingsHTML() {
  const si = Store.info(), mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);
  const where = si.mode === "db" ? `in the phone's database${si.usage != null ? ` (${mb(si.usage)} used${si.quota ? ` of ${mb(si.quota)} available` : ""})` : ""}` : "in the phone's basic storage (the database didn't open: reload the app)";
  const kept = si.persisted ? "Protected: the phone won't clear it on its own."
    : standalone() ? "Saved in the home-screen app, which the phone doesn't clear on its own."
    : "Open the app from its home-screen icon so the phone never clears it on its own. Runs saved in a browser tab can be cleared after a week without visiting.";
  let h = `<h1>Settings</h1>`;
  h += `<h2>Athletes</h2><div class="card list">${athletes.length ? athletes.map((a) => `<div class="item" data-act="ath-edit" data-id="${a.id}"><div><b>${esc(a.name)}</b><div class="small muted">${a.kg ? (settings.weightUnit === "lb" ? `${Math.round(a.kg / 0.453592)} lb` : `${a.kg.toFixed(1)} kg`) : "No body weight"}</div></div><div class="r">›</div></div>`).join("") : `<div class="muted">No athletes yet.</div>`}</div><button class="btn" data-act="ath-new">Add athlete</button>`;
  h += `<h2>Sound and Hands Free</h2>${chimeCard()}<div class="card between" style="margin-top:6px"><div><b>Hands Free Mode</b><div class="small muted">Save every run and get ready for the next athlete by itself.</div></div><label class="switch"><input type="checkbox" id="soloSw" ${settings.solo ? "checked" : ""}><span></span></label></div>${voiceCard()}
    <div class="card between"><div><b>Body weight in</b></div><div class="seg" style="width:140px"><button data-act="unit" data-v="lb" aria-pressed="${settings.weightUnit === "lb"}">lb</button><button data-act="unit" data-v="kg" aria-pressed="${settings.weightUnit === "kg"}">kg</button></div></div>
    <div class="card between"><div><b>Look</b></div><div class="seg" style="width:200px"><button data-act="theme" data-v="" aria-pressed="${!settings.theme}">Auto</button><button data-act="theme" data-v="dark" aria-pressed="${settings.theme === "dark"}">Dark</button><button data-act="theme" data-v="light" aria-pressed="${settings.theme === "light"}">Light</button></div></div>`;
  h += `<h2>Waist pods</h2>${podCardHTML()}`;
  h += `<h2>Tripod setup</h2><div class="card between"><div><b>Level &amp; aim</b><div class="small muted">Digital level, where the beam lands down the runway, and the bump alarm.${sensor.connected && sensor.bump ? ` <b style="color:var(--warn)">The tripod moved.</b>` : ""}</div></div><button class="btn" data-act="go-level">Open</button></div>${setupGuide("runway100")}${setupGuide("runway150")}`;
  h += `<h2>Your data</h2><div class="card"><div class="small muted" style="margin-bottom:10px">${WEB_COPY ? "This copy of the app opens with no connection at all." : "This is the sensor's page. Send runs to your home-screen app after each session."} ${runs.length} runs saved ${where}. ${kept} Export a backup now and then, and to move runs to another phone.</div>
    <div class="row"><button class="btn" data-act="export">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json,.json" class="hidden"></label></div></div>
    ${secureCardHTML()}${devicesCardHTML()}${firmwareCardHTML()}${WEB_COPY || ON_SECURE ? getCardHTML() : ""}${ON_SECURE ? "" : sendCardHTML(false)}
    <div class="card"><div class="small muted" style="margin-bottom:10px">Try the app without the sensor: adds a demo athlete with two weeks of simulated sprints and jumps. Simulated runs are marked and never sent.</div><div class="row"><button class="btn" data-act="demo-data">Add demo data</button>${runs.some((r) => r.sim) || jumps.some((j) => j.sim) ? `<button class="btn" data-act="del-sim">Delete simulated runs</button>` : ""}<button class="btn danger" data-act="clear-all">Delete all runs</button></div></div>`;
  h += `<p class="small muted" style="text-align:center;margin-top:20px">PAYTON'S LiDAR SENSOR · designed by Payton Pitts</p>`;
  return h;
}
const wLabel = (w) => (w !== "" && w != null ? `<b>${w}</b> ${settings.weightUnit}` : `<span class="muted">Set body weight</span>`) + `<span class="wpick-ch">›</span>`;
// Every number in the app is picked on a sliding wheel in a sheet from the bottom.
//   numWheel({ title, units: { key: { min, max, step, def, label } }, unit, value, convert(v, from, to), clear, onDone(value, unit) })
//   value "" means none (only with clear: a "No …" button)
function numWheel(o) {
  let unit = o.unit, keys = Object.keys(o.units);
  const sh = document.createElement("div"); sh.className = "wsheet";
  sh.innerHTML = `<div class="wsheet-bg" data-w="cancel"></div><div class="wsheet-card" role="dialog" aria-label="${esc(o.title || "Pick a number")}">
    ${o.title ? `<div class="wtitle">${esc(o.title)}</div>` : ""}
    ${keys.length > 1 ? `<div class="seg wseg">${keys.map((k) => `<button data-w="u:${k}">${esc(o.units[k].label || k)}</button>`).join("")}</div>` : ""}
    <div class="wread"><b id="wVal"></b> <span id="wUnit"></span></div>
    <div class="wheel-box"><div class="wheel" id="wheel" tabindex="0"></div></div>
    <div class="row">${o.clear ? `<button class="btn ghost" data-w="clear">${esc(o.clear)}</button>` : `<button class="btn ghost" data-w="cancel">Cancel</button>`}<button class="btn primary" data-w="done">Done</button></div></div>`;
  document.body.appendChild(sh);
  const wh = $("#wheel", sh), H = 44, U = () => o.units[unit];
  const dec = () => (U().step < 1 ? (String(U().step).split(".")[1] || "").length : 0);
  const fmt = (v) => v.toFixed(dec());
  const cur = () => { const W = U(), i = Math.round(wh.scrollTop / H); return Math.min(W.max, W.min + i * W.step); };
  const show = () => { $("#wVal", sh).textContent = fmt(cur()); $("#wUnit", sh).textContent = U().label || unit; [...wh.children].forEach((c, i) => c.classList.toggle("on", i === Math.round(wh.scrollTop / H))); };
  const build = (v) => {
    const W = U(), n = Math.round((W.max - W.min) / W.step) + 1;
    let h = ""; for (let i = 0; i < n; i++) h += `<div class="wi">${fmt(W.min + i * W.step)}</div>`;
    wh.innerHTML = h;
    sh.querySelectorAll(".wseg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.w === "u:" + unit));
    const t = isFinite(v) ? Math.min(W.max, Math.max(W.min, v)) : W.def;
    wh.scrollTop = Math.round((t - W.min) / W.step) * H; show();
  };
  wh.addEventListener("scroll", show, { passive: true });
  wh.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); wh.scrollTop += e.key === "ArrowUp" ? -H : H; } if (e.key === "Enter") sh.querySelector('[data-w="done"]').click(); });
  const close = () => sh.remove();
  sh.addEventListener("click", (e) => {
    const k = e.target.closest("[data-w]"); if (!k) return; const w = k.dataset.w;
    if (w.startsWith("u:")) { const to = w.slice(2); if (to === unit) return; const v = cur(), from = unit; unit = to; build(o.convert ? o.convert(v, from, to) : v); }
    else if (w === "cancel") close();
    else { const v = w === "done" ? fmt(cur()) : ""; close(); o.onDone(v, unit); }
  });
  build(parseFloat(o.value));
  requestAnimationFrame(() => { sh.classList.add("on"); wh.focus({ preventScroll: true }); });
}
// body weight: lb / kg above the wheel (switching changes the app's unit too, so the two never mix)
function wheelOpen() {
  const inp = $("#athW"); if (!inp) return;
  numWheel({ title: "Body weight", unit: settings.weightUnit, value: inp.value, clear: "No weight",
    units: { lb: { min: 50, max: 400, step: 1, def: 165, label: "lb" }, kg: { min: 25, max: 180, step: 0.5, def: 75, label: "kg" } },
    convert: (v, from, to) => (to === "kg" ? v * 0.453592 : v / 0.453592),
    onDone: (v, unit) => { if (unit !== settings.weightUnit) { settings.weightUnit = unit; saveSettings(); } inp.value = v; const b = $("#athWBtn"); if (b) b.innerHTML = wLabel(v); } });
}
// any other number box: shown as a button that opens the wheel. The box itself stays (hidden), so the code that
// reads it or listens to it doesn't change. Range from data-min / data-max / data-step, unit from data-unit,
// title from its label; data-then: an action to run after Done (e.g. the custom distance's Next).
function wheelify(root = document) {
  root.querySelectorAll('input[type="number"]:not([data-wheeled])').forEach((inp) => {
    inp.dataset.wheeled = "1"; inp.hidden = true;
    const lab = inp.id && root.querySelector(`label[for="${inp.id}"]`), unit = inp.dataset.unit || "";
    const title = inp.dataset.title || (lab ? lab.textContent.replace(/\s*\(.*?\)\s*$/, "") : inp.placeholder || "");
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "wpick";
    const paint = () => { btn.innerHTML = (inp.value !== "" ? `<b>${esc(inp.value)}</b> ${esc(unit)}` : `<span class="muted">${esc(inp.placeholder || "Set")}</span>`) + `<span class="wpick-ch">›</span>`; };
    paint();
    if (inp.style.flex) btn.style.flex = inp.style.flex;
    inp.after(btn);
    if (lab) lab.htmlFor = "";
    btn.onclick = () => {
      const min = +inp.dataset.min || +inp.min || 0, max = +inp.dataset.max || +inp.max || 100, step = +inp.dataset.step || +inp.step || 1;
      numWheel({ title, unit: "u", value: inp.value, units: { u: { min, max, step, def: +inp.dataset.def || (min + max) / 2, label: unit } },
        onDone: (v) => {
          inp.value = v; paint();
          inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
          const then = inp.dataset.then && document.querySelector(`[data-act="${inp.dataset.then}"]`); if (then) then.click();
        } });
    };
  });
}
function athleteFormHTML(id) {
  const a = id ? athletes.find((x) => x.id === id) : { name: "", kg: null };
  const w = a.kg ? (settings.weightUnit === "lb" ? Math.round(a.kg / 0.453592) : a.kg.toFixed(1)) : "";
  return `<button class="btn sm" data-act="back">‹ Back</button><h1 style="margin-top:10px">${id ? "Edit athlete" : "Add athlete"}</h1>
    <div class="card"><div class="field"><label for="athName">Name</label><input type="text" id="athName" value="${esc(a.name)}" autocomplete="off"></div>
    <div class="field"><label for="athWBtn">Body weight · optional, used for force and power</label><input type="hidden" id="athW" value="${w}">
      <button type="button" class="wpick" id="athWBtn" data-act="wheel-open">${wLabel(w)}</button></div>
    <div class="row"><button class="btn primary" data-act="ath-save" data-id="${id || ""}">Save</button>${id ? `<button class="btn danger" data-act="ath-del" data-id="${id}">Delete athlete</button>` : ""}</div></div>`;
}

// ---------------- render ----------------
let backStack = [];
function render() {
  const app = $("#app");
  const html = view === "home" ? homeHTML() : view === "new" ? newHTML() : view === "run" ? runHTML(viewArg) : view === "sessions" ? sessionsHTML() : view === "session" ? sessionHTML(viewArg)
    : view === "compare" ? compareHTML() : view === "analytics" ? analyticsHTML() : view === "settings" ? settingsHTML() : view === "athlete" ? athleteFormHTML(viewArg) : view === "level" ? levelHTML() : view === "jump" ? jumpHTML() : view === "podcal" ? podCalHTML(viewArg) : homeHTML();
  app.innerHTML = html;
  const runOn = view === "new" && ["waiting", "ready", "recording", "processing", "review"].includes(cap.phase);
  document.documentElement.classList.toggle("run-on", runOn);
  // each run screen opens at the top, so the status strip and the name are in view
  const ph = view + ":" + cap.phase; if (runOn && ph !== render.last) window.scrollTo(0, 0); render.last = ph;
  const lu = $("#lineup"); if (lu) rosterDrag(lu, lineupDrop, luDrag, "id");
  wheelify();
  document.querySelectorAll("select[data-pod]").forEach((s) => (s.onchange = () => { const w = settings.podWho || (settings.podWho = {}); if (s.value) w[s.dataset.pod] = s.value; else delete w[s.dataset.pod]; saveSettings(); render(); }));
  lcDrawAll(); liveDraw(); LC = Object.fromEntries(Object.entries(LC).filter(([k]) => document.querySelector(`[data-lc="${k}"]`)));
  const tab = { home: "home", new: "new", run: "sessions", sessions: "sessions", session: "sessions", compare: "analytics", analytics: "analytics", settings: "settings", athlete: "settings", level: "settings", jump: "new", podcal: "settings" }[view];
  document.querySelectorAll(".tabbar [data-go]").forEach((b) => (b.dataset.go === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  const sw = $("#soloSw"); if (sw) sw.onchange = () => { settings.solo = sw.checked; saveSettings(); if (sw.checked) unlockAudio(); };
  const vs = $("#voiceSw"); if (vs) vs.onchange = () => { settings.voice = vs.checked; saveSettings(); unlockAudio(); if (vs.checked) say("Voice on"); };
  const ct = $("#customTarget"); if (ct) ct.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); const b = document.querySelector('[data-act="cap-target-custom"]'); if (b) b.click(); } };
  const imp = $("#importFile"); if (imp) imp.onchange = () => importBackup(imp.files[0]);
  const fwf = $("#fwFile"); if (fwf) fwf.onchange = () => updateFirmware(fwf.files[0]);
  const sf = $("#syncFile"); if (sf) sf.onchange = () => importBackup(sf.files[0]);
  if (view === "level") lvBind();
  const pr = $("#podRest"); if (pr) pr.onchange = () => { const v = parseFloat(pr.value); if (v > 0) { settings.podRest = lvImperial() ? v * 0.0254 : v / 100; saveSettings(); } };
  const pf = $("#podFwFile"); if (pf) pf.onchange = () => podFirmware(pf.files[0]);
  bumpBar();
}
function nav(v, arg) { backStack.push([view, viewArg]); go(v, arg); }
function back() { const p = backStack.pop(); if (p) go(p[0], p[1], true); else go("home"); }

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (g) { backStack = []; if (g.dataset.go === "new") unlockAudio(); go(g.dataset.go); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  if (act === "lu-tap") { if (!e.target.closest(".d-grip") && !luDrag.dragging) lineupTap(id); return; }
  if (act === "cmp-toggle") { e.stopPropagation(); toggleCompare(id); return; }
  switch (act) {
    case "back": back(); break;
    case "lc-detail": lcDetail = !lcDetail; document.querySelectorAll('[data-act="lc-detail"]').forEach((b) => b.setAttribute("aria-pressed", lcDetail)); lcDrawAll(); break;
    case "open-run": nav("run", id); break;
    case "open-session": nav("session", id); break;
    case "cmp-clear": compareSel = []; render(); break;
    case "pick-ath": { const i = cap.queue.indexOf(id); if (i >= 0) cap.queue.splice(i, 1); else cap.queue.push(id); cap.athleteId = cap.queue[0] || null; settings.lastQueue = cap.queue.slice(); settings.lastAthlete = cap.athleteId; saveSettings(); render(); break; }
    case "cap-up": cap.athleteId = id; render(); break;
    case "cap-end": stopNow(); cap.phase = "summary"; render(); window.scrollTo(0, 0); break;
    case "cap-close": cap.session = null; saveSession(); cap.phase = "setup"; go("home"); break;
    case "cmp-report": { const t = anState.test, ids = (anState.cmp || []).filter((x) => runs.some((r) => r.athleteId === x && testKey(r) === t)); if (ids.length > 1) openCompareReport(t, ids); else toast("Pick at least two athletes to compare."); break; }
    case "an-report": if (anState.athleteId && anState.test) openAthleteReport(anState.athleteId, anState.test); break;
    case "sess-print": {
      const ks = [...new Set(runs.map((r) => dayKey(r.ts)))];
      if (ks.length === 1 && !sessPick) { openSessionReport(runs.filter((r) => dayKey(r.ts) === ks[0]).map((r) => r.id)); break; }
      sessPick = !sessPick; render(); break;
    }
    case "day-report": sessPick = false; openSessionReport(runs.filter((r) => dayKey(r.ts) === id).map((r) => r.id)); render(); break;
    case "cert-copy": copySetupLink(); break;
    case "go-level": e.preventDefault(); nav("level"); break;
    case "go-jump": nav("jump"); break;
    case "go-podcal": pod.calMsg = ""; nav("podcal", id); break;
    case "pod-cal": pod.calMsg = "Measuring… keep it still."; render(); podCmd({ do: "cal", side: v, id }); break;
    case "pod-uncal": podCmd({ do: "uncal", id }); break;
    case "pod-send": podCmd({ do: "send", id }).then((j) => j && j.online && toast(`Asked the ${podName(id).toLowerCase()} for its last 14 s.`)); break;
    case "pod-color": { const c = settings.podColors || (settings.podColors = {}); const other = Object.keys(c).find((k) => k !== id && c[k] === v); if (other) c[other] = c[id]; c[id] = v; saveSettings(); render(); break; }
    case "jump-sim": jumpSim(); break;
    case "jump-next": pod.show = null; render(); jumpScreen.at = 0; jumpScreen(); break;
    case "jump-each": settings.jumpEach = +v; pod.turn = 0; saveSettings(); render(); break;
    case "jump-del": jumps = jumps.filter((j) => j.id !== id); saveJumps(); render(); break;
    case "lv-do": lvDo(v); break;
    case "lv-at": settings.lvAt = +v; saveSettings(); render(); break;
    case "about-show": fetch("/about", { method: "POST", cache: "no-store" }).then(() => toast("About is on the sensor's screen for 20 s."), () => toast("Couldn't reach the sensor.")); break;
    case "cert-check": certFetch().then((ok) => { if (!ok) toast("No internet right now: turn Wi-Fi off (cellular on) and try again."); else if (!certSaved()) toast("Not ready yet. It takes about 3 minutes after you commit."); render(); }); break;
    case "session-report": if (cap.session) openSessionReport(cap.session.ids); break;
    case "cap-mode": cap.mode = v; settings.lastMode = v; saveSettings(); cap.step = "distance"; cap.error = null; render(); window.scrollTo(0, 0); break;
    case "cap-target": cap.target = +v; settings.lastTarget = +v; saveSettings(); cap.step = "who"; render(); window.scrollTo(0, 0); break;
    case "cap-target-custom": { const ct = $("#customTarget"), n = ct ? parseInt(ct.value, 10) : NaN; if (n >= 5 && n <= 80) { cap.target = n; settings.lastTarget = n; saveSettings(); cap.step = "who"; render(); window.scrollTo(0, 0); } else toast("Pick a distance, or type one from 5 to 80 m."); break; }
    case "wiz-next": cap.step = WIZ[Math.min(WIZ.length - 1, WIZ.indexOf(cap.step) + 1)]; render(); window.scrollTo(0, 0); break;
    case "wiz-back": cap.step = WIZ[Math.max(0, WIZ.indexOf(cap.step) - 1)]; cap.error = null; render(); window.scrollTo(0, 0); break;
    case "wiz-edit": cap.step = "event"; render(); window.scrollTo(0, 0); break;
    case "cap-setup": cap.setup = v; settings.lastSetup = v; saveSettings(); render(); break;
    case "cap-ready": unlockAudio(); cap.lastRun = null; if (!cap.queue.includes(cap.athleteId)) cap.athleteId = cap.queue[0]; if (!cap.session) { cap.session = { start: Date.now(), ids: [] }; saveSession(); } arm(); break;
    case "cap-cancel": stopNow(); cap.phase = "setup"; cap.sim = null; render(); break;
    case "cap-stop": if (cap.sim) { cap.sim = null; arm(); break; } stopNow().then(() => { if (cap.phase === "recording") download(); else arm(); }); break;
    case "cap-sim": simulateRun(); break;
    case "cap-sim-in": toReady(); break;
    case "disp-show": disp.dismissed = false; startDisplay(true); break;
    case "disp-claim": fetch(`/claim?dev=${DEVICE_ID}`, { cache: "no-store" }).then(() => { sensor.role = "control"; toast("This device is the controller now."); render(); }).catch(() => toast("Couldn't reach the sensor.")); break;
    case "cap-armnow": if (sensor.connected) arm(true); else toReady(); break;
    case "cap-rewait": arm(); break;
    case "chime-kind": settings.chime = v; saveSettings(); unlockAudio(); chime(); render(); break;
    case "chime-test": unlockAudio(); chime(); break;
    case "cap-save": keepRun(cap.run); cap.lastRun = cap.run; cap.lastSaved = true; toast("Saved"); arm(); break;
    case "cap-discard": toast("Thrown away"); arm(); break;
    case "cap-again": arm(); break;
    case "cap-done": stopNow(); cap.phase = "summary"; render(); break;
    case "open-report": openReport(id || (cap.run && cap.run.id)); break;
    case "del-run": if (el.dataset.confirm === "1") { runs = runs.filter((r) => r.id !== id); compareSel = compareSel.filter((x) => x !== id); saveRuns(); toast("Run deleted"); back(); } else { el.dataset.confirm = "1"; el.textContent = "Tap again to delete"; } break;
    case "an-ath": anState.athleteId = id; if (!(anState.test === "jump" ? jumps.some((j) => j.athleteId === id) : runs.some((r) => r.athleteId === id && testKey(r) === anState.test))) anState.test = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); break;
    case "mid-out": settings.midOut = +v; saveSettings(); render(); break;
    case "an-test": anState.test = v; anState.cmp = null; render(); break;
    case "an-cmp": { const s = anState.cmp || [], i = s.indexOf(id); if (i >= 0) { if (s.length > 1) s.splice(i, 1); } else if (s.length >= 4) toast("Up to four athletes on the chart."); else s.push(id); anState.cmp = s; render(); break; }
    case "ath-new": nav("athlete", null); break;
    case "ath-edit": nav("athlete", id); break;
    case "ath-save": {
      const name = $("#athName").value.trim(); if (!name) { toast("Add a name first."); return; }
      const wv = parseFloat($("#athW").value), kg = isFinite(wv) && wv > 0 ? (settings.weightUnit === "lb" ? wv * 0.453592 : wv) : null;
      if (id) Object.assign(athletes.find((a) => a.id === id), { name, kg });
      else {
        const a = { id: uid(), name, kg }; athletes.push(a);
        // added while setting up a run: put them in the lineup
        const from = backStack[backStack.length - 1];
        if (from && from[0] === "new" && cap.phase === "setup") { if (!cap.queue.includes(a.id)) cap.queue.push(a.id); cap.athleteId = cap.queue[0]; settings.lastQueue = cap.queue.slice(); }
        else { cap.athleteId = a.id; if (from && from[0] === "jump" && !cap.queue.includes(a.id)) cap.queue.push(a.id); }
        settings.lastAthlete = cap.athleteId; saveSettings();
      }
      saveAthletes(); toast("Saved"); back(); break;
    }
    case "ath-del": if (el.dataset.confirm === "1") { athletes = athletes.filter((a) => a.id !== id); saveAthletes(); toast("Athlete removed (their runs are kept)"); back(); } else { el.dataset.confirm = "1"; el.textContent = "Tap again to delete"; } break;
    case "wheel-open": wheelOpen(); break;
    case "unit": settings.weightUnit = v; saveSettings(); render(); break;
    case "theme": settings.theme = v || null; saveSettings(); if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme"); render(); break;
    case "export": exportBackup(); break;
    case "send-runs": sendRuns(false); break;
    case "send-all": sendRuns(true); break;
    case "send-file": saveRunsFile(); break;
    case "paste-runs": pasteRuns(); break;
    case "paste-add": { const ta = $("#pasteArea"); if (ta && ta.value.trim()) addRunsFrom(ta.value); else toast("Paste the copied runs into the box first."); break; }
    case "del-sim": { const n = runs.filter((r) => r.sim).length; runs = runs.filter((r) => !r.sim); jumps = jumps.filter((j) => !j.sim); saveJumps(); compareSel = []; saveRuns(); toast(`Deleted ${n} simulated run${n === 1 ? "" : "s"}`); render(); break; }
    case "demo-data": addDemoData(); break;
    case "clear-all": if (el.dataset.confirm === "1") { runs = []; compareSel = []; saveRuns(); toast("All runs deleted"); render(); } else { el.dataset.confirm = "1"; el.textContent = "Tap again to delete all runs"; } break;
  }
});

// ---------------- moving runs from the sensor page to the home-screen app ----------------
// The sensor serves the app over plain http, which phones won't keep for offline use. The copy on
// GitHub (https) opens anywhere, so it's the home for all runs: record on the sensor page, then
// tap "Copy runs" there and "Paste runs" in the home-screen app. Runs are matched by id, athletes by name.
const SYNC_URL = "https://paytonpittspv.github.io/LiDAR-Sensor-App/";
const sentSet = () => new Set(settings.sentIds || []);
const unsentRuns = () => { const s = sentSet(); return runs.filter((r) => !r.sim && !s.has(r.id)); };
function syncText(list) {
  const js = jumps.filter((j) => !j.sim), ids = new Set(list.concat(js).map((r) => r.athleteId));
  return JSON.stringify({ app: "paytons-lidar-sensor", v: 1, kind: "runs", athletes: athletes.filter((a) => ids.has(a.id)), runs: list, jumps: js });
}
function markSent(list) { settings.sentIds = [...new Set([...(settings.sentIds || []), ...list.map((r) => r.id)])].slice(-5000); saveSettings(); }
// copy has to happen right inside the tap, so it's done the old way (works on plain http, unlike navigator.clipboard)
function copyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.appendChild(ta);
  let ok = false;
  try {
    const r = document.createRange(); r.selectNodeContents(ta); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    ta.setSelectionRange(0, text.length); ok = document.execCommand("copy");
  } catch (e) { ok = false; }
  ta.remove(); try { getSelection().removeAllRanges(); } catch (e) {}
  return ok;
}
function sendRuns(all) {
  const list = all ? runs.filter((r) => !r.sim) : unsentRuns();
  if (!list.length) { toast("Nothing new to send."); return; }
  if (copyText(syncText(list))) { markSent(list); toast(`Copied ${list.length} run${list.length > 1 ? "s" : ""}. Open your home-screen app and tap Paste runs.`); render(); }
  else { toast("Couldn't copy here, so they're saved as a file instead."); saveRunsFile(list); }
}
function saveRunsFile(list) {
  list = list || unsentRuns(); if (!list.length) { toast("Nothing new to send."); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([syncText(list)], { type: "application/json" }));
  a.download = `lidar-runs-${dayKey(Date.now())}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); markSent(list); render();
}
// the card on the sensor page
function sendCardHTML(compact) {
  if (WEB_COPY && compact) return "";
  const n = unsentRuns().length;
  if (!n && compact) return "";
  return `<div class="card ${n ? "tint" : ""}"><div class="label">Send to your home-screen app</div>
    <div class="small muted" style="margin:4px 0 10px">${n ? `<b style="color:var(--text)">${n} run${n > 1 ? "s" : ""}</b> not in your app yet.` : "Every run here is in your app."} Copy them, open PAYTON'S LiDAR SENSOR from your home screen and tap <b>Paste runs</b>. Send after every session: this page only lives in Safari, and an iPhone can clear it after a week without a visit.</div>
    <div class="row"><button class="btn ${n ? "primary" : ""}" data-act="send-runs" ${n ? "" : "disabled"}>Copy ${n || ""} run${n === 1 ? "" : "s"}</button><button class="btn" data-act="send-file" ${n ? "" : "disabled"}>Save as file</button>${compact ? "" : `<button class="btn" data-act="send-all">Copy all again</button>`}</div></div>`;
}
// the card in the home-screen app
let pasteBox = false;
function getCardHTML() {
  if (!WEB_COPY && !ON_SECURE) return "";
  return `<div class="card"><div class="label">${ON_SECURE ? "Bring in runs from another copy" : "Get runs from the sensor"}</div>
    <div class="small muted" style="margin:4px 0 10px">${ON_SECURE ? "In the old home-screen app or on 192.168.4.1, open Settings and tap <b>Copy all again</b>, then come back here and tap <b>Paste runs</b>. Runs already here aren't added twice." : "Record on the sensor page (SpeedLidar Wi-Fi, 192.168.4.1 in Safari), tap <b>Copy runs</b> there, then come back here."}</div>
    <div class="row"><button class="btn primary" data-act="paste-runs">Paste runs</button><label class="btn" style="cursor:pointer">Open file<input type="file" id="syncFile" accept="application/json,.json" class="hidden"></label></div>
    ${pasteBox ? `<div class="field" style="margin-top:10px"><label for="pasteArea">Press and hold in the box, tap Paste, then Add runs</label><textarea id="pasteArea" rows="3" style="width:100%;font-size:16px"></textarea></div><button class="btn primary" data-act="paste-add">Add runs</button>` : ""}</div>`;
}
async function pasteRuns() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) { const t = await navigator.clipboard.readText(); if (t && t.trim()) { addRunsFrom(t); return; } }
  } catch (e) {}
  pasteBox = true; render(); const ta = $("#pasteArea"); if (ta) ta.focus();
}
// merges runs (by id) and athletes (by id, then by name) from a copied text, a runs file or a backup
function addRunsFrom(text) {
  let j; try { j = JSON.parse(text); } catch (e) { j = null; }
  if (!j || j.app !== "paytons-lidar-sensor" || !Array.isArray(j.runs)) { toast("That isn't runs from this app. Tap Copy runs on the sensor page first."); return false; }
  const byId = new Map(athletes.map((a) => [a.id, a])), byName = new Map(athletes.map((a) => [a.name.trim().toLowerCase(), a])), map = {};
  let newA = 0;
  for (const a of j.athletes || []) {
    const hit = byId.get(a.id) || byName.get(String(a.name || "").trim().toLowerCase());
    if (hit) { map[a.id] = hit.id; if (!hit.kg && a.kg) hit.kg = a.kg; }
    else { athletes.push(Object.assign({}, a)); byId.set(a.id, a); byName.set(String(a.name).trim().toLowerCase(), a); map[a.id] = a.id; newA++; }
  }
  const have = new Set(runs.map((r) => r.id)); let added = 0;
  for (const r of j.runs) if (r && r.id && !have.has(r.id)) { runs.push(Object.assign({}, r, { athleteId: map[r.athleteId] || r.athleteId })); added++; }
  runs.sort((a, b) => b.ts - a.ts);
  const haveJ = new Set(jumps.map((x) => x.id)); let addedJ = 0;
  for (const x of j.jumps || []) if (x && x.id && !haveJ.has(x.id)) { jumps.push(Object.assign({}, x, { athleteId: map[x.athleteId] || x.athleteId })); addedJ++; }
  if (addedJ) { jumps.sort((p, q) => q.ts - p.ts); saveJumps(); }
  saveAthletes(); saveRuns(); pasteBox = false;
  const dup = j.runs.length - added;
  if (!added && addedJ) { toast(`Added ${addedJ} jump${addedJ > 1 ? "s" : ""}.`); render(); return true; }
  toast(added ? `Added ${added} run${added > 1 ? "s" : ""}${addedJ ? ` and ${addedJ} jump${addedJ > 1 ? "s" : ""}` : ""}${newA ? ` and ${newA} athlete${newA > 1 ? "s" : ""}` : ""}${dup ? ` (${dup} already here)` : ""}.` : `All ${j.runs.length} runs were already here.`);
  render(); return true;
}

// ---------------- backup ----------------
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: "paytons-lidar-sensor", v: 1, athletes, runs, jumps, settings }, null, 0)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lidar-backup-${dayKey(Date.now())}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function importBackup(file) {
  if (!file) return;
  const fr = new FileReader(); fr.onload = () => addRunsFrom(fr.result); fr.readAsText(file);
}
function addDemoData() {
  const people = [["Demo Athlete", 68, 0], ["Demo Vaulter 2", 74, -0.35], ["Demo Vaulter 3", 63, 0.2]];
  const now = Date.now();
  for (const [name, kg, dv] of people) {
    let a = athletes.find((x) => x.name === name);
    if (!a) { a = { id: uid(), name, kg }; athletes.push(a); }
    for (let day = 13; day >= 0; day -= 3) {
      for (let rep = 0; rep < 2; rep++) {
        const ts = now - day * 864e5 - (3 - rep) * 600e3;
        const vmax = 8.7 + dv + (13 - day) * 0.03 + Math.random() * 0.15;
        const s = Engine.simulate({ seed: Math.floor(Math.random() * 1e6) + 1, vmax, target: 30, back: 3 });
        const res = Engine.process(s.raw, { mode: "sprint", target: 30, mass: a.kg });
        if (!res.error) runs.push({ id: uid(), ts, athleteId: a.id, mode: "sprint", target: 30, res, sim: true });
        const setup = ["runway100", "runway150", "polerun100"][(day / 3 + rep) % 3 | 0];
        const steps = 2 * (setup === "runway150" ? 9 + (rep % 2) : 7 + (rep % 2)) + 1;   // start + an even number of steps
        const carry = 0.55 + (name.endsWith("2") ? 0.25 : 0) + Math.random() * 0.2;
        const sv = Engine.simulate({ seed: Math.floor(Math.random() * 1e6) + 1, vmax: vmax - carry, steps, back: 2.5, popup: !!SETUPS[setup].pole, flight: 0.55 });
        const ctx = { mode: "vault", setup, mass: a.kg };
        {
          const probe = Engine.process(sv.raw, Object.assign({ noBox: true }, ctx)), box = SETUPS[setup].boxFt * FT;
          if (!probe.error) { const shift = Math.round((box - (11 + Math.random() * 2.5) * FT - 0.5 - probe.takeoff.sensor) * 100); sv.raw.d = sv.raw.d.map((cm) => (cm > 0 ? Math.max(1, cm + shift) : cm)); }
        }
        const rv = Engine.process(sv.raw, ctx);
        if (!rv.error) { const run = { id: uid(), ts: ts + 300e3, athleteId: a.id, mode: "vault", setup, res: rv, sim: true }; simPodPeak(run); runs.push(run); }
      }
    }
  }
  // vertical jumps: three a day, slowly getting higher
  for (const [name, , dv] of people) {
    const a = athletes.find((x) => x.name === name); if (!a) continue;
    for (let day = 13; day >= 0; day -= 3) for (let rep = 0; rep < 3; rep++) {
      const hT = 0.46 + dv * 0.12 + (13 - day) * 0.002 + (Math.random() - 0.5) * 0.04;
      jumps.push({ id: uid(), ts: now - day * 864e5 - 3600e3 + rep * 90e3, athleteId: a.id, h: hT, hStand: hT + 0.085 + Math.random() * 0.02, hFlight: hT + 0.01, t: Math.sqrt((8 * hT) / 9.80665), agree: true, cal: true, sim: true });
    }
  }
  jumps.sort((x, y) => y.ts - x.ts); saveJumps();
  saveAthletes(); runs.sort((x, y) => y.ts - x.ts); saveRuns(); toast("Demo data added"); render();
}

// ---------------- printable report ----------------
/*__REPORT__*/

// ---------------- start ----------------
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
render(); pollLoop();
});
// ===== APP END =====
