// ===== APP START =====
(() => {
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

// ---------------- storage (on this phone) ----------------
const DB = {
  get(k, d) { try { const v = localStorage.getItem("pls." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("pls." + k, JSON.stringify(v)); return true; } catch (e) { toast("Couldn't save: this phone's storage is full. Export a backup in Settings, then clear old runs."); return false; } },
};
let athletes = DB.get("athletes", []);
let runs = DB.get("runs", []);
let settings = Object.assign({ midOut: 4, voice: false, chime: "bell", solo: false, theme: null, weightUnit: "lb", lastAthlete: null, lastMode: "sprint", lastTarget: 30, lastSetup: "runway100" }, DB.get("settings", {}));
const saveAthletes = () => DB.set("athletes", athletes);
const saveRuns = () => DB.set("runs", runs);
const saveSettings = () => DB.set("settings", settings);
if (settings.theme) document.documentElement.setAttribute("data-theme", settings.theme);
const athleteById = (id) => athletes.find((a) => a.id === id) || { id, name: "Unknown athlete" };

// ---------------- tests ----------------
const SETUPS = {
  runway100: { name: "Runway · short approach", short: "Short approach", detail: "Tripod 100 ft from the back of the box", boxFt: 100 },
  runway150: { name: "Runway · long approach", short: "Long approach", detail: "Tripod 150 ft from the back of the box", boxFt: 150 },
  polerun: { name: "Pole run · off the runway", short: "Pole run", detail: "Anywhere on the track, tripod behind the start" },
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
const sensor = { connected: false, d: null, s: 0, rate: 0, rec: false, moved: false, misses: 0, state: 0, sets: 0, go: 0, inZone: false };
let pollBusy = false;
async function poll() {
  if (pollBusy) return; pollBusy = true;
  try {
    const live = view === "new" && cap.phase === "recording" && cap.liveFrom != null && !cap.sim;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 900);
    const j = await (await fetch(live ? `/live?from=${cap.liveFrom}` : "/live", { cache: "no-store", signal: ctl.signal })).json(); clearTimeout(to);
    sensor.connected = true; sensor.misses = 0;
    sensor.d = j.d > 10 && j.d < j.max ? j.d / 100 : null; sensor.s = j.s; sensor.rate = j.rate; sensor.rec = j.rec; sensor.moved = j.moved;
    sensor.state = j.state || 0; sensor.sets = j.sets || 0; sensor.go = j.go || 0; sensor.inZone = !!j.in;
    if (live && j.pts) { liveAdd(j.pts); cap.liveFrom = j.next; }
    onLive();
  } catch (e) { if (++sensor.misses > 3) { sensor.connected = false; sensor.d = null; } }
  pollBusy = false;
  const p = $("#conn"); p.className = "pill " + (sensor.connected ? "ok" : "off"); p.textContent = sensor.connected ? (sensor.d != null ? `${sensor.d.toFixed(2)} m` : "Connected") : "No sensor";
  document.querySelectorAll("[data-live]").forEach((el) => (el.textContent = sensor.d != null ? sensor.d.toFixed(2) : "—"));
  const z = $("#zone"); if (z) { z.classList.toggle("on", sensor.inZone); z.querySelector("span").textContent = sensor.inZone ? "Someone is in the zone: stand still…" : "Nobody in the zone yet"; }
}
// poll faster while a run is live
// the copy on the web (https) can't reach the sensor: browsers block a secure page from talking to it
const WEB_COPY = location.protocol === "https:";
function pollLoop() {
  if (WEB_COPY) { const p = $("#conn"); p.className = "pill off"; p.textContent = "Practice"; return; } poll().finally(() => setTimeout(pollLoop, view === "new" && ["waiting", "ready", "recording"].includes(cap.phase) ? 120 : 250)); }

// ---------------- sounds ----------------
// The ready chime is synthesised once into a WAV clip and played with an <audio> element.
// (iPhones mute Web Audio with the silent switch; an audio clip plays like music, so it still sounds
// with the switch on and goes out over a Bluetooth speaker.)
const CHIMES = {
  // bell: three rising bell notes (B5 · E6 · G#6) with a soft room tail
  bell: { notes: [[987.77, 0], [1318.51, 0.12], [1661.22, 0.24]], partials: [[1, 1, 1.4], [2.76, 0.32, 0.55], [5.4, 0.12, 0.25], [8.93, 0.05, 0.12]], dur: 2.0 },
  // soft: lower, rounder two-note "ding-dong" chime
  soft: { notes: [[783.99, 0], [1046.5, 0.2]], partials: [[1, 1, 1.6], [2, 0.18, 0.7], [3, 0.06, 0.3]], dur: 2.0 },
};
function renderChime(kind) {
  const C = CHIMES[kind] || CHIMES.bell, sr = 44100, n = Math.floor(sr * C.dur), dry = new Float32Array(n);
  for (const [f0, t0] of C.notes) {
    const s0 = Math.floor(t0 * sr);
    for (const [ratio, amp, decay] of C.partials) for (const det of [-1.2, 1.2]) {   // two slightly detuned voices = shimmer
      const w = 2 * Math.PI * (f0 * ratio + det) / sr;
      for (let i = s0; i < n; i++) {
        const t = (i - s0) / sr, env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
        if (env < 1e-4 && t > 0.01) break;
        dry[i] += 0.5 * amp * env * Math.sin(w * (i - s0));
      }
    }
  }
  // small room: four comb filters into two all-passes (Schroeder), mixed in gently
  const wet = new Float32Array(n);
  for (const [d, g] of [[1557, 0.78], [1617, 0.77], [1491, 0.79], [1422, 0.8]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < n; i++) { const y = buf[k]; buf[k] = dry[i] + y * g; k = (k + 1) % d; wet[i] += y * 0.25; }
  }
  for (const [d, g] of [[225, 0.5], [556, 0.5]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < n; i++) { const b = buf[k], y = -wet[i] + b; buf[k] = wet[i] + b * g; k = (k + 1) % d; wet[i] = y; }
  }
  const out = new Float32Array(n); let peak = 0;
  for (let i = 0; i < n; i++) { out[i] = dry[i] + 0.22 * wet[i]; peak = Math.max(peak, Math.abs(out[i])); }
  const fade = Math.floor(0.25 * sr);
  for (let i = 0; i < n; i++) { out[i] *= 0.9 / peak; if (i > n - fade) out[i] *= (n - i) / fade; }
  // 16-bit mono WAV
  const bytes = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); bytes.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, sr, true); bytes.setUint32(28, sr * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); str(36, "data"); bytes.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 32767, true);
  return URL.createObjectURL(new Blob([bytes.buffer], { type: "audio/wav" }));
}
const chimeEls = {};
function chimeEl() {
  const kind = settings.chime || "bell";
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
  session: DB.get("session", null), setsSeen: 0, liveFrom: null, live: null, sim: null };
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
  if (cap.setup === "polerun") return { stop: 0, gate: 0, hold: 2000, max: 9900, text: "Stand still on your start mark for 2 s" };
  const box = Math.round(SETUPS[cap.setup].boxFt * FT * 100);
  return { stop: 0, gate: box - 1220, hold: 2000, max: box, text: "Stand still on your start mark for 2 s" };
}
// tell the sensor to wait for the next athlete (it arms itself when they stand still)
async function arm(now) {
  cap.error = null; cap.run = null; cap.live = null; cap.liveFrom = null; cap.sim = null;
  const r = armRule();
  cap.setsSeen = sensor.sets;
  if (sensor.connected) {
    try { await fetch(`/arm?stop=${r.stop}&gate=${r.gate}&hold=${r.hold}&max=${r.max}${now ? "&now=1" : ""}`, { cache: "no-store" }); }
    catch (e) { cap.error = "Couldn't reach the sensor. Join its Wi-Fi (SpeedLidar) and try again."; }
  }
  cap.phase = "waiting"; cap.armedAt = Date.now();
  render();
}
function toReady() { cap.phase = "ready"; cap.setsSeen = sensor.sets; readySignal(); render(); }
async function stopNow() { try { await fetch("/stop", { cache: "no-store" }); } catch (e) {} }
let fetching = false;
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
function liveSpan() { return cap.mode === "sprint" ? cap.target : cap.setup === "polerun" ? 40 : Math.round(SETUPS[cap.setup].boxFt * FT - (cap.live && cap.live.d0 || 0)); }
function liveDraw() {
  const L = cap.live, el = $("#liveBox"); if (!L || !el) return;
  const x = L.pts.length ? L.pts[L.pts.length - 1][0] : 0;
  $("#liveD").textContent = x.toFixed(1); $("#liveV").textContent = L.v.toFixed(2); $("#liveTop").textContent = L.top ? `top ${L.top.toFixed(2)} m/s` : "";
  const W = 340, H = 150, pl = 30, pr = 8, pt = 8, pb = 22, span = Math.max(5, liveSpan()), ym = 12;
  const X = (v) => pl + (v / span) * (W - pl - pr), Y = (v) => pt + (1 - Math.min(v, ym) / ym) * (H - pt - pb);
  let d = ""; for (const [a, b] of L.pts) d += (d ? "L" : "M") + X(Math.min(a, span)).toFixed(1) + " " + Y(b).toFixed(1);
  $("#livePath").setAttribute("d", d || "M0 0");
  $("#liveFill").setAttribute("d", d ? d + `L${X(Math.min(x, span)).toFixed(1)} ${Y(0)}L${X(0)} ${Y(0)}Z` : "M0 0");
}
function liveCardHTML() {
  const W = 340, H = 150, pl = 30, pr = 8, pt = 8, pb = 22, span = Math.max(5, liveSpan()), ym = 12;
  const X = (v) => pl + (v / span) * (W - pl - pr), Y = (v) => pt + (1 - v / ym) * (H - pt - pb);
  let grid = ""; for (const v of [3, 6, 9, 12]) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v}</text>`;
  for (const t of niceTicks(0, span, 6)) grid += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${t}</text>`;
  return `<div class="card tint" id="liveBox"><div class="between"><div class="upname" style="font-size:22px">${esc(athleteById(cap.athleteId).name)}</div><span class="pill ok">● LIVE</span></div>
    <div class="grid2" style="margin-top:6px"><div><div class="label">Distance</div><div class="livebig"><span id="liveD">0.0</span><small> m</small></div></div>
      <div><div class="label">Speed</div><div class="livebig"><span id="liveV">0.00</span><small> m/s</small></div><div class="small muted" id="liveTop"></div></div></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;margin-top:8px" aria-label="Live speed along the run"><defs><linearGradient id="lvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--pink);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--pink);stop-opacity:0"/></linearGradient></defs>
      ${grid}<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-opacity=".5"/>
      <path id="liveFill" d="M0 0" fill="url(#lvg)"/><path id="livePath" d="M0 0" fill="none" stroke="var(--pink)" stroke-width="2.6" stroke-linejoin="round"/></svg>
    <div class="small muted" style="text-align:center">Speed (m/s) · distance from the start (m)</div></div>`;
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
  if (res.error) {
    // a false start or a bad run: the same athlete goes again
    toast(res.error + " Same athlete, go again.");
    if (settings.solo) { arm(); return; }
    cap.error = res.error; arm(); return;
  }
  const run = { id: uid(), ts: Date.now(), athleteId: cap.athleteId, mode: cap.mode, res };
  if (cap.mode === "sprint") run.target = cap.target; else run.setup = cap.setup;
  if (settings.solo) {
    keepRun(run);
    say((cap.queue.length > 1 ? `${firstName(run.athleteId)}. ` : "") + speech(run) + (cap.queue.length > 1 ? ` Next up, ${firstName(cap.athleteId)}.` : ""));
    // results stay on screen until the next athlete steps in and the sensor arms
    cap.lastRun = run; cap.lastSaved = true; arm();
  } else { cap.run = run; cap.phase = "review"; say(speech(run)); render(); }
}
// no sensor: play a simulated run through the same live view, in real time
function simulateRun() {
  const seed = Math.floor(Math.random() * 1e6) + 1, vmax = 8.4 + Math.random() * 1.0;
  let raw;
  if (cap.mode === "sprint") raw = Engine.simulate({ seed, vmax, target: cap.target, back: 3 }).raw;
  else {
    const steps = 14 + Math.floor(Math.random() * 5);
    raw = Engine.simulate({ seed, vmax, steps, hop: Math.random() < 0.3, back: 3, finish: (Math.random() - 0.5) * 0.8 }).raw;
    if (cap.setup !== "polerun") {
      // shift so the takeoff lands a realistic distance from the box
      const box = SETUPS[cap.setup].boxFt * FT, probe = Engine.process(raw, { mode: "vault", setup: "polerun" });
      if (!probe.error) { const shift = Math.round((box - (11 + Math.random() * 3) * FT - 0.5 - probe.takeoff.sensor) * 100); raw.d = raw.d.map((cm) => (cm > 0 ? Math.max(1, cm + shift) : cm)); }
    }
  }
  const t0 = raw.t[0], n = raw.t.length; let i = 0;
  cap.sim = true; startLive(0); cap.sim = true;
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
  if (R.contacts) return R.contacts;
  // runs saved before this was added: work it out from the step times and the curve
  const st = R.steps.times, n = st.length, cv = R.curve, box = R.box || null;
  return st.map((t, i) => { const fromEnd = n - 1 - i, left = fromEnd % 2 === 0, k = Math.max(0, cv.t.findIndex((x) => x >= t)), lead = fromEnd === 0 ? 0.5 : 0.4;
    return { t, left, takeoff: fromEnd === 0, out: left ? fromEnd / 2 : null, n: left ? R.steps.lefts - fromEnd / 2 : null,
      boxFt: box ? (box - (cv.d[k] + R.start.d + lead)) / FT : null, startFt: (cv.d[k] + lead) / FT, v: cv.v[k] }; });
}
const hasBox = (r) => r.setup !== "polerun";
const spotFt = (r, c) => (hasBox(r) ? c.boxFt : c.startFt);
const outLabel = (o) => (o === 0 ? "Takeoff" : `${o} out`);
// into the box: speed change over the last half second before the plant
function finishTag(R) {
  const f = R.finish; if (!f) return null;
  const c = f.change, word = c >= 0.1 ? "Speeding up" : c <= -0.1 ? "Slowing" : "Holding speed";
  return { c, cls: c >= 0.1 ? "up" : c <= -0.1 ? "down" : "flat", text: `${word} into the box`, value: `${c >= 0 ? "+" : "−"}${Math.abs(c).toFixed(2)}`, accel: f.accel };
}
// runway map: one lane per jump, box on the right; lefts pink with their spot in feet, rights grey
function runwayMap(items, o = {}) {
  if (!items.length) return "";
  const box = hasBox(items[0].run), W = 360, pl = 6, pr = box ? 30 : 10, single = items.length === 1;
  const laneH = single ? 62 : 46, top = 8, H = top + items.length * laneH + 22, fz = single ? 11 : 8.5;
  let far = 20;
  for (const { run } of items) { for (const c of contactsOf(run)) far = Math.max(far, spotFt(run, c) || 0); if (box && run.res.startMarkFt) far = Math.max(far, run.res.startMarkFt); }
  far = Math.ceil((far + 3) / 10) * 10;
  const X = (ft) => (box ? pl + ((far - ft) / far) * (W - pl - pr) : pl + (ft / far) * (W - pl - pr));
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="Where each left landed">`;
  // grid every 10 ft
  for (let f = 0; f <= far; f += 10) s += `<line x1="${X(f)}" x2="${X(f)}" y1="${top}" y2="${H - 22}" stroke="var(--line)" stroke-width="${f % 50 === 0 ? 1.2 : 0.6}"/>${X(f) > 14 ? `<text x="${X(f)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${box && f === 0 ? "" : f + "'"}</text>` : ""}`;
  if (box) s += `<rect x="${X(0)}" y="${top}" width="${pr - 6}" height="${H - 22 - top}" rx="3" fill="var(--purple)" opacity=".18"/><text x="${X(0) + (pr - 6) / 2}" y="${H - 8}" text-anchor="middle" font-size="9" font-weight="800" fill="var(--purple)">BOX</text>`;
  // mid mark: the average spot of the chosen left
  if (o.mid != null) {
    const xs = []; for (const { run } of items) for (const c of contactsOf(run)) if (c.left && c.out === o.mid) xs.push(spotFt(run, c));
    if (xs.length) { const m = xs.reduce((a, b) => a + b, 0) / xs.length; s += `<line x1="${X(m)}" x2="${X(m)}" y1="${top - 2}" y2="${H - 22}" stroke="var(--purple)" stroke-width="1.5" stroke-dasharray="4 3"/>`; }
  }
  items.forEach(({ run, label }, li) => {
    const y0 = top + li * laneH, yl = y0 + (single ? 34 : 22), cs = contactsOf(run), R = run.res;
    if (label && !single) s += `<text x="${pl}" y="${y0 + 9}" font-size="9.5" font-weight="700" fill="var(--muted)">${esc(label)}</text>`;
    const xs = cs.map((c) => X(spotFt(run, c))), startX = box && R.startMarkFt != null ? X(R.startMarkFt) : box ? null : X(0);
    if (cs.length) s += `<line x1="${startX != null ? startX : xs[0]}" x2="${xs[xs.length - 1]}" y1="${yl}" y2="${yl}" stroke="var(--line)" stroke-width="2"/>`;
    if (startX != null) s += `<path d="M${startX} ${yl - 7} l5 7 l-5 7 l-5 -7z" fill="var(--blue)"/>`;
    let flip = false;
    cs.forEach((c, i) => {
      const x = xs[i];
      if (!c.left) { s += `<circle cx="${x}" cy="${yl}" r="2.8" fill="#9a95b8"/>`; return; }
      s += c.takeoff ? `<circle cx="${x}" cy="${yl}" r="6" fill="var(--card)" stroke="var(--pink)" stroke-width="3"/>` : `<circle cx="${x}" cy="${yl}" r="4.6" fill="var(--pink)"/>`;
      // full feet-and-inches when there's room, rounded feet when lefts are close together
      const ft = spotFt(run, c), gap = Math.min(...cs.map((q, j) => (q.left && j !== i ? Math.abs(xs[j] - x) : 999)));
      const txt = single && gap > 44 ? ftLabel(ft) : `${Math.round(ft)}'`;
      if (single) {
        s += `<text x="${x}" y="${yl - 11 - (flip ? 13 : 0)}" text-anchor="middle" font-size="${fz}" font-weight="700" fill="var(--text)">${txt}</text>`;
        s += `<text x="${x}" y="${yl + 20}" text-anchor="middle" font-size="10" font-weight="800" fill="var(--pink)">${c.takeoff ? "TO" : "L" + c.n}</text>`;
        flip = !flip;
      } else s += `<text x="${x}" y="${yl + 15}" text-anchor="middle" font-size="8.5" font-weight="600" fill="var(--muted)">${txt}</text>`;
    });
  });
  return s + `</svg>`;
}
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
    <div class="small muted" style="margin:2px 0 8px"><span style="color:var(--blue)">◆</span> start mark · <span style="color:var(--pink)">●</span> lefts · <span style="color:#9a95b8">●</span> rights · ◯ takeoff</div>
    <div class="tw"><table class="lm"><thead><tr><th>Left</th><th>Counted back</th><th>From ${box ? "box" : "start"}</th><th>Stride</th><th>m/s</th></tr></thead><tbody>${rows}</tbody></table></div>
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

