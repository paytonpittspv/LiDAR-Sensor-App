const INK = "#1d1838", INK2 = "#5b5680", RULE = "#e3dff0", ACC = "#e0147a", ACC2 = "#7444e8", ACC3 = "#0f8fd6";
const LOGO = `<svg class="mark" viewBox="0 0 46 30"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="${ACC}"/><stop offset=".5" stop-color="${ACC2}"/><stop offset="1" stop-color="${ACC3}"/></linearGradient></defs>
  <path d="M2 26 L20 4 L26 12 L44 2 L44 9 L27 19 L21 12 L8 28 Z" fill="url(#lg)"/><circle cx="40" cy="24" r="4" fill="${INK}"/></svg>`;
function brandBlock(right) {
  return `<div class="between" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid ${RULE}">
    <div class="logo">${LOGO}<div><div class="name">PAYTON'S <b>LiDAR</b> SENSOR</div><div class="tagline">LASER SPEED · TF03 LiDAR · DESIGNED BY PAYTON PITTS</div></div></div>
    <div style="text-align:right;color:${INK2};font-size:12.5px;line-height:1.6">${right}</div></div>`;
}
function footer(page, pages) {
  return `<div class="foot"><div class="logo" style="gap:8px">${LOGO.replace('class="mark"', 'class="mark" style="width:30px;height:20px"')}<div><b>PAYTON'S LiDAR SENSOR</b><div style="color:${INK2}">Tampa, FL</div></div></div>
    <div style="text-align:right"><b>Payton Pitts</b><div style="color:${INK2}">Designer · USF Track &amp; Field</div></div></div>
    <div class="fine"><span>LiDAR Sensor app · Benewake TF03 · 1000 readings per second</span><span>Page ${page} of ${pages}</span></div>`;
}
const B = (x) => `<b>${x}</b>`;
function speedTimeSVG(run) {
  const R = run.res, c = run.res.curve, T = run.mode === "sprint" ? R.time : R.approachTime;
  const x1 = Math.ceil((T + 0.3) * 2) / 2, ymax = Math.ceil(R.top.speed + 1.5);
  const vlines = [{ x: 0, label: "Start", label2: "0.00 s", color: INK }], segs = [], dots = [];
  if (run.mode === "sprint") for (const s of R.splits) {
    vlines.push({ x: s.at, label: `${s.to} m`, label2: `${f2(s.at)} s`, color: INK });
    const t0 = s.at - s.time; segs.push({ x0: t0, x1: s.at, y: s.speed, color: "#8e89ad", w: 1.3 });
    dots.push({ x: t0 + s.time / 2, y: s.speed, r: 4.5, fill: "#fff", stroke: INK, sw: 2, label: f2(s.speed), dy: 17, tcolor: INK, mono: true });
  }
  else vlines.push({ x: R.takeoff.t, label: "Takeoff", label2: `${f2(R.takeoff.t)} s`, color: INK });
  return svgChart({
    aria: "Speed over time", w: 730, h: 205, pad: [44, 12, 34, 40], x0: 0, x1, y0: 0, y1: ymax, font: 11,
    xt: niceTicks(0.5, x1, 9).filter((t) => t > 0), yt: niceTicks(0, ymax, 5), xl: "Time (s)", yl: "Speed (m/s)",
    textColor: INK2, gridColor: "#efecf6", shades: [{ a: T, b: x1, color: "#d9d6e4", op: 0.5 }],
    vlines, segs, dots, extra: topMark(R.top.t, R.top.speed, `Top ${f2(R.top.speed)} m/s at ${f1(R.top.dist)} m`),
    series: cutSeries(c.t, c.vr, c.v, T),
  });
}
// one smoothed line with a soft fill; raw readings faint grey; stops at the finish / takeoff
function cutSeries(xs, raw, sm, end) {
  let k = xs.findIndex((x) => x > end + 1e-6); if (k < 0) k = xs.length;
  return [{ x: xs.slice(0, k), y: raw.slice(0, k), color: "#b6b1cc", w: 0.9, op: 0.9 }, { x: xs.slice(0, k), y: sm.slice(0, k), color: ACC, w: 2.6, fill: true, fillOp: 0.26 }];
}
function topMark(x, y, label) {
  return (X, Y) => { const px = X(x), py = Y(y), tw = label.length * 5.9 + 16, bx = Math.max(46, Math.min(px - 8 - tw, px - tw / 2));
    return `<line x1="${px}" x2="${px}" y1="${py - 4}" y2="${Y(0)}" stroke="${INK}" stroke-opacity=".6" stroke-dasharray="4 3"/><circle cx="${px}" cy="${py}" r="4.5" fill="#fff" stroke="${ACC}" stroke-width="2.2"/>
      <rect x="${bx}" y="${py + 34}" width="${tw}" height="19" rx="9.5" fill="#fff" stroke="#dcd6f3"/><text x="${bx + tw / 2}" y="${py + 47}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">${label}</text>`; };
}
function legend(items) { return `<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11.5px;color:${INK2};margin-top:4px">${items.map(([sw, t]) => `<span>${sw} ${t}</span>`).join("")}</div>`; }
const SW_LINE = (c, w = 3) => `<svg width="18" height="8" style="display:inline;vertical-align:middle;width:18px"><line x1="0" x2="18" y1="4" y2="4" stroke="${c}" stroke-width="${w}"/></svg>`;
const SW_DOT = `<svg width="12" height="12" style="display:inline;vertical-align:middle;width:12px"><circle cx="6" cy="6" r="4" fill="#fff" stroke="${INK}" stroke-width="2"/></svg>`;