// ---------------- views ----------------
let view = "home", viewArg = null;
function go(v, arg) {
  view = v; viewArg = arg == null ? null : arg;
  // New run always opens the start page (sprint or vault, who's running, where to stop) unless a run is being recorded right now
  if (v === "new" && cap.phase !== "recording" && cap.phase !== "processing" && cap.phase !== "summary") { if (cap.phase === "ready") stopNow(); cap.phase = "setup"; cap.error = null; }
  render(); window.scrollTo(0, 0);
}
function voiceCard() {
  return `<div class="card between" style="margin-top:6px"><div><b>Voice</b><div class="small muted">Says "${cap.queue.length > 1 ? "Name, ready" : "Ready"}" after the chime and reads every result aloud. Off: chime only.</div></div><label class="switch"><input type="checkbox" id="voiceSw" ${settings.voice ? "checked" : ""}><span></span></label></div>`;
}
function athletePicker() {
  if (!athletes.length) return `<div class="card"><div class="muted small" style="margin-bottom:8px">Add who's running first.</div><button class="btn" data-act="ath-new">Add athlete</button></div>`;
  return `<div class="chips">${athletes.map((a) => { const i = cap.queue.indexOf(a.id); return `<button class="chip" data-act="pick-ath" data-id="${a.id}" aria-pressed="${i >= 0}">${i >= 0 ? `<span class="qn">${i + 1}</span>` : ""}${esc(a.name)}</button>`; }).join("")}<button class="chip" data-act="ath-new">+ Add</button></div>
    <div class="small muted" style="margin-top:6px">${cap.queue.length > 1 ? `They take turns in this order: after each run it gets ready for the next athlete.` : "Pick one or more. With several, they take turns and it gets ready for the next one after each run."}</div>`;
}
function sessionBar() {
  if (!cap.session) return "";
  const n = cap.session.ids.length, mins = Math.max(0, Math.round((Date.now() - cap.session.start) / 60000));
  return `<div class="sessbar"><div><b>Session</b><span>${n} run${n === 1 ? "" : "s"} saved · ${mins} min</span></div><button class="btn sm" data-act="cap-end">End session</button></div>`;
}
function upNext() {
  if (cap.queue.length < 2) return "";
  return `<div class="upnext"><span class="small muted">Up now · tap to change</span><div class="chips">${cap.queue.map((id, i) => `<button class="chip" data-act="cap-up" data-id="${id}" aria-pressed="${id === cap.athleteId}"><span class="qn">${i + 1}</span>${esc(athleteById(id).name)}</button>`).join("")}</div></div>`;
}
function summaryHTML() {
  const s = cap.session, list = s ? runs.filter((r) => s.ids.includes(r.id)).sort((x, y) => x.ts - y.ts) : [];
  let h = `<div class="between" style="align-items:center"><h1 style="margin:0">Session ended</h1></div>
    <div class="card tint"><div class="small muted">${s ? `${dayLabel(dayKey(s.start), true)} · ${timeLabel(s.start)}` : ""} · ${list.length} run${list.length === 1 ? "" : "s"}</div>
    <div class="grid2" style="margin-top:10px"><button class="btn primary" data-act="session-report" ${list.length ? "" : "disabled"}>Print report (PDF)</button><button class="btn" data-act="cap-close">Done</button></div></div>`;
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
    <div style="flex:1;min-width:0"><b>${esc(athleteById(r.athleteId).name)}</b><div class="small muted">${testName(testKey(r))} · ${timeLabel(r.ts)}${r.mode === "vault" && r.res.steps.counted ? ` · ${r.res.steps.lefts} lefts` : ""}</div></div>
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
  h += `<div class="card tint"><div class="between"><div><div class="label">Sensor</div>
      <div class="small" style="margin-top:2px"><span class="dot" style="background:${sensor.connected ? "var(--good)" : "var(--muted)"}"></span>${sensor.connected ? `Connected · <span data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</span> m` : "Not connected"}</div></div>
      <div class="small muted" style="text-align:right;max-width:55%">${sensor.connected ? `${sensor.rate} readings/s` : (WEB_COPY ? "Practice website: runs are simulated. To record, join the SpeedLidar Wi-Fi and open 192.168.4.1." : "Join the SpeedLidar Wi-Fi to record.")}</div></div>
    <button class="btn big primary" style="margin-top:12px" data-go="new">New run</button></div>`;
  if (!athletes.length) return h + `<div class="card"><b>Start here</b><div class="small muted" style="margin:4px 0 10px">Add the athletes you'll be timing. Body weight is optional and only used for power.</div><button class="btn" data-act="ath-new">Add an athlete</button></div>`;
  // quick numbers
  const tile = (v, k, go) => `<button class="qt" ${go ? `data-go="${go}"` : ""}><b>${v}</b><span>${k}</span></button>`;
  h += `<div class="qtiles">${tile(today.length, "runs today", "sessions")}${tile(week.length, "this week", "sessions")}${tile(prs.filter((e) => now - e.r.ts < 7 * 864e5).length, "PRs this week", "analytics")}</div>`;
  if (!runs.length) return h + `<div class="card"><b>No runs yet</b><div class="small muted" style="margin-top:4px">Tap New run, pick sprint or vault and who's running, and the sensor does the rest. No sensor yet? Settings → Add demo data.</div></div>`;
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

function newHTML() {
  const a = cap.athleteId && athletes.find((x) => x.id === cap.athleteId);
  if (cap.phase === "summary") return summaryHTML();
  if (cap.phase === "setup" || cap.phase === "ready-error") {
    let h = sessionBar() + `<h1>New run</h1>`;
    if (cap.error) h += `<div class="card" style="border-color:var(--bad)"><b style="color:var(--bad)">${esc(cap.error)}</b></div>`;
    h += `<div class="seg" style="margin-bottom:14px"><button data-act="cap-mode" data-v="sprint" aria-pressed="${cap.mode === "sprint"}">Sprint</button><button data-act="cap-mode" data-v="vault" aria-pressed="${cap.mode === "vault"}">Vault</button></div>`;
    h += `<div class="label" style="margin:6px 0 8px">Who's running</div>${athletePicker()}`;
    if (cap.mode === "sprint") {
      h += `<div class="label" style="margin:18px 0 8px">Stop at</div><div class="chips">${[10, 20, 30, 40, 60].map((d) => `<button class="chip" data-act="cap-target" data-v="${d}" aria-pressed="${cap.target === d}">${d} m</button>`).join("")}
        <span class="row" style="gap:6px"><input type="number" id="customTarget" inputmode="numeric" min="5" max="80" placeholder="Other" style="width:90px" value="${[10, 20, 30, 40, 60].includes(cap.target) ? "" : cap.target}"><span class="muted">m</span></span></div>
        <div class="card" style="margin-top:14px"><div class="small muted">Recording starts by itself when the athlete moves and stops at the distance you set. The clock starts once movement is confirmed (speed passes 0.2 m/s), so a small rock or lean before the start doesn't count.</div></div>`;
    } else {
      h += `<div class="label" style="margin:18px 0 8px">Setup</div>${Object.entries(SETUPS).map(([k, s]) => `<button class="opt" data-act="cap-setup" data-v="${k}" aria-pressed="${cap.setup === k}"><b>${s.name}</b><span>${s.detail}</span></button>`).join("")}`;
      h += setupGuide(cap.setup);
    }
    h += `<div class="card" style="margin-top:6px"><b>Ready chime</b><div class="small muted">Plays every time an athlete has stood in long enough and the sensor is armed. Turn the phone volume up: it plays with the silent switch on and through a Bluetooth speaker.</div>
      <div class="between" style="margin-top:10px;gap:8px;flex-wrap:wrap"><div class="chips">${[["bell", "Bell"], ["soft", "Soft"]].map(([k, l]) => `<button class="chip sm" data-act="chime-kind" data-v="${k}" aria-pressed="${(settings.chime || "bell") === k}">${l}</button>`).join("")}</div><button class="btn sm" data-act="chime-test">▶ Play chime</button></div></div>
    ${voiceCard()}
    <div class="card between" style="margin-top:6px"><div><b>Hands Free Mode</b><div class="small muted">Saves every run and gets ready for the next athlete by itself.</div></div><label class="switch"><input type="checkbox" id="soloSw" ${settings.solo ? "checked" : ""}><span></span></label></div>`;
    const q = cap.queue;
    h += `<button class="btn big primary" data-act="cap-ready" ${q.length ? "" : "disabled"}>${!q.length ? "Pick who's running" : q.length === 1 ? `Get ready · ${esc(athleteById(q[0]).name)}` : `Start · ${q.length} athletes taking turns`}</button>`;
    return h;
  }
  const test = cap.mode === "sprint" ? `${cap.target} m sprint` : SETUPS[cap.setup].name, rule = armRule(), name = esc(a ? a.name : "");
  const lastBlock = () => {
    const r = cap.lastRun; if (!r) return "";
    return `<h2 style="margin-top:18px">Last run · ${esc(athleteById(r.athleteId).name)}</h2>` + resultsHTML(r)
      + `<div class="row" style="justify-content:flex-end;margin-top:-4px"><span class="small muted" style="margin-right:auto">${cap.lastSaved ? "Saved" : ""}</span><button class="btn sm" data-act="open-report" data-id="${r.id}">Report</button></div>`;
  };
  const nextLine = () => (cap.queue.length > 1 ? `<div class="small muted" style="text-align:center;margin:-4px 0 8px">Then: <b style="color:var(--text)">${esc(athleteById(nextUp(cap.athleteId)).name)}</b></div>` : "");
  if (cap.phase === "waiting") {
    let h = sessionBar();
    if (cap.error) h += `<div class="card" style="border-color:var(--bad)"><b style="color:var(--bad)">${esc(cap.error)}</b></div>`;
    h += `<div class="card tint" style="text-align:center;padding:22px 14px"><div class="label">Up now · ${test}</div><div class="upname">${name}</div>
      <div class="status" style="font-size:40px;margin-top:10px">STEP IN</div><div class="muted">${rule.text}. You'll hear the chime when it's armed.</div>
      <div class="zone ${sensor.inZone ? "on" : ""}" id="zone"><i></i><span>${sensor.inZone ? "Someone is in the zone: stand still…" : "Nobody in the zone yet"}</span></div></div>`;
    h += nextLine() + upNext();
    if (settings.solo) h += `<div class="small muted" style="text-align:center;margin:0 0 10px">Hands Free Mode: every run is saved and read out, then it waits for the next athlete.</div>`;
    h += `<div class="grid2"><button class="btn" data-act="cap-cancel">Cancel</button><button class="btn" data-act="cap-armnow">Arm now</button></div>`;
    if (!sensor.connected) h += `<div class="card" style="margin-top:12px"><div class="small muted" style="margin-bottom:8px">No sensor connected. Try it with a simulated athlete.</div><button class="btn" data-act="cap-sim-in">Simulate: athlete stands in</button></div>`;
    return h + lastBlock();
  }
  if (cap.phase === "ready") {
    let h = sessionBar() + `<div class="card tint ready" style="text-align:center;padding:24px 14px"><div class="label">${test}</div><div class="upname">${name}</div><div class="status">READY</div>
      <div class="muted">${cap.mode === "sprint" ? `Go when ready. The clock starts once movement is confirmed and stops at ${cap.target} m.` : "Go when ready. It records the lefts, top speed and the speed into the box, and stops after the takeoff."}</div>
      <div class="live" style="margin-top:12px"><span data-live>${sensor.d != null ? sensor.d.toFixed(2) : "—"}</span><span class="u" style="font-size:16px;color:var(--muted)"> m</span></div></div>`;
    h += nextLine();
    h += `<div class="grid2"><button class="btn" data-act="cap-cancel">Cancel</button><button class="btn" data-act="cap-rewait">Not ready</button></div>`;
    if (!sensor.connected) h += `<div class="card" style="margin-top:12px"><div class="small muted" style="margin-bottom:8px">No sensor connected. Try it with a simulated run.</div><button class="btn" data-act="cap-sim">Simulate a run</button></div>`;
    return h + lastBlock();
  }
  if (cap.phase === "recording") return sessionBar() + liveCardHTML() + `<button class="btn" style="width:100%" data-act="cap-stop">Stop now</button>`;
  if (cap.phase === "processing") return sessionBar() + `<div class="card tint" style="text-align:center;padding:30px 14px"><div class="upname">${name}</div><div class="status" style="font-size:36px">WORKING…</div><div class="muted">Working out the results.</div></div>`;
  // review (Hands Free off): save or throw away
  const run = cap.run;
  let h = sessionBar() + `<div class="between"><h1 style="margin-bottom:4px">${esc(athleteById(run.athleteId).name)}</h1><span class="pill">${test}</span></div>`;
  h += resultsHTML(run);
  h += `<div class="grid2"><button class="btn big danger" data-act="cap-discard">Throw away</button><button class="btn big primary" data-act="cap-save">Save${cap.queue.length > 1 ? ` · next: ${esc(firstName(nextUp(run.athleteId)))}` : ""}</button></div>`;
  return h;
}
function setupGuide(setup) {
  if (setup === "polerun") return `<div class="card howto"><div class="label">Pole runs</div><ol>
    <li>Set the tripod behind the start on the track, in the lane the athlete will run.</li>
    <li>Aim straight down the lane at about lower-back height.</li>
    <li>The run is measured until the athlete slows down. Lefts are counted back from the last step before slowing.</li></ol></div>`;
  const ft = SETUPS[setup].boxFt, m = (ft * FT).toFixed(2);
  return `<div class="card howto"><div class="label">Same setup every time · ${ft} ft</div><ol>
    <li>Run a tape from the <b>back of the box</b> straight up the middle of the runway to <b>${ft} ft</b>. Mark it with tape so it's there next time.</li>
    <li>Stand the tripod so the <b>front of the case</b> (the sensor window) is right over that mark.</li>
    <li>Aim straight down the runway at the box, at about lower-back height.</li>
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

function sessionsHTML() {
  if (!runs.length) return `<h1>Sessions</h1><div class="card empty">No runs saved yet.</div>`;
  const days = {}; for (const r of runs) (days[dayKey(r.ts)] = days[dayKey(r.ts)] || []).push(r);
  let h = `<h1>Sessions</h1>` + compareBar();
  for (const k of Object.keys(days).sort().reverse()) {
    const list = days[k], who = [...new Set(list.map((r) => athleteById(r.athleteId).name))];
    const tests = [...new Set(list.map(testKey))].map(testShort);
    h += `<div class="card list"><div class="item" data-act="open-session" data-id="${k}" style="padding-top:0"><div><b>${dayLabel(k, true)}</b><div class="small muted">${list.length} run${list.length > 1 ? "s" : ""} · ${esc(who.join(", "))}</div><div class="small muted">${esc(tests.join(" · "))}</div></div><div class="r">›</div></div></div>`;
  }
  return h;
}
function sessionHTML(k) {
  const list = runs.filter((r) => dayKey(r.ts) === k);
  let h = `<button class="btn sm" data-act="back">‹ Sessions</button><h1 style="margin-top:10px">${dayLabel(k, true)}</h1>` + compareBar();
  if (!list.length) return h + `<div class="card empty">No runs on this day.</div>`;
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
  const setup = anState.test.split("-")[1], hasBox = setup !== "polerun";
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
      <div class="midbox"><div><div class="small muted">Mid mark · ${mid} lefts out from takeoff</div><div class="big2">${midTxt}</div></div><div class="small muted" style="text-align:right">${setup !== "polerun" ? "from the box" : "from the start"}<br>${col.length} jump${col.length === 1 ? "" : "s"}</div></div>
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
  // overlaid trend: best key metric per day, one line per athlete
  const series = [], dots = [], allDays = new Set();
  const per = sel.map((id) => { const by = bestPerDay(runs.filter((r) => r.athleteId === id && testKey(r) === test), km.pick); Object.keys(by).forEach((d) => allDays.add(d)); return by; });
  const dl = [...allDays].sort();
  if (dl.length) {
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
  h += `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul><div class="small muted">Tap an athlete to see their numbers above.</div></div>`;
  return h;
}

function analyticsHTML() {
  if (!athletes.length) return `<h1>Analytics</h1><div class="card empty">Add an athlete and save some runs to see trends.</div>`;
  if (!anState.athleteId || !athletes.find((a) => a.id === anState.athleteId)) anState.athleteId = settings.lastAthlete && athletes.find((a) => a.id === settings.lastAthlete) ? settings.lastAthlete : athletes[0].id;
  const mine = runs.filter((r) => r.athleteId === anState.athleteId);
  let h = `<h1>Analytics</h1><div class="chips" style="margin-bottom:12px">${athletes.map((a) => `<button class="chip" data-act="an-ath" data-id="${a.id}" aria-pressed="${a.id === anState.athleteId}">${esc(a.name)}</button>`).join("")}</div>`;
  if (!mine.length) return h + `<div class="card empty">No runs for ${esc(athleteById(anState.athleteId).name)} yet.</div>`;
  const tests = [...new Set(mine.map(testKey))].sort();
  if (!anState.test || !tests.includes(anState.test)) anState.test = tests[0];
  h += `<div class="chips" style="margin-bottom:12px">${tests.map((t) => `<button class="chip" data-act="an-test" data-v="${t}" aria-pressed="${t === anState.test}">${testShort(t)}</button>`).join("")}</div>`;
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

function settingsHTML() {
  const used = (() => { try { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (localStorage.getItem(k) || "").length; } return n; } catch (e) { return 0; } })();
  let h = `<h1>Settings</h1>`;
  h += `<h2>Athletes</h2><div class="card list">${athletes.length ? athletes.map((a) => `<div class="item" data-act="ath-edit" data-id="${a.id}"><div><b>${esc(a.name)}</b><div class="small muted">${a.kg ? (settings.weightUnit === "lb" ? `${Math.round(a.kg / 0.453592)} lb` : `${a.kg.toFixed(1)} kg`) : "No body weight"}</div></div><div class="r">›</div></div>`).join("") : `<div class="muted">No athletes yet.</div>`}</div><button class="btn" data-act="ath-new">Add athlete</button>`;
  h += `<h2>Results</h2><div class="card between"><div><b>Hands Free Mode</b><div class="small muted">Save every run and get ready for the next athlete by itself.</div></div><label class="switch"><input type="checkbox" id="soloSw" ${settings.solo ? "checked" : ""}><span></span></label></div>${voiceCard()}
    <div class="card between"><div><b>Body weight in</b></div><div class="seg" style="width:140px"><button data-act="unit" data-v="lb" aria-pressed="${settings.weightUnit === "lb"}">lb</button><button data-act="unit" data-v="kg" aria-pressed="${settings.weightUnit === "kg"}">kg</button></div></div>
    <div class="card between"><div><b>Look</b></div><div class="seg" style="width:200px"><button data-act="theme" data-v="" aria-pressed="${!settings.theme}">Auto</button><button data-act="theme" data-v="dark" aria-pressed="${settings.theme === "dark"}">Dark</button><button data-act="theme" data-v="light" aria-pressed="${settings.theme === "light"}">Light</button></div></div>`;
  h += `<h2>Vault setup</h2>${setupGuide("runway100")}${setupGuide("runway150")}`;
  h += `<h2>Your data</h2><div class="card"><div class="small muted" style="margin-bottom:10px">The app lives on the sensor and needs no internet. Runs are saved on this phone (${runs.length} runs, ${(used / 1024).toFixed(0)} KB). Export a backup now and then, and to move runs to another phone.</div>
    <div class="row"><button class="btn" data-act="export">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json,.json" class="hidden"></label></div></div>
    <div class="card"><div class="small muted" style="margin-bottom:10px">Try the app without the sensor: adds a demo athlete with two weeks of simulated sprints and jumps.</div><button class="btn" data-act="demo-data">Add demo data</button> <button class="btn danger" data-act="clear-all">Delete all runs</button></div>`;
  h += `<p class="small muted" style="text-align:center;margin-top:20px">PAYTON'S LiDAR SENSOR · designed by Payton Pitts</p>`;
  return h;
}
function athleteFormHTML(id) {
  const a = id ? athletes.find((x) => x.id === id) : { name: "", kg: null };
  const w = a.kg ? (settings.weightUnit === "lb" ? Math.round(a.kg / 0.453592) : a.kg.toFixed(1)) : "";
  return `<button class="btn sm" data-act="back">‹ Back</button><h1 style="margin-top:10px">${id ? "Edit athlete" : "Add athlete"}</h1>
    <div class="card"><div class="field"><label for="athName">Name</label><input type="text" id="athName" value="${esc(a.name)}" autocomplete="off"></div>
    <div class="field"><label for="athW">Body weight (${settings.weightUnit}) · optional, used for force and power</label><input type="number" id="athW" inputmode="decimal" value="${w}"></div>
    <div class="row"><button class="btn primary" data-act="ath-save" data-id="${id || ""}">Save</button>${id ? `<button class="btn danger" data-act="ath-del" data-id="${id}">Delete athlete</button>` : ""}</div></div>`;
}

// ---------------- render ----------------
let backStack = [];
function render() {
  const app = $("#app");
  const html = view === "home" ? homeHTML() : view === "new" ? newHTML() : view === "run" ? runHTML(viewArg) : view === "sessions" ? sessionsHTML() : view === "session" ? sessionHTML(viewArg)
    : view === "compare" ? compareHTML() : view === "analytics" ? analyticsHTML() : view === "settings" ? settingsHTML() : view === "athlete" ? athleteFormHTML(viewArg) : homeHTML();
  app.innerHTML = html;
  lcDrawAll(); liveDraw(); LC = Object.fromEntries(Object.entries(LC).filter(([k]) => document.querySelector(`[data-lc="${k}"]`)));
  const tab = { home: "home", new: "new", run: "sessions", sessions: "sessions", session: "sessions", compare: "analytics", analytics: "analytics", settings: "settings", athlete: "settings" }[view];
  document.querySelectorAll(".tabbar [data-go]").forEach((b) => (b.dataset.go === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  const sw = $("#soloSw"); if (sw) sw.onchange = () => { settings.solo = sw.checked; saveSettings(); if (sw.checked) unlockAudio(); };
  const vs = $("#voiceSw"); if (vs) vs.onchange = () => { settings.voice = vs.checked; saveSettings(); unlockAudio(); if (vs.checked) say("Voice on"); };
  const ct = $("#customTarget"); if (ct) ct.onchange = () => { const v = parseInt(ct.value, 10); if (v >= 5 && v <= 80) { cap.target = v; settings.lastTarget = v; saveSettings(); render(); } };
  const imp = $("#importFile"); if (imp) imp.onchange = () => importBackup(imp.files[0]);
}
function nav(v, arg) { backStack.push([view, viewArg]); go(v, arg); }
function back() { const p = backStack.pop(); if (p) go(p[0], p[1]); else go("home"); }

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (g) { backStack = []; if (g.dataset.go === "new") unlockAudio(); go(g.dataset.go); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
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
    case "session-report": if (cap.session) openSessionReport(cap.session.ids); break;
    case "cap-mode": cap.mode = v; settings.lastMode = v; saveSettings(); render(); break;
    case "cap-target": cap.target = +v; settings.lastTarget = +v; saveSettings(); render(); break;
    case "cap-setup": cap.setup = v; settings.lastSetup = v; saveSettings(); render(); break;
    case "cap-ready": unlockAudio(); cap.lastRun = null; if (!cap.queue.includes(cap.athleteId)) cap.athleteId = cap.queue[0]; if (!cap.session) { cap.session = { start: Date.now(), ids: [] }; saveSession(); } arm(); break;
    case "cap-cancel": stopNow(); cap.phase = "setup"; cap.sim = null; render(); break;
    case "cap-stop": if (cap.sim) { cap.sim = null; arm(); break; } stopNow().then(() => { if (cap.phase === "recording") download(); else arm(); }); break;
    case "cap-sim": simulateRun(); break;
    case "cap-sim-in": toReady(); break;
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
    case "an-ath": anState.athleteId = id; if (!runs.some((r) => r.athleteId === id && testKey(r) === anState.test)) anState.test = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); break;
    case "mid-out": settings.midOut = +v; saveSettings(); render(); break;
    case "an-test": anState.test = v; anState.cmp = null; render(); break;
    case "an-cmp": { const s = anState.cmp || [], i = s.indexOf(id); if (i >= 0) { if (s.length > 1) s.splice(i, 1); } else if (s.length >= 4) toast("Up to four athletes on the chart."); else s.push(id); anState.cmp = s; render(); break; }
    case "ath-new": nav("athlete", null); break;
    case "ath-edit": nav("athlete", id); break;
    case "ath-save": {
      const name = $("#athName").value.trim(); if (!name) { toast("Add a name first."); return; }
      const wv = parseFloat($("#athW").value), kg = isFinite(wv) && wv > 0 ? (settings.weightUnit === "lb" ? wv * 0.453592 : wv) : null;
      if (id) Object.assign(athletes.find((a) => a.id === id), { name, kg }); else { const a = { id: uid(), name, kg }; athletes.push(a); cap.athleteId = a.id; settings.lastAthlete = a.id; saveSettings(); }
      saveAthletes(); toast("Saved"); back(); break;
    }
    case "ath-del": if (el.dataset.confirm === "1") { athletes = athletes.filter((a) => a.id !== id); saveAthletes(); toast("Athlete removed (their runs are kept)"); back(); } else { el.dataset.confirm = "1"; el.textContent = "Tap again to delete"; } break;
    case "unit": settings.weightUnit = v; saveSettings(); render(); break;
    case "theme": settings.theme = v || null; saveSettings(); if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme"); render(); break;
    case "export": exportBackup(); break;
    case "demo-data": addDemoData(); break;
    case "clear-all": if (el.dataset.confirm === "1") { runs = []; compareSel = []; saveRuns(); toast("All runs deleted"); render(); } else { el.dataset.confirm = "1"; el.textContent = "Tap again to delete all runs"; } break;
  }
});

// ---------------- backup ----------------
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: "paytons-lidar-sensor", v: 1, athletes, runs, settings }, null, 0)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `lidar-backup-${dayKey(Date.now())}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function importBackup(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result); if (!j.runs || !j.athletes) throw 0;
      const haveA = new Set(athletes.map((a) => a.id)), haveR = new Set(runs.map((r) => r.id));
      athletes = athletes.concat(j.athletes.filter((a) => !haveA.has(a.id))); runs = runs.concat(j.runs.filter((r) => !haveR.has(r.id))).sort((a, b) => b.ts - a.ts);
      saveAthletes(); saveRuns(); toast(`Imported ${j.runs.length} runs`); render();
    } catch (e) { toast("That file isn't a backup from this app."); }
  };
  fr.readAsText(file);
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
        if (!res.error) runs.push({ id: uid(), ts, athleteId: a.id, mode: "sprint", target: 30, res });
        const setup = ["runway100", "runway150", "polerun"][(day / 3 + rep) % 3 | 0];
        const steps = setup === "runway150" ? 19 + (rep % 2) : 15 + (rep % 2);
        const carry = 0.55 + (name.endsWith("2") ? 0.25 : 0) + Math.random() * 0.2;
        const sv = Engine.simulate({ seed: Math.floor(Math.random() * 1e6) + 1, vmax: vmax - carry, steps, back: 2.5 });
        const ctx = { mode: "vault", setup, mass: a.kg };
        if (setup !== "polerun") {
          const probe = Engine.process(sv.raw, ctx), box = SETUPS[setup].boxFt * FT;
          if (!probe.error) { const shift = Math.round((box - (11 + Math.random() * 2.5) * FT - 0.5 - probe.takeoff.sensor) * 100); sv.raw.d = sv.raw.d.map((cm) => (cm > 0 ? Math.max(1, cm + shift) : cm)); }
        }
        const rv = Engine.process(sv.raw, ctx);
        if (!rv.error) runs.push({ id: uid(), ts: ts + 300e3, athleteId: a.id, mode: "vault", setup, res: rv });
      }
    }
  }
  saveAthletes(); runs.sort((x, y) => y.ts - x.ts); saveRuns(); toast("Demo data added"); render();
}

// ---------------- printable report ----------------
/*__REPORT__*/

// ---------------- start ----------------
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
render(); pollLoop();
})();
// ===== APP END =====