// how sure the numbers are: TF03 ±10 cm (under 10 m) / ±1% (beyond), plus timing; checked on simulated runs
const UNC = "±0.03 s · ±0.1 m/s";
function bestVaultCarry(run) {
  // best last-5 m into takeoff for the same athlete, to compare with sprint top speed
  const v = (typeof runs !== "undefined" ? runs : []).filter((r) => r.athleteId === run.athleteId && r.mode === "vault" && r.res && r.res.last5 && !r.res.error);
  if (!v.length) return null;
  const b = v.reduce((p, q) => (q.res.last5.speed > p.res.last5.speed ? q : p));
  return { speed: b.res.last5.speed, ts: b.ts, n: v.length };
}
function sprintSummary(run, name) {
  const R = run.res, T = run.target, first = esc(name.split(" ")[0]), out = [], rc = R.reach || {};
  out.push(`${first} reached a top speed of ${B(f2(R.top.speed) + " m/s")} (${f1(mph(R.top.speed))} mph) at ${f1(R.top.dist)} m.`);
  if (R.fly10) out.push(`The fastest flying 10 m was ${B(`${f2(R.fly10.time)} s`)}, from ${f1(R.fly10.from)} to ${f1(R.fly10.to)} m (${f2(R.fly10.speed)} m/s).`);
  if (R.stride) out.push(`At top speed: about ${B(f2(R.stride.freq) + " steps/s")} and ${B(f2(R.stride.length) + " m")} per step.` + (rc[98] != null ? ` 98% of top speed by ${f1(rc[98])} m.` : ""));
  const carry = bestVaultCarry(run);
  if (carry) out.push(`Best last 5 m on the runway is ${f2(carry.speed)} m/s, ${Math.round((carry.speed / R.top.speed) * 100)}% of this sprint top speed.`);
  else out.push(`${T} m time ${f2(R.time)} s, average ${f2(R.avgSpeed)} m/s.`);
  let next;
  if (R.top.dist > T - 3) next = `Top speed came at ${f1(R.top.dist)} m, right at the line, so it is probably still rising. Test a longer run${T < 40 ? ` (${T < 30 ? 30 : 40} m)` : ""} or a flying 20 m with a longer build-up to find the real max.`;
  else { const sp = R.splits, l = sp[sp.length - 1], b = Math.max(...sp.map((s) => s.speed));
    next = l && l.speed < 0.98 * b ? `Top speed came at ${f1(R.top.dist)} m and the last split slowed. Keep max-speed reps short with full rest, so every rep is at top speed.`
      : `Top speed was reached and held. Repeat this test every 2–3 weeks; the number to beat is ${f2(R.top.speed)} m/s (flying 10 m ${R.fly10 ? f2(R.fly10.time) + " s" : "—"}).`; }
  return { bullets: out, next };
}
// build-up bar: where the athlete hit 90 / 95 / 98% of top speed along the test
function reachSVG(run) {
  const R = run.res, T = run.target, rc = R.reach || {}, W = 330, pl = 8, pr = 8, X = (d) => pl + (d / T) * (W - pl - pr);
  let s = `<svg viewBox="0 0 ${W} 74" width="100%" role="img" aria-label="Speed build-up"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="${ACC3}" stop-opacity=".25"/><stop offset="1" stop-color="${ACC}" stop-opacity=".9"/></linearGradient></defs>`;
  s += `<rect x="${pl}" y="30" width="${W - pl - pr}" height="12" rx="6" fill="#eeebf6"/><rect x="${pl}" y="30" width="${X(R.top.dist) - pl}" height="12" rx="6" fill="url(#rg)"/>`;
  const marks = [[90, rc[90]], [95, rc[95]], [98, rc[98]]].filter(([, d]) => d != null);
  marks.forEach(([p, d], i) => { s += `<line x1="${X(d)}" x2="${X(d)}" y1="26" y2="46" stroke="${INK}" stroke-width="1.5"/><text x="${X(d)}" y="${i % 2 ? 60 : 20}" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">${p}% · ${f1(d)} m</text>`; });
  s += `<circle cx="${X(R.top.dist)}" cy="36" r="6" fill="#fff" stroke="${ACC}" stroke-width="2.5"/>`;
  s += `<text x="${pl}" y="72" font-size="9.5" fill="${INK2}">0 m</text><text x="${W - pr}" y="72" text-anchor="end" font-size="9.5" fill="${INK2}">${T} m</text></svg>`;
  return s;
}
function sprintReport(run) {
  const R = run.res, a = athleteById(run.athleteId), T = run.target, d = new Date(run.ts), fv = R.fv, rc = R.reach || {};
  const when = `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${timeLabel(run.ts)}`;
  const cum = (x) => (x === T ? R.time : R.cum[x]);
  const sum = sprintSummary(run, a.name), carry = bestVaultCarry(run);
  const m = (k, v, u, sub, cls) => `<div class="m ${cls || ""}"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div>${sub ? `<div class="k" style="margin-top:2px">${sub}</div>` : ""}</div>`;
  const powerV = fv ? (fv.P0abs ? Math.round(fv.P0abs) : f1(fv.P0)) : "—", powerU = fv ? (fv.P0abs ? "W" : "W/kg") : "";
  const powerSub = fv ? (fv.P0abs ? `${f1(fv.P0)} W/kg · peak horizontal` : "add body weight for watts") : "needs about 20 m";
  const head = (title) => `<div class="rhead"><span>LiDAR SENSOR</span><span>${title}</span></div>`;
  const PAGES = 3;
  let p1 = `<div class="page">${head("SPRINT REPORT")}
    <div class="box btop">${brandBlock(`Sprint report<br>TF03 LiDAR · ${R.rate} Hz · <b style="color:${INK}">${UNC}</b>`)}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;gap:12px;flex-wrap:wrap">
      <div><div class="eyebrow">MAX VELOCITY · ${T} M SPRINT</div><div class="who">${esc(a.name)}</div></div>
      <div style="color:${INK2};font-size:13px">${when}${a.kg ? ` &nbsp; Body weight <b style="color:${INK}">${a.kg.toFixed(1)} kg</b>` : ""} &nbsp; TF03 LiDAR · ${R.rate} Hz · ${UNC}</div></div>
    <div class="metrics m5">
      <div class="m hero"><div class="k">${T} m time</div><div class="v">${f2(R.time)}<small style="font-size:20px">s</small></div><div class="k">Start triggered at ${R.start.threshold.toFixed(3)} m/s</div></div>
      ${m("Top speed", f2(R.top.speed), "m/s", `${f1(mph(R.top.speed))} mph · fastest stride`, "r1 hl")}
      ${m("Distance to top speed", f1(R.top.dist), "m", rc[95] != null ? `95% of top by ${f1(rc[95])} m` : "", "r1")}
      ${m("Fastest flying 10 m", R.fly10 ? f2(R.fly10.time) : "—", "s", R.fly10 ? `${f1(R.fly10.from)}–${f1(R.fly10.to)} m · ${f2(R.fly10.speed)} m/s` : "")}
      ${m("Power", powerV, powerU, powerSub)}
    </div></div>
    <div class="box"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,${ACC},${ACC2},${ACC3});display:inline-block"></span><b style="font-size:14px">Summary</b><span style="color:${INK2}">· written by the app from this run</span></div>
      <ul class="sum">${sum.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
      <div class="next"><b>NEXT SESSION</b>${sum.next}</div></div>
    <div class="box"><h4>Speed over time</h4>${speedTimeSVG(run)}
      ${legend([[SW_LINE(ACC), "Speed"], [SW_LINE("#b6b1cc", 1.5), "Raw readings"], [`<b style="color:${INK}">┆</b>`, "Top speed"], [SW_DOT, "Average speed in each 5 m split"], [`<b style="color:${INK}">|</b>`, "5 m split times"]])}</div>
    ${footer(1, PAGES)}</div>`;

  // ---- page 2: splits + top-speed profile ----
  const maxS = Math.max(...R.splits.map((s) => s.speed)), bestI = R.splits.findIndex((s) => s.speed === maxS);
  const tile = (k, v, hl) => `<div class="tile ${hl ? "hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const tiles = [];
  if (R.fly10) tiles.push(tile(`Flying 10 m (${f1(R.fly10.from)}–${f1(R.fly10.to)} m)`, `${f2(R.fly10.time)} s`, true));
  for (const x of [10, 20, 30, 40]) if (x <= T && x !== T) tiles.push(tile(`0–${x} m`, `${f2(cum(x))} s`));
  tiles.push(tile(`0–${T} m`, `${f2(R.time)} s`));
  const ceil = fv ? R.top.speed / fv.V0 : null;
  const big = (k, v, u, sub, acc) => `<div class="${acc ? "acc" : ""}"><div class="k" style="color:${INK2}">${k}</div><div class="v">${v}<small style="font-size:11px"> ${u}</small></div><div style="color:${INK2};font-size:11px">${sub}</div></div>`;
  const profile = `
    <div class="fvtop">
      ${big("Top speed", f2(R.top.speed), "m/s", `${f1(mph(R.top.speed))} mph`, true)}
      ${big("Step rate", R.stride ? f2(R.stride.freq) : "—", "/s", R.stride ? "steps per second" : "steps not clear")}
      ${big("Step length", R.stride ? f2(R.stride.length) : "—", "m", R.stride ? "per step" : "")}
    </div>
    <div style="font-size:11px;color:${INK2};margin-top:6px">Step rate and length are estimates, taken at top speed. Top speed = step rate × step length${R.stride ? ` (${f2(R.stride.freq)} × ${f2(R.stride.length)} = ${f2(R.stride.freq * R.stride.length)} m/s)` : ""}. When top speed goes up, check which of the two moved.</div>
    <div style="margin-top:12px"><div class="k" style="font-size:11px;color:${INK2};margin-bottom:2px">SPEED BUILD-UP: WHERE YOU HIT 90 / 95 / 98% OF TOP SPEED</div>${reachSVG(run)}</div>
    <div class="kv">
      <div>Ceiling (speed the curve was heading for)</div><div>${fv ? `${f2(fv.V0)} m/s` : "—"}</div>
      <div>Top speed as % of ceiling</div><div>${ceil ? Math.round(ceil * 100) + "%" : "—"}</div>
      <div>Best last 5 m on the runway</div><div>${carry ? `${f2(carry.speed)} m/s` : "no vault runs yet"}</div>
      <div>Runway speed as % of sprint top speed</div><div>${carry ? Math.round((carry.speed / R.top.speed) * 100) + "%" : "—"}</div>
    </div>`;
  let p2 = `<div class="page">${head("SPRINT REPORT")}<div class="two">
    <div class="box"><h4>Splits</h4><div class="splitrow" style="color:${INK2};font-size:10.5px;letter-spacing:1px"><span>SEGMENT</span><span>AVERAGE SPEED</span><span></span><span style="text-align:right">TIME</span></div>
      ${R.splits.map((s, i) => `<div class="splitrow ${i === bestI ? "best" : ""}"><b>${s.from}–${s.to} m</b><div class="barbg"><i style="width:${((s.speed / (maxS * 1.1)) * 100).toFixed(1)}%"></i></div><span class="sp">${f2(s.speed)} m/s</span><span class="tm">${f2(s.time)} s</span></div>`).join("")}
      <div class="tiles">${tiles.join("")}</div></div>
    <div class="box"><h4>Top-speed profile</h4>${profile}</div></div>
    <div class="box"><h4>What these numbers mean for your top speed</h4>
      <div class="guide">
        <div><b>Top speed</b><p>The fastest single stride in the run. In the vault this is the number that matters most: the faster you can run, the faster you can arrive at the plant. Test it every 2–3 weeks with full rest between reps, and follow the trend in Analytics.</p></div>
        <div><b>Fastest flying 10 m</b><p>The steadiest way to test max speed, since it doesn't depend on the start. Build up for 20–30 m, then sprint 10 m. Take the best of 2–3 reps. Every 0.01 s off a flying 10 m is about 0.07–0.08 m/s more speed.</p></div>
        <div><b>Distance to top speed</b><p>How much run-up you need to reach your max. If you hit 98% by 25 m, a shorter approach means you plant before you're at full speed. The fixed 100 ft and 150 ft setups show how much of this speed you keep on the runway with a pole.</p></div>
        <div><b>Step rate × step length</b><p>The only two ways to run faster. Watch which one rises when top speed improves. Step length comes from force into the ground at speed (strength, bounding, stiff ankles). Step rate comes from quick ground contacts and a fast leg swing.</p></div>
        <div><b>Ceiling</b><p>The top speed the speed curve was heading toward. If your top speed is under about 97% of the ceiling, the test was too short to show your real max. Run a longer one.</p></div>
        <div><b>Runway %</b><p>How much of your sprint speed you carry into the last 5 m with the pole. Around 90–95% is a common range. If it's low, the pole carry and run-up rhythm are costing you speed, not your sprinting.</p></div>
      </div></div>
    ${footer(2, PAGES)}</div>`;

  // ---- page 3: all parameters ----
  const P = (k, abs, rel) => `<tr><td>${k}</td><td>${abs}</td><td>${rel}</td></tr>`;
  const sect = (t) => `<tr class="sect"><td colspan="3">${t}</td></tr>`;
  const left = sect("MAX VELOCITY") + P("Top speed (fastest stride)", `${f2(R.top.speed)} m/s`, `${f1(mph(R.top.speed))} mph`) + P("Distance to top speed", `${f1(R.top.dist)} m`, "–") + P("Time to top speed", `${f2(R.top.t)} s`, "–")
    + (R.fly10 ? P("Fastest flying 10 m: time", `${f2(R.fly10.time)} s`, "–") + P("Fastest flying 10 m: speed", `${f2(R.fly10.speed)} m/s`, "–") + P("Fastest flying 10 m: from", `${f1(R.fly10.from)} m`, "–") : "")
    + P("Reached 90 / 95 / 98%", [90, 95, 98].map((p) => (rc[p] != null ? f1(rc[p]) : "–")).join(" / ") + " m", "–")
    + (R.stride ? P("Step rate at top speed", `${f2(R.stride.freq)} steps/s`, "estimate") + P("Step length at top speed", `${f2(R.stride.length)} m`, "estimate") : "")
    + (fv ? P("Ceiling (V0)", `${f2(fv.V0)} m/s`, `${Math.round(ceil * 100)}% reached`) : "")
    + sect("TEST") + P(`${T} m time`, `${f2(R.time)} s`, "–") + P("Average speed", `${f2(R.avgSpeed)} m/s`, "–") + P("Starting threshold", `${R.start.threshold.toFixed(3)} m/s`, "–")
    + P("Body weight", a.kg ? `${a.kg.toFixed(1)} kg` : "–", "–") + P("Readings per second", `${R.rate}`, "–");
  const right = (fv ? sect("POWER AND FORCE") + P("Power (P0)", fv.P0abs ? `${Math.round(fv.P0abs)} W` : "–", `${f1(fv.P0)} W/kg`) + P("Peak horizontal power", fv.peakPower ? `${Math.round(fv.peakPower)} W` : "–", `${f1(fv.peakPowerKg)} W/kg`)
      + P("Mean horizontal power", fv.meanPower ? `${Math.round(fv.meanPower)} W` : "–", `${f1(fv.meanPowerKg)} W/kg`) + P("Start force (F0)", fv.F0abs ? `${Math.round(fv.F0abs)} N` : "–", `${f2(fv.F0)} N/kg`)
      + P("Force–velocity slope", fv.slope.toFixed(4), "–") : "")
    + sect("ACCELERATION (LESS IMPORTANT FOR VAULT)") + P("Peak acceleration", `${f2(R.accel.peak)} m/s²`, "–") + P("Mean acceleration to top speed", `${f2(R.accel.mean)} m/s²`, "–")
    + sect("SPLITS") + R.splits.map((s) => P(`${s.from}–${s.to} m`, `${f2(s.time)} s`, `${f2(s.speed)} m/s`)).join("");
  const thead = `<thead><tr><th style="text-align:left">PARAMETER</th><th>VALUE</th><th>ALSO</th></tr></thead>`;
  let p3 = `<div class="page">${head("SPRINT REPORT")}
    <div class="box"><h4>All parameters</h4><div class="two"><table>${thead}<tbody>${left}</tbody></table><table>${thead}<tbody>${right}</tbody></table></div></div>
    <div class="box"><h4>How accurate is this?</h4><div class="guide g2">
      <div><b>Times: ${UNC.split(" · ")[0]}</b><p>The TF03 measures distance to within about 10 cm up close and 1% farther out, 1000 times a second. At sprint speed, 10 cm is about 0.01 s. Times start when speed passes ${R.start.threshold} m/s, so the reaction to a start signal isn't included.</p></div>
      <div><b>Speeds: ${UNC.split(" · ")[1]}</b><p>Speed comes from one smoothed distance line, averaged over each stride, so a single noisy reading can't set a top speed. Splits and the speed curve come from the same line. Step rate and length are estimates from the small speed dip at each foot contact.</p></div>
      <div><b>Keep it consistent</b><p>Same tripod height (lower back), aimed straight down the lane, same surface and shoes. Compare tests run the same way.</p></div>
<div><b>Power</b><p>Peak horizontal push, which comes mostly from the first few steps. Acceleration doesn't decide a vault approach, so use it only to check that strength work is carrying over to the track.</p></div>
      <div><b>Checked so far</b><p>These limits come from the sensor's spec and from simulated runs. Check them against timing gates or video once real runs are recorded.</p></div>
    </div></div>
    ${footer(3, PAGES)}</div>`;
  return p1 + p2 + p3;
}

function bestSprintTop(run) {
  const s = (typeof runs !== "undefined" ? runs : []).filter((r) => r.athleteId === run.athleteId && r.mode === "sprint" && r.res && !r.res.error && r.res.top);
  if (!s.length) return null;
  const b = s.reduce((p, q) => (q.res.top.speed > p.res.top.speed ? q : p));
  return { speed: b.res.top.speed, ts: b.ts };
}
// every contact found, counted back from the takeoff (a left)
function vaultSteps(R, run) {
  const cs = contactsOf(run), box = hasBox(run), out = [];
  const to = cs.length ? spotFt(run, cs[cs.length - 1]) : 0;
  cs.forEach((c, i) => {
    const spot = spotFt(run, c), kk = Math.max(0, R.curve.t.findIndex((x) => x >= c.t));
    out.push({ i, left: c.left, num: c.n, t: c.t, dt: i ? c.t - cs[i - 1].t : null, spot, ft: Math.abs(box ? spot - to : to - spot), speed: c.v != null ? c.v : R.curve.v[kk], takeoff: c.takeoff });
  });
  out.forEach((s, i) => { s.lenFt = i ? Math.abs(out[i - 1].spot - s.spot) : null; });
  return out;
}
function vaultSummary(run, name) {
  const R = run.res, first = esc(name.split(" ")[0]), c = changeTag(R), out = [], sp = bestSprintTop(run);
  out.push(`${first}'s last 5 m into takeoff was ${B(f2(R.last5 && R.last5.speed) + " m/s")}` + (c ? `, ${c.text.toLowerCase()} compared with the 5 m before it (${f2(R.prev5.speed)} m/s).` : "."));
  const fz = finishTag(R);
  if (fz) out.push(`Into the box: ${B(fz.value + " m/s")}, ${fz.text.toLowerCase()} over the last half second before the plant.`);
  out.push(`Top speed on the runway was ${B(f2(R.top.speed) + " m/s")}` + (sp ? `, ${Math.round((R.top.speed / sp.speed) * 100)}% of the best sprint top speed (${f2(sp.speed)} m/s).` : ". Run a sprint test to see how much of your max speed you carry."));
  if (R.steps.counted) out.push(`${B(R.steps.lefts + " lefts")} (${R.steps.counted} steps), counted back from the takeoff.`);
  // the next-session tip follows the last half second before the plant (falls back to the last 5 m vs the 5 m before)
  const fz2 = finishTag(R), k = fz2 ? fz2.cls : c ? c.cls : "flat";
  const next = k === "down" ? "Speed dropped right before the plant. Keep the rhythm up through the last two lefts (quick, not reaching) so the pole hits the box at full speed."
    : k === "up" ? "Still speeding up into the box: good. Keep the takeoff spot the same as speed rises, and check the mid mark stays put."
    : "Speed held into the box. Keep the same run-up and compare the next jumps against this one.";
  return { bullets: out, next };
}
// speed into takeoff, x in feet before takeoff, every left labelled with its number, distance and speed
function vaultChartSVG(run, steps) {
  const boxed = hasBox(run);
  const R = run.res, cv = R.curve, xs = cv.d.map((x) => (x - R.takeoff.dist) / FT);
  const first = steps.length ? -steps[0].ft : xs[0];
  const x0 = Math.max(-140, Math.floor((Math.min(first, xs.find((x) => x > -999)) - 4) / 10) * 10), ymax = Math.ceil(R.top.speed + 2.5);
  const lefts = steps.filter((s) => s.left);
  // left tags sit in their own row under the axis (never on the curve); a second row only if two lefts are too close
  const W = 730, pl = 38, pr = 16, pxFt = (W - pl - pr) / (3 - x0), row = [];
  lefts.forEach((p, i) => { row.push(i && row[i - 1] === 0 && (lefts[i - 1].ft - p.ft) * pxFt < 40 ? 1 : 0); });
  const rows = row.some((x) => x) ? 2 : 1, tagH = 30, strip = 8 + rows * (tagH + 4);
  return svgChart({ aria: "Speed into the takeoff", w: W, h: 150 + strip, pad: [pl, pr, 30, 22 + strip], x0, x1: 3, y0: 0, y1: ymax, font: 11, textColor: INK2, gridColor: "#efecf6",
    xt: [], yt: niceTicks(0, ymax, 5), xl: `Each left: number and ${boxed ? "feet from the box" : "feet from the start"}`, yl: "Speed (m/s)",
    shades: [{ a: -5 / FT, b: 0, color: ACC2, op: 0.12 }], vlines: [{ x: -5 / FT, color: "#8e89ad", dash: "3 3", label: "last 5 m" }],
    series: cutSeries(xs, cv.vr, cv.v, 0),
    extra: (X, Y) => {
      let s = "";
      const yb = Y(0);
      s += `<line x1="${pl}" x2="${W - pr}" y1="${yb}" y2="${yb}" stroke="#8e89ad" stroke-width="1"/>`;
      // rights: small grey dots on the line, so the step length between feet is visible
      for (const p of steps) if (!p.left) s += `<circle cx="${X(-p.ft)}" cy="${Y(p.speed)}" r="2.4" fill="#aaa5c6"/>`;
      lefts.forEach((p, i) => {
        const x = X(-p.ft), y = Y(p.speed), ty = yb + 8 + row[i] * (tagH + 4);
        s += `<line x1="${x}" x2="${x}" y1="${y + 5}" y2="${yb}" stroke="${ACC}" stroke-opacity=".28" stroke-width="1"/>`;
        s += `<line x1="${x}" x2="${x}" y1="${yb}" y2="${yb + 4}" stroke="${ACC}" stroke-width="1.4"/>`;
        s += p.takeoff ? `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${ACC}" stroke-width="1.8"/>` : `<circle cx="${x}" cy="${y}" r="3.6" fill="${ACC}" stroke="#fff" stroke-width="1.2"/>`;
        s += `<text x="${x}" y="${y - 9}" text-anchor="middle" font-size="10" font-weight="600" fill="${INK}">${f2(p.speed)}</text>`;
        s += `<text x="${x}" y="${ty + 9}" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing=".4" fill="${ACC}">${p.takeoff ? "TO" : "L" + p.num}</text>`;
        s += `<text x="${x}" y="${ty + 22}" text-anchor="middle" font-size="10" fill="${INK}">${Math.round(p.spot)}'</text>`;
      });
      return s;
    } });
}
function vaultReport(run) {
  const R = run.res, a = athleteById(run.athleteId), d = new Date(run.ts), c = changeTag(R), fv = R.fv, sp = bestSprintTop(run);
  const when = `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${timeLabel(run.ts)}`;
  const sum = vaultSummary(run, a.name), steps = vaultSteps(R, run), setup = SETUPS[run.setup], ftg = finishTag(R), boxed = hasBox(run);
  const m = (k, v, u, sub, cls) => `<div class="m ${cls || ""}"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div>${sub ? `<div class="k" style="margin-top:2px">${sub}</div>` : ""}</div>`;
  const head = `<div class="rhead"><span>LiDAR SENSOR</span><span>VAULT APPROACH REPORT</span></div>`;
  const powerV = fv ? (fv.P0abs ? Math.round(fv.P0abs) : f1(fv.P0)) : "—", powerU = fv ? (fv.P0abs ? "W" : "W/kg") : "";
  const p1 = `<div class="page">${head}
    <div class="box btop">${brandBlock(`Vault approach report<br>TF03 LiDAR · ${R.rate} Hz · <b style="color:${INK}">${UNC}</b>`)}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;gap:12px;flex-wrap:wrap">
      <div><div class="eyebrow">POLE VAULT · ${setup.name.toUpperCase()}</div><div class="who">${esc(a.name)}</div></div>
      <div style="color:${INK2};font-size:13px">${when} &nbsp; ${setup.detail}</div></div>
    <div class="metrics m7">
      <div class="m hero"><div class="k">Last 5 m into takeoff</div><div class="v">${f2(R.last5 && R.last5.speed)}<small style="font-size:18px">m/s</small></div><div class="k">${R.prev5 ? `5 m before: ${f2(R.prev5.speed)} m/s` : ""}</div>${ftg ? `<div class="intobox ${ftg.cls}"><b>${ftg.value} m/s</b> ${ftg.text.toLowerCase()}<span>last ½ s before the plant</span></div>` : ""}</div>
      ${m("Top speed", f2(R.top.speed), "m/s", sp ? `${Math.round((R.top.speed / sp.speed) * 100)}% of sprint top speed` : `${f1(mph(R.top.speed))} mph`, "hl")}
      ${m("Lefts", R.steps.counted ? R.steps.lefts : "—", "", `${R.steps.counted} steps`)}
      ${boxed ? m("Takeoff ≈", R.takeoff.outFt != null ? ftLabel(R.takeoff.outFt) : "—", "", "out from the box") : m("Takeoff ≈", steps.length ? ftLabel(steps[steps.length - 1].spot) : "—", "", "from the start")}
      ${boxed ? m("Start mark ≈", R.startMarkFt != null ? ftLabel(R.startMarkFt) : "—", "", "from the box") : m("Into the box", ftg ? ftg.value : "—", ftg ? "m/s" : "", ftg ? ftg.text.toLowerCase() : "")}
      ${m("Approach time", f2(R.approachTime), "s", `${f1(R.approachDist / FT)} ft run`)}
      ${m("Power", powerV, powerU, fv ? (fv.P0abs ? `${f1(fv.P0)} W/kg · peak horizontal` : "add body weight for watts") : "run-up too short")}
    </div></div>
    <div class="box"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,${ACC},${ACC2},${ACC3});display:inline-block"></span><b style="font-size:14px">Summary</b><span style="color:${INK2}">· written by the app from this jump</span></div>
      <ul class="sum">${sum.bullets.map((b) => `<li>${b}</li>`).join("")}</ul><div class="next"><b>NEXT SESSION</b>${sum.next}</div></div>
    <div class="box"><h4>Speed into the takeoff</h4>${vaultChartSVG(run, steps)}
      ${legend([[SW_LINE(ACC), "Speed"], [`<span style="color:${ACC};font-weight:600">●</span>`, `Left: speed (m/s) above, feet from the ${hasBox(run) ? "box" : "start"} below`], [`<span style="color:#b9b4d2;font-weight:600">●</span>`, "Right"], [`<span style="display:inline-block;width:14px;height:10px;background:${ACC2};opacity:.25"></span>`, "Last 5 m"]])}</div>
    ${footer(1, 2)}</div>`;

  // ---- page 2 ----
  const rows = steps.map((s) => `<tr class="${s.left ? "lrow" : ""}"><td>${s.i + 1}</td><td>${s.left ? `<b>L${s.num}${s.takeoff ? " · TO" : ""}</b>` : "R"}</td><td><b>${ftLabel(s.spot)}</b></td><td>${s.lenFt != null ? ftLabel(s.lenFt) : "–"}</td><td>${s.dt != null ? f2(s.dt) + " s" : "–"}</td><td><b>${f2(s.speed)}</b></td></tr>`).join("");
  const lefts = steps.filter((s) => s.left), lastL = lefts.slice(-3);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const lenEnd = avg(steps.slice(-6).filter((s) => s.lenFt != null).map((s) => s.lenFt)), lenMid = avg(steps.slice(-12, -6).filter((s) => s.lenFt != null).map((s) => s.lenFt));
  const bar = (k, v, max, color, txt) => `<div class="cbar"><span>${k}</span><div class="barbg"><i style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%;background:${color}"></i></div><b>${txt}</b></div>`;
  const ref = sp ? sp.speed : R.top.speed;
  const carry = `
    ${sp ? bar("Sprint top speed", sp.speed, ref, INK, `${f2(sp.speed)} m/s`) : ""}
    ${bar("Runway top speed", R.top.speed, ref, ACC2, `${f2(R.top.speed)} m/s`)}
    ${R.last5 ? bar("Last 5 m", R.last5.speed, ref, ACC, `${f2(R.last5.speed)} m/s`) : ""}
    <div class="kv" style="margin-top:10px">
      <div>Last 5 m as % of ${sp ? "sprint top speed" : "runway top speed"}</div><div>${R.last5 ? Math.round((R.last5.speed / ref) * 100) + "%" : "—"}</div>
      <div>Speed at the last 3 lefts</div><div>${lastL.map((s) => f2(s.speed)).join(" → ") || "—"}</div>
      <div>Step length: last 6 vs 6 before</div><div>${lenEnd && lenMid ? `${ftLabel(lenEnd)} vs ${ftLabel(lenMid)}` : "—"}</div>
      <div>33 → 16 ft out from the box</div><div>${R.box10to5 ? f2(R.box10to5.speed) + " m/s" : "—"}</div>
    </div>
    ${sp ? "" : `<div style="color:${INK2};font-size:11px;margin-top:6px">Run a sprint test for this athlete to compare runway speed with max speed.</div>`}`;
  const p2 = `<div class="page">${head}
    <div class="vgrid">
      <div class="box"><h4>Step rhythm</h4>${steps.length ? `<table class="rhythm"><thead><tr><th style="text-align:left">#</th><th>Foot</th><th>From ${boxed ? "box" : "start"}</th><th>Step length</th><th>Step time</th><th>Speed (m/s)</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div style="color:${INK2}">The steps weren't clear enough to count on this jump.</div>`}</div>
      <div><div class="box"><h4>Speed you carry to the plant</h4>${carry}</div>
      <div class="box"><h4>Speed at each left</h4>${lefts.map((s) => bar(`${s.takeoff ? "TO" : "L" + s.num} · ${Math.round(s.spot)}'`, s.speed, ref, s.takeoff ? ACC : ACC2, f2(s.speed))).join("")}
        <div style="color:${INK2};font-size:11px;margin-top:4px">Bars are measured against ${sp ? "sprint top speed" : "runway top speed"}. They should keep growing to the takeoff.</div></div></div>
    </div>
    <div class="box"><h4>How to use this as a vaulter</h4><div class="guide">
      <div><b>Last 5 m into takeoff</b><p>The speed you bring to the plant, and the speed the pole has to work with. Faster here, with the same takeoff, means a stiffer pole and a higher grip. This is the number to chase.</p></div>
      <div><b>% of sprint top speed</b><p>How much of your max speed survives the pole carry. If it's low, the run-up is costing you speed: work on carry posture, relaxed arms and a steady rhythm. If it's high, the next jump in speed has to come from sprint training.</p></div>
      <div><b>Speed at each left</b><p>Should keep rising, or at least hold, all the way to takeoff. A dip at the last 2–3 lefts means slowing down to find the box or reaching for the plant.</p></div>
      <div><b>Step length (grey rights in between)</b><p>Steps should get a little shorter and quicker at the end, not longer. Overstriding in the last steps usually shows up as a speed drop into takeoff.</p></div>
      <div><b>Lefts, takeoff and start mark</b><p>The same lefts with a takeoff that keeps moving means the run-up is changing. Use the takeoff distance to move the start mark, and keep the left count the same while speed improves.</p></div>
      <div><b>Run-up length</b><p>The sprint report shows where you reach 98% of top speed. If your approach is shorter than that, you plant before you're at full speed. Add a left if you can still control it.</p></div>
    </div></div>
    ${footer(2, 2)}</div>`;
  return p1 + p2;
}

// ---------- session report: everyone who ran in one session ----------
const SESS_COLORS = ["#e0147a", "#7444e8", "#0f8fd6", "#e08a00", "#13a35f", "#5b5680"];
function sessionReport(list) {
  list = list.slice().sort((a, b) => a.ts - b.ts);
  const t0 = list[0].ts, t1 = list[list.length - 1].ts, d = new Date(t0);
  const when = `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · ${timeLabel(t0)}–${timeLabel(t1)}`;
  const tests = [...new Set(list.map(testKey))], aids = [...new Set(list.map((r) => r.athleteId))];
  const head = `<div class="rhead"><span>LiDAR SENSOR</span><span>SESSION REPORT</span></div>`;
  const sprints = list.filter((r) => r.mode === "sprint"), vaults = list.filter((r) => r.mode === "vault" && r.res.last5);
  const best = (arr, pick) => arr.reduce((p, q) => (!p || pick(q) > pick(p) ? q : p), null);
  const bS = best(sprints, (r) => r.res.top.speed), bV = best(vaults, (r) => r.res.last5.speed);
  const color = (aid) => SESS_COLORS[aids.indexOf(aid) % SESS_COLORS.length];
  const m = (k, v, u, sub, cls) => `<div class="m ${cls || ""}"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div>${sub ? `<div class="k" style="margin-top:2px">${sub}</div>` : ""}</div>`;
  // one row per athlete and test
  let rowsA = "";
  for (const t of tests) for (const aid of aids) {
    const rs = list.filter((r) => r.athleteId === aid && testKey(r) === t); if (!rs.length) continue;
    const name = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color(aid)};margin-right:6px"></span>${esc(athleteById(aid).name)}`;
    if (t.startsWith("sprint")) {
      const top = Math.max(...rs.map((r) => r.res.top.speed)), tm = Math.min(...rs.map((r) => r.res.time)), fl = rs.map((r) => r.res.fly10 && r.res.fly10.time).filter(Boolean);
      rowsA += `<tr><td>${name}</td><td>${testShort(t)}</td><td>${rs.length}</td><td><b>${f2(top)} m/s</b> top speed</td><td>fly 10 ${fl.length ? f2(Math.min(...fl)) + " s" : "–"}</td><td>${f2(tm)} s best time</td><td></td></tr>`;
    } else {
      const v = rs.filter((r) => r.res.last5), l5 = v.length ? Math.max(...v.map((r) => r.res.last5.speed)) : null, top = Math.max(...rs.map((r) => r.res.top.speed));
      const L = rs.map((r) => r.res.steps.lefts).filter(Boolean), TO = rs.map((r) => r.res.takeoff.outFt).filter((x) => x != null);
      rowsA += `<tr><td>${name}</td><td>${testShort(t)}</td><td>${rs.length}</td><td><b>${l5 ? f2(l5) + " m/s" : "–"}</b> last 5 m</td><td>top ${f2(top)} m/s</td><td>${L.length ? (Math.min(...L) === Math.max(...L) ? L[0] : `${Math.min(...L)}–${Math.max(...L)}`) + " lefts" : "–"}</td><td>${TO.length ? ftLabel(TO.reduce((a, b) => a + b, 0) / TO.length) + " avg" : "–"}</td></tr>`;
    }
  }
  // chart: each athlete's best run of the most common test
  const main = tests.map((t) => [t, list.filter((r) => testKey(r) === t).length]).sort((a, b) => b[1] - a[1])[0][0], isS = main.startsWith("sprint");
  const series = [], legendItems = [];
  for (const aid of aids) {
    const rs = list.filter((r) => r.athleteId === aid && testKey(r) === main && (isS || r.res.last5)); if (!rs.length) continue;
    const b = best(rs, (r) => (isS ? r.res.top.speed : r.res.last5.speed)), c = b.res.curve;
    if (isS) { let k = c.d.findIndex((x) => x > b.target); if (k < 0) k = c.d.length; const k0 = Math.max(0, c.t.findIndex((t) => t >= 0)); series.push({ x: c.d.slice(k0, k), y: c.v.slice(k0, k), color: color(aid), w: 2.4 }); }
    else { const xs = c.d.map((x) => (x - b.res.takeoff.dist) / FT); let k = xs.findIndex((x) => x > 0); if (k < 0) k = xs.length; series.push({ x: xs.slice(0, k), y: c.v.slice(0, k), color: color(aid), w: 2.4 }); }
    legendItems.push([SW_LINE(color(aid)), `${esc(athleteById(aid).name)} · ${isS ? f2(b.res.top.speed) + " m/s top" : f2(b.res.last5.speed) + " m/s last 5 m"}`]);
  }
  const ymax = Math.ceil(Math.max(...series.map((s) => Math.max(...s.y))) + 1);
  const xa = isS ? 0 : Math.max(-140, Math.floor(Math.min(...series.map((s) => s.x[0])) / 10) * 10), xb = isS ? Math.max(...list.filter((r) => testKey(r) === main).map((r) => r.target)) : 0;
  const chart = series.length ? svgChart({ aria: "Best runs compared", w: 730, h: 175, pad: [44, 14, 14, 40], x0: xa, x1: xb, y0: 0, y1: ymax, font: 11, textColor: INK2, gridColor: "#efecf6",
    xt: niceTicks(xa, xb, 10), xfmt: (t) => (isS ? `${t} m` : t === 0 ? "takeoff" : `${Math.abs(t)} ft`), yt: niceTicks(0, ymax, 5), xl: isS ? "Distance (m)" : "Distance before takeoff (ft)", yl: "Speed (m/s)",
    shades: isS ? [] : [{ a: -5 / FT, b: 0, color: ACC2, op: 0.1 }], series }) : "";
  const pageRows = 30, all = list.map((r, i) => {
    const R = r.res, a = athleteById(r.athleteId);
    const main = r.mode === "sprint" ? `${f2(R.time)} s` : R.last5 ? `${f2(R.last5.speed)} m/s` : "–";
    const extra = r.mode === "sprint" ? (R.fly10 ? `fly 10 ${f2(R.fly10.time)} s` : "") : [R.steps.counted ? `${R.steps.lefts} lefts` : "", R.takeoff.outFt != null ? `TO ${ftLabel(R.takeoff.outFt)}` : ""].filter(Boolean).join(" · ");
    return `<tr><td>${i + 1}</td><td>${timeLabel(r.ts)}</td><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color(r.athleteId)};margin-right:6px"></span>${esc(a.name)}</td><td>${testShort(testKey(r))}</td><td><b>${main}</b></td><td>${f2(R.top.speed)} m/s</td><td>${extra}</td></tr>`;
  });
  const firstRows = 8, chunks = [all.slice(0, firstRows)]; for (let i = firstRows; i < all.length; i += pageRows) chunks.push(all.slice(i, i + pageRows));
  const P = chunks.length, thead = `<thead><tr><th style="text-align:left">#</th><th style="text-align:left">Time</th><th style="text-align:left">Athlete</th><th style="text-align:left">Test</th><th style="text-align:left">Result</th><th style="text-align:left">Top speed</th><th style="text-align:left">Details</th></tr></thead>`;
  const runsBox = (rows, cont) => `<div class="box"><h4>All runs${cont ? " (continued)" : ""}</h4><table class="srun">${thead}<tbody>${rows.join("")}</tbody></table></div>`;
  let h = `<div class="page">${head}
    <div class="box btop">${brandBlock(`Session report<br>TF03 LiDAR · 1000 Hz · <b style="color:${INK}">${UNC}</b>`)}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;gap:12px;flex-wrap:wrap">
        <div><div class="eyebrow">TRAINING SESSION · ${tests.map(testName).join(" · ").toUpperCase()}</div><div class="who">${aids.length} athlete${aids.length > 1 ? "s" : ""}, ${list.length} run${list.length > 1 ? "s" : ""}</div></div>
        <div style="color:${INK2};font-size:13px">${when}</div></div>
      <div class="metrics" style="grid-template-columns:repeat(4,1fr)">
        ${m("Runs", list.length, "", `${Math.max(1, Math.round((t1 - t0) / 60000))} min`)}
        ${m("Athletes", aids.length, "", aids.slice(0, 3).map((x) => esc(athleteById(x).name.split(" ")[0])).join(", ") + (aids.length > 3 ? "…" : ""))}
        ${m("Fastest top speed", bS ? f2(bS.res.top.speed) : "—", bS ? "m/s" : "", bS ? esc(athleteById(bS.athleteId).name) : "no sprints")}
        ${m("Best last 5 m", bV ? f2(bV.res.last5.speed) : "—", bV ? "m/s" : "", bV ? esc(athleteById(bV.athleteId).name) : "no vault runs")}
      </div></div>
    <div class="box"><h4>Each athlete's best</h4><table class="srun"><thead><tr><th style="text-align:left">Athlete</th><th style="text-align:left">Test</th><th style="text-align:left">Runs</th><th style="text-align:left">Best</th><th style="text-align:left">Also</th><th style="text-align:left"></th><th style="text-align:left"></th></tr></thead><tbody>${rowsA}</tbody></table></div>
    ${series.length ? `<div class="box"><h4>Best ${isS ? "sprint" : "approach"} for each athlete · ${testName(main)}</h4>${chart}${legend(legendItems)}</div>` : ""}
    ${runsBox(chunks[0], false)}
    ${footer(1, P)}</div>`;
  for (let i = 1; i < P; i++) h += `<div class="page">${head}${runsBox(chunks[i], true)}${footer(i + 1, P)}</div>`;
  return h;
}
function openSessionReport(ids) {
  const list = runs.filter((r) => ids.includes(r.id));
  if (!list.length) { toast("No saved runs in this session."); return; }
  const el = $("#report");
  el.innerHTML = `<div class="bar"><button data-rep="close">‹ Close</button><button data-rep="print">Print / Save PDF</button></div>` + sessionReport(list);
  el.classList.remove("hidden"); el.scrollTop = 0;
  const fit = () => { const w = Math.min(1, (window.innerWidth - 16) / 816); el.querySelectorAll(".page").forEach((p) => { p.style.zoom = w < 1 ? w : ""; }); };
  fit(); window.addEventListener("resize", fit, { once: true });
}

// ---------- athlete comparison report: the athletes picked in Analytics, side by side for one test ----------
const CMP_COLORS = [ACC, ACC2, ACC3, "#e08a00"];
function compareStats(aid, test) {
  const isS = test.startsWith("sprint"), km = keyMetric(test);
  const tr = runs.filter((r) => r.athleteId === aid && testKey(r) === test && !r.res.error).sort((a, b) => a.ts - b.ts);
  const vals = tr.map(km.pick).filter((v) => v != null && isFinite(v));
  const o = { aid, name: athleteById(aid).name, tr, n: tr.length, best: bestOf(tr, km.pick, "high"), avg: avgOf(vals), sd: sdOf(vals), first: tr[0], last: tr[tr.length - 1] };
  o.top = bestOf(tr, (r) => r.res.top.speed, "high");
  if (isS) {
    o.fly = bestOf(tr, (r) => r.res.fly10 && r.res.fly10.time, "low"); o.time = bestOf(tr, (r) => r.res.time, "low");
    o.toTop = avgOf(tr.map((r) => r.res.top.dist).filter(isFinite));
    const st = tr.filter((r) => r.res.stride); o.freq = avgOf(st.map((r) => r.res.stride.freq)); o.len = avgOf(st.map((r) => r.res.stride.length));
    const pw = tr.map((r) => r.res.fv && (r.res.fv.P0abs || null)).filter(Boolean); o.power = pw.length ? Math.max(...pw) : null;
  } else {
    const sTop = sprintTopFor(aid); o.sprintTop = sTop ? sTop.v : null; o.carry = sTop && o.avg ? o.avg / sTop.v : null;
    o.lefts = modeOf(tr.map((r) => r.res.steps.lefts).filter(Boolean));
    const TO = tr.map((r) => r.res.takeoff.outFt).filter((x) => x != null), SM = tr.map((r) => r.res.startMarkFt).filter((x) => x != null);
    o.to = avgOf(TO); o.toSd = sdOf(TO); o.sm = avgOf(SM); o.smSd = sdOf(SM);
    const fz = tr.map((r) => r.res.finish && r.res.finish.change).filter((x) => x != null && isFinite(x)); o.into = avgOf(fz); o.slowed = fz.filter((x) => x <= -0.1).length; o.intoN = fz.length;
    // average spot of each left, counted back from the takeoff
    o.leftAvg = {};
    for (let k = 0; k <= 9; k++) { const xs = []; for (const r of tr) { const c = contactsOf(r).find((c) => c.left && c.out === k); if (c) xs.push(spotFt(r, c)); } if (xs.length) o.leftAvg[k] = { ft: avgOf(xs), sd: sdOf(xs), n: xs.length }; }
  }
  return o;
}
function compareReport(test, ids) {
  const isS = test.startsWith("sprint"), km = keyMetric(test), setup = isS ? null : test.split("-")[1];
  const A = ids.map((id) => compareStats(id, test)).filter((o) => o.best).sort((x, y) => y.best.v - x.best.v);
  const col = {}; A.forEach((o, i) => (col[o.aid] = CMP_COLORS[i % CMP_COLORS.length]));
  const all = A.flatMap((o) => o.tr), t0 = Math.min(...all.map((r) => r.ts)), t1 = Math.max(...all.map((r) => r.ts));
  const dfmt = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const head = `<div class="rhead"><span>LiDAR SENSOR</span><span>ATHLETE COMPARISON</span></div>`;
  const dot = (aid, s = 9) => `<span class="cdot" style="width:${s}px;height:${s}px;background:${col[aid]}"></span>`;
  const lead = A[0], lastA = A[A.length - 1], firsts = A.map((o) => o.name.split(" ")[0]);
  const short = (o) => { const f = o.name.split(" ")[0]; return firsts.filter((x) => x === f).length > 1 ? o.name : f; };
  const steady = A.filter((o) => o.sd != null).sort((x, y) => x.sd - y.sd)[0];
  const m = (k, v, u, sub, cls) => `<div class="m ${cls || ""}"><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div>${sub ? `<div class="k" style="margin-top:2px">${sub}</div>` : ""}</div>`;
  const label = isS ? "Top speed" : "Last 5 m into takeoff";
  // ranking: bars start at a floor below the slowest so the gaps are visible, value and gap to the leader on the right
  const lo = Math.floor((lastA.best.v - 0.3) * 10) / 10, hi = lead.best.v;
  const rank = A.map((o, i) => `<div class="crank"><span class="n">${i + 1}</span><span class="nm">${dot(o.aid)}${esc(o.name)}<small>${o.n} run${o.n > 1 ? "s" : ""} · avg ${f2(o.avg)} m/s</small></span>
      <span class="barbg"><i style="width:${(8 + 92 * ((o.best.v - lo) / Math.max(0.01, hi - lo))).toFixed(1)}%;background:${col[o.aid]}"></i></span>
      <b>${f2(o.best.v)}<small> m/s</small></b><span class="gap">${i ? signed(o.best.v - lead.best.v) : "leader"}</span></div>`).join("");
  // trend: best per day, one line per athlete
  const days = [...new Set(all.map((r) => dayKey(r.ts)))].sort(), dx = (k) => (new Date(k).getTime() - new Date(days[0]).getTime()) / 864e5, xEnd = Math.max(1, dx(days[days.length - 1]));
  let ylo = 1e9, yhi = -1e9; const series = [], dots = [];
  for (const o of A) {
    const by = bestPerDay(o.tr, km.pick), ds = Object.keys(by).sort(), X = ds.map(dx), Y = ds.map((d) => by[d].v);
    Y.forEach((y) => { ylo = Math.min(ylo, y); yhi = Math.max(yhi, y); });
    series.push({ x: X, y: Y, color: col[o.aid], w: 2.2 }); X.forEach((x, j) => dots.push({ x, y: Y[j], r: 3.4, fill: "#fff", stroke: col[o.aid], sw: 1.8 }));
  }
  const pad = Math.max(0.1, (yhi - ylo) * 0.2), yt = niceTicks(ylo - pad, yhi + pad, 5);
  const xt = []; { const n = Math.min(6, days.length); for (let i = 0; i < n; i++) xt.push(n === 1 ? 0 : (xEnd * i) / (n - 1)); }
  const trend = svgChart({ aria: "Best per day", w: 730, h: 142, pad: [44, 14, 10, 34], x0: -0.4, x1: xEnd + 0.4, y0: yt[0], y1: yt[yt.length - 1], font: 11, textColor: INK2, gridColor: "#efecf6",
    xt, xfmt: (t) => new Date(new Date(days[0]).getTime() + t * 864e5 + 12 * 36e5).toLocaleDateString([], { month: "short", day: "numeric" }), yt, yfmt: (t) => t.toFixed(1), yl: "m/s", series, dots });
  const lg = legend(A.map((o) => [SW_LINE(col[o.aid], 2.5), esc(o.name)]));
  // the written takeaways
  const notes = [];
  if (A.length > 1) notes.push(`${B(esc(lead.name))} has the best ${km.label}: ${B(f2(lead.best.v) + " m/s")}${isS ? ` (${f1(mph(lead.best.v))} mph)` : ""}, ${f2(lead.best.v - A[1].best.v)} m/s ahead of ${esc(A[1].name)}.`);
  if (steady && A.length > 1) notes.push(`Most repeatable: ${B(esc(steady.name))}, whose ${km.label} varies by only ±${f2(steady.sd)} m/s from run to run.`);
  const imp = A.map((o) => { const by = bestPerDay(o.tr, km.pick), ds = Object.keys(by).sort(); return ds.length > 1 ? { o, d: by[ds[ds.length - 1]].v - by[ds[0]].v } : null; }).filter(Boolean).sort((x, y) => y.d - x.d);
  if (imp.length && imp[0].d > 0.02) notes.push(`Biggest gain over this period: ${B(esc(imp[0].o.name))}, ${signed(imp[0].d)} m/s from first to latest session.`);
  if (isS) {
    const f = A.filter((o) => o.fly).sort((x, y) => x.fly.v - y.fly.v); if (f.length > 1) notes.push(`Fastest flying 10 m: ${B(esc(f[0].name))} in ${f2(f[0].fly.v)} s.`);
    const st = A.filter((o) => o.freq); if (st.length > 1) { const fq = st.slice().sort((x, y) => y.freq - x.freq)[0], ln = st.slice().sort((x, y) => y.len - x.len)[0]; notes.push(fq.aid === ln.aid ? `${esc(fq.name)} has both the quickest steps and the longest stride at top speed.` : `Different routes to speed: ${esc(fq.name)} has the quickest step rate (${f2(fq.freq)}/s), ${esc(ln.name)} the longest step (${f2(ln.len)} m).`); }
  } else {
    const c = A.filter((o) => o.carry).sort((x, y) => y.carry - x.carry); if (c.length > 1) notes.push(`${B(esc(c[0].name))} carries the most sprint speed to the plant (${Math.round(c[0].carry * 100)}%); ${esc(c[c.length - 1].name)} the least (${Math.round(c[c.length - 1].carry * 100)}%).`);
    const t = A.filter((o) => o.toSd != null).sort((x, y) => x.toSd - y.toSd); if (t.length > 1) notes.push(`Most consistent takeoff: ${B(esc(t[0].name))} (${spreadFt(t[0].toSd)}). Least: ${esc(t[t.length - 1].name)} (${spreadFt(t[t.length - 1].toSd)}).`);
    const sl = A.filter((o) => o.intoN && o.slowed / o.intoN >= 0.5); if (sl.length) notes.push(`Slowing into the box on most jumps: ${sl.map((o) => esc(o.name)).join(", ")}. That speed is lost right where it matters.`);
  }
  const p1 = `<div class="page">${head}
    <div class="box btop">${brandBlock(`Athlete comparison report<br>TF03 LiDAR · 1000 Hz · <b style="color:${INK}">${UNC}</b>`)}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;gap:12px;flex-wrap:wrap">
        <div><div class="eyebrow">COMPARISON · ${testName(test).toUpperCase()}</div><div class="who">${A.map((o) => esc(o.name)).join(` <span style="color:${INK2};font-weight:400;font-size:18px">vs</span> `)}</div></div>
        <div style="color:${INK2};font-size:13px;text-align:right">${dfmt(t0)}${dayKey(t0) !== dayKey(t1) ? ` – ${dfmt(t1)}` : ""}<br>${all.length} runs · ${days.length} session${days.length > 1 ? "s" : ""}</div></div>
      <div class="metrics" style="grid-template-columns:1.35fr 1fr 1fr 1fr">
        <div class="m hero" style="grid-row:auto"><div class="k">Best ${km.label}</div><div class="v" style="font-size:40px">${f2(lead.best.v)}<small style="font-size:16px">m/s</small></div><div class="k">${dot(lead.aid, 8)} ${esc(lead.name)} · ${dfmt(lead.best.r.ts)}</div></div>
        ${m("Gap first to last", A.length > 1 ? f2(lead.best.v - lastA.best.v) : "—", "m/s", A.length > 1 ? `${esc(short(lastA))} to ${esc(short(lead))}` : "", "")}
        ${m("Most repeatable", steady ? `<span style="font-size:${steady.name.length > 12 ? 17 : 22}px">${esc(steady.name)}</span>` : "—", "", steady ? `±${f2(steady.sd)} m/s run to run` : "needs 2+ runs each", "hl")}
        ${isS ? m("Fastest fly 10 m", (() => { const f = A.filter((o) => o.fly).sort((x, y) => x.fly.v - y.fly.v)[0]; return f ? f2(f.fly.v) : "—"; })(), "s", (() => { const f = A.filter((o) => o.fly).sort((x, y) => x.fly.v - y.fly.v)[0]; return f ? esc(f.name) : ""; })())
          : m("Best carry", (() => { const c = A.filter((o) => o.carry).sort((x, y) => y.carry - x.carry)[0]; return c ? Math.round(c.carry * 100) : "—"; })(), "%", (() => { const c = A.filter((o) => o.carry).sort((x, y) => y.carry - x.carry)[0]; return c ? `${esc(c.name)} · of sprint top speed` : "run a sprint test"; })())}
      </div></div>
    <div class="box"><div class="between" style="display:flex;justify-content:space-between;align-items:baseline"><h4>Ranking · best ${km.label}</h4><span style="color:${INK2};font-size:11px">gap to the leader in m/s</span></div>${rank}</div>
    <div class="box"><div style="display:flex;justify-content:space-between;align-items:baseline"><h4>Best ${km.label} per session</h4><span style="color:${INK2};font-size:11px">one point per athlete per day</span></div>${trend}${lg}</div>
    <div class="box"><h4>Key takeaways</h4><ul class="sum">${notes.slice(0, 4).map((n) => `<li>${n}</li>`).join("")}</ul></div>
    ${footer(1, 2)}</div>`;

  // ---- page 2: every number side by side, and the speed curves of each athlete's best run
  const rowsDef = isS ? [
    ["Best top speed", (o) => o.best.v, (v) => f2(v), "m/s", "high"],
    ["Average top speed", (o) => o.avg, (v) => f2(v), "m/s", "high"],
    ["Top speed in mph", (o) => mph(o.best.v), (v) => f1(v), "mph", "high"],
    ["Run to run spread", (o) => o.sd, (v) => "±" + f2(v), "m/s", "low"],
    ["Fastest flying 10 m", (o) => o.fly && o.fly.v, (v) => f2(v), "s", "low"],
    [`Best ${test.split("-")[1]} m time`, (o) => o.time && o.time.v, (v) => f2(v), "s", "low"],
    ["Distance to top speed", (o) => o.toTop, (v) => f1(v), "m", null],
    ["Step rate at top speed", (o) => o.freq, (v) => f2(v), "/s", "high"],
    ["Step length at top speed", (o) => o.len, (v) => f2(v), "m", "high"],
    ["Peak power", (o) => o.power, (v) => Math.round(v), "W", "high"],
    ["Runs", (o) => o.n, (v) => v, "", null],
  ] : [
    ["Best last 5 m", (o) => o.best.v, (v) => f2(v), "m/s", "high"],
    ["Average last 5 m", (o) => o.avg, (v) => f2(v), "m/s", "high"],
    ["Run to run spread", (o) => o.sd, (v) => "±" + f2(v), "m/s", "low"],
    ["Best top speed", (o) => o.top && o.top.v, (v) => f2(v), "m/s", "high"],
    ["Carry (avg last 5 m ÷ sprint top)", (o) => o.carry, (v) => Math.round(v * 100) + "%", "", "high"],
    ["Into the box (avg change)", (o) => o.into, (v) => signed(v), "m/s", "high"],
    ["Lefts (most often)", (o) => o.lefts, (v) => v, "", null],
    ["Takeoff from the box", (o) => o.to, (v) => ftLabel(v), "", null],
    ["Takeoff spread", (o) => o.toSd, (v) => spreadFt(v), "", "low"],
  ];
  const tbl = `<table class="ctab"><colgroup><col style="width:${A.length > 3 ? 28 : 34}%">${A.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${A.map((o) => `<th>${dot(o.aid, 8)}${esc(o.name)}</th>`).join("")}</tr></thead><tbody>${rowsDef.map(([k, get, fmt, u, better]) => {
    const vs = A.map((o) => { const v = get(o); return v == null || !isFinite(v) ? null : v; }), ok = vs.filter((v) => v != null);
    // compare what's printed: a tie is pink for everyone in it, and nothing is pink if they're all the same
    const shown = vs.map((v) => (v == null ? null : String(fmt(v)))), bestV = better && ok.length > 1 ? String(fmt(better === "high" ? Math.max(...ok) : Math.min(...ok))) : null;
    const allSame = new Set(shown.filter((x) => x != null)).size < 2;
    return `<tr><td>${k}${u ? ` <span class="u">${u}</span>` : ""}</td>${vs.map((v, i) => `<td class="${!allSame && shown[i] != null && shown[i] === bestV ? "lead" : ""}">${v == null ? "–" : fmt(v)}</td>`).join("")}</tr>`;
  }).join("")}</tbody></table>`;
  // each athlete's best run
  const cs = [];
  for (const o of A) {
    const b = o.best.r, c = b.res.curve;
    if (isS) { let k = c.d.findIndex((x) => x > b.target); if (k < 0) k = c.d.length; const k0 = Math.max(0, c.t.findIndex((t) => t >= 0)); cs.push({ x: c.d.slice(k0, k), y: c.v.slice(k0, k), color: col[o.aid], w: 2.2 }); }
    else { const xs = c.d.map((x) => (x - b.res.takeoff.dist) / FT); let k = xs.findIndex((x) => x > 0); if (k < 0) k = xs.length; cs.push({ x: xs.slice(0, k), y: c.v.slice(0, k), color: col[o.aid], w: 2.2 }); }
  }
  const cymax = isS ? Math.ceil((Math.max(...cs.map((s) => Math.max(...s.y))) + 0.3) * 2) / 2 : Math.ceil(Math.max(...cs.map((s) => Math.max(...s.y))) + 0.8);
  const cymin = isS ? Math.floor((Math.min(...cs.map((s) => { const k = s.x.findIndex((x) => x >= 10); return k < 0 ? s.y[0] : s.y[k]; })) - 0.3) * 2) / 2 : 0;
  const cxa = isS ? 10 : Math.max(-140, Math.floor(Math.min(...cs.map((s) => s.x[0])) / 10) * 10), cxb = isS ? Math.max(...A.map((o) => o.best.r.target)) : 0;
  const curves = svgChart({ aria: "Best runs compared", w: 730, h: isS ? 290 : 128, pad: [44, 14, 10, 34], x0: cxa, x1: cxb, y0: cymin, y1: cymax, font: 11, textColor: INK2, gridColor: "#efecf6",
    xt: niceTicks(cxa, cxb, 10), xfmt: (t) => (isS ? `${t} m` : t === 0 ? "TO" : `${Math.abs(t)}'`), yt: niceTicks(cymin, cymax, 5), yfmt: (t) => (isS ? t.toFixed(1) : t), yl: "m/s", xl: isS ? "Distance from the start" : "Feet before the takeoff",
    shades: isS ? [] : [{ a: -5 / FT, b: 0, color: ACC2, op: 0.1 }], series: cs });
  const clg = legend(A.map((o) => [SW_LINE(col[o.aid], 2.5), `${esc(o.name)} · ${dfmt(o.best.r.ts)}`]));
  // vault: where each athlete's lefts land on average
  let leftsBox = "";
  if (!isS) {
    const items = A.map((o) => ({ label: o.name, run: { mode: "vault", setup, res: { startMarkFt: o.sm, steps: { lefts: o.lefts }, contacts: Object.entries(o.leftAvg).map(([k, v]) => ({ left: true, out: +k, takeoff: +k === 0, n: null, boxFt: v.ft })).sort((a, b) => b.out - a.out) } } }));
    const maxOut = Math.max(0, ...A.map((o) => Math.max(0, ...Object.keys(o.leftAvg).map(Number))));
    const cols = []; for (let k = 0; k <= Math.min(maxOut, 8); k++) cols.push(k);
    leftsBox = `<div class="box"><div style="display:flex;justify-content:space-between;align-items:baseline"><h4>Where the lefts land · average of every jump</h4><span style="color:${INK2};font-size:11px">feet from the ${SETUPS[setup] && SETUPS[setup].pole ? "box mark" : "box"}</span></div>
      <div class="rmap">${runwayMap(items, { mid: settings.midOut, W: 580, laneH: 21, gutter: 92 })}</div>
      <table class="ctab lefts"><colgroup><col style="width:17%"><col style="width:9%">${cols.map(() => "<col>").join("")}</colgroup><thead><tr><th></th><th>Start</th>${cols.map((k) => `<th class="${k === settings.midOut ? "mid" : ""}">${k === 0 ? "TO" : k + " out"}</th>`).join("")}</tr></thead><tbody>${A.map((o) => `<tr><td>${dot(o.aid, 8)}${esc(o.name)}</td><td>${o.sm != null ? ftLabel(o.sm) : "–"}</td>${cols.map((k) => { const v = o.leftAvg[k]; return `<td class="${k === settings.midOut ? "mid" : ""}">${v ? ftLabel(v.ft) + (v.sd != null ? `<small>${spreadFt(v.sd)}</small>` : "") : "–"}</td>`; }).join("")}</tr>`).join("")}</tbody></table>
      <div style="font-size:10px;color:${INK2};margin-top:4px">Dashed line: the mid mark (${settings.midOut} lefts out), averaged over everyone. Small numbers are how much that left moves from jump to jump.</div></div>`;
  }
  const guide = isS
    ? `<div class="guide"><div><b>Best vs average top speed</b><p>The best run shows what each athlete can reach; the average shows what they bring on a normal day. A big gap between them means the top speed isn't repeatable yet.</p></div>
      <div><b>Step rate and step length</b><p>Top speed is rate × length. Athletes reach the same speed in different ways, so compare each athlete against their own numbers over time, not against each other.</p></div></div>`
    : `<div class="guide"><div><b>Last 5 m and carry</b><p>The last 5 m is the speed the pole has to work with. Carry shows how much of each athlete's sprint speed survives the pole carry and the plant, which separates a speed problem from an approach problem.</p></div>
      <div><b>Takeoff spread and lefts</b><p>A small takeoff spread with the same lefts means a run-up that repeats. Use the left columns to set each athlete's mid mark where their left actually lands.</p></div></div>`;
  const p2 = `<div class="page">${head}
    <div class="box"><h4>Side by side</h4>${tbl}<div style="font-size:10.5px;color:${INK2};margin-top:6px">Best value in each row in pink. Averages use every ${testName(test).toLowerCase()} run in the period.</div></div>
    <div class="box"><div style="display:flex;justify-content:space-between;align-items:baseline"><h4>${isS ? "Speed from 10 m to the finish · each athlete's best run" : "Speed into the takeoff · each athlete's best jump"}</h4></div>${curves}${clg}</div>
    ${leftsBox}
    ${isS ? `<div class="box">${guide}</div>` : ""}
    ${footer(2, 2)}</div>`;
  return p1 + p2;
}
function openCompareReport(test, ids) {
  const el = $("#report");
  el.innerHTML = `<div class="bar"><button data-rep="close">‹ Close</button><button data-rep="print">Print / Save PDF</button></div>` + compareReport(test, ids);
  el.classList.remove("hidden"); el.scrollTop = 0;
  const fit = () => { const w = Math.min(1, (window.innerWidth - 16) / 816); el.querySelectorAll(".page").forEach((p) => { p.style.zoom = w < 1 ? w : ""; }); };
  fit(); window.addEventListener("resize", fit, { once: true });
}

function openReport(id) {
  const run = runs.find((r) => r.id === id) || (cap.run && cap.run.id === id ? cap.run : null);
  if (!run) return;
  const el = $("#report");
  el.innerHTML = `<div class="bar"><button data-rep="close">‹ Close</button><button data-rep="print">Print / Save PDF</button></div>` + (run.mode === "sprint" ? sprintReport(run) : vaultReport(run));
  el.classList.remove("hidden"); el.scrollTop = 0;
  // fit the letter-size pages to the phone screen
  const fit = () => { const w = Math.min(1, (window.innerWidth - 16) / 816); el.querySelectorAll(".page").forEach((p) => { p.style.zoom = w < 1 ? w : ""; }); };
  fit(); window.addEventListener("resize", fit, { once: true });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rep]"); if (!b) return;
  if (b.dataset.rep === "close") { $("#report").classList.add("hidden"); $("#report").innerHTML = ""; }
  if (b.dataset.rep === "print") { $("#report").querySelectorAll(".page").forEach((p) => (p.style.zoom = "")); window.print(); setTimeout(() => { const w = Math.min(1, (window.innerWidth - 16) / 816); $("#report").querySelectorAll(".page").forEach((p) => (p.style.zoom = w < 1 ? w : "")); }, 500); }
});
