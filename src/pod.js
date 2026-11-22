// The waist pod's math: vertical jump height and the peak height of a vault, from the BMI160 in the pod.
//
// A recording is { hz, ax, ay, az, gx, gy, gz, avg }: the accelerometer in m/s² (what the chip measures: gravity's
// push-back plus motion, in the chip's own axes) and the gyro in rad/s, as plain arrays, hz per second. The pod
// reads the chip 1600 times a second and sends the average of each 4 (avg: true): an average keeps the exact change
// in speed over its slot, so even a sharp landing adds up correctly.
//
// Drift is handled by never integrating for long, and by anchoring every integration to a moment where the truth
// is known: standing still (speed zero) before a jump, or lying still on the mat after a vault (speed zero, height
// known). Each result says how long it had to integrate, and flags anything that doesn't add up.
const PodEngine = (() => {
  const G = 9.80665;
  // ---- quaternions (w, x, y, z): body → world rotations ----
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qnorm = (q) => { const L = Math.hypot(...q); return q.map((v) => v / L); };
  const rot = (q, v) => { const p = qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]); return [p[1], p[2], p[3]]; };
  // turn by angular rate w (rad/s, body axes) for dt seconds
  function step(q, w, dt) {
    const th = Math.hypot(...w) * dt;
    if (th < 1e-12) return q;
    const s = Math.sin(th / 2) / (th / dt);
    return qnorm(qmul(q, [Math.cos(th / 2), w[0] * s, w[1] * s, w[2] * s]));
  }
  // the rotation that takes the measured "up" (gravity's push-back, body axes) to world up
  function fromGravity(f) {
    const L = Math.hypot(...f), u = f.map((v) => v / L), d = u[2];
    if (d < -0.999999) return [0, 1, 0, 0];
    const ax = [u[1], -u[0], 0], w = 1 + d;   // u × (0,0,1)
    return qnorm([w, ax[0], ax[1], ax[2]]);
  }

  const n = (r) => r.ax.length;
  const fmag = (r, i) => Math.hypot(r.ax[i], r.ay[i], r.az[i]);
  const wmag = (r, i, b = [0, 0, 0]) => Math.hypot(r.gx[i] - b[0], r.gy[i] - b[1], r.gz[i] - b[2]);
  const mean = (r, k, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += r[k][i]; return s / Math.max(1, i1 - i0); };

  // ---- still: barely turning, and the accelerometer reading about 1 g and steady ----
  function stillMask(r) {
    const N = n(r), m = new Uint8Array(N), win = Math.max(1, Math.round(r.hz * 0.1));
    for (let i = 0; i < N; i++) {
      let ok = wmag(r, i) < 0.25 && Math.abs(fmag(r, i) - G) < 0.8;
      if (ok) for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win) && ok; j++) ok = Math.abs(fmag(r, j) - fmag(r, i)) < 0.6;
      m[i] = ok ? 1 : 0;
    }
    return m;
  }
  // runs of 1s at least minS long: [[i0, i1), ...]
  function runs(mask, minLen) {
    const out = []; let s = -1;
    for (let i = 0; i <= mask.length; i++) {
      if (i < mask.length && mask[i]) { if (s < 0) s = i; }
      else if (s >= 0) { if (i - s >= minLen) out.push([s, i]); s = -1; }
    }
    return out;
  }
  // free fall: the accelerometer reads near zero (it only feels gravity's push-back when something holds you up)
  function freeFalls(r, thr = 0.3 * G, minS = 0.08) {
    const m = new Uint8Array(n(r));
    for (let i = 0; i < m.length; i++) m[i] = fmag(r, i) < thr ? 1 : 0;
    // bridge one-sample gaps (noise)
    for (let i = 1; i < m.length - 1; i++) if (!m[i] && m[i - 1] && m[i + 1]) m[i] = 1;
    return runs(m, Math.round(minS * r.hz));
  }
  // time (s) where |f| crosses thr between samples i and i+1 (linear)
  function crossT(r, i, thr) { const a = fmag(r, i), b = fmag(r, i + 1); const k = b === a ? 0 : (thr - a) / (b - a); return (i + Math.min(1, Math.max(0, k))) / r.hz; }

  // ---- integrate the vertical motion from sample i0 to i1 (dir +1 forward, -1 backward) ----
  // q0: orientation at i0; bias: gyro bias. Returns per-sample vertical acceleration, velocity and height (world z),
  // relative to the starting values v0 / z0.
  function integrate(r, i0, i1, dir, q0, bias, v0 = 0, z0 = 0, g = G, scale = 1) {
    const dt = 1 / r.hz, len = Math.abs(i1 - i0) + 1, A = new Float64Array(len), V = new Float64Array(len), Z = new Float64Array(len);
    let q = q0, v = v0, z = z0, prevA = null;
    for (let k = 0, i = i0; k < len; k++, i += dir) {
      const aw = rot(q, [r.ax[i] * scale, r.ay[i] * scale, r.az[i] * scale])[2] - g;
      // averages: each sample is the mean over its own slot; points: trapezoid between neighbours
      if (r.avg) { const dv = aw * dt * dir; if (dir > 0) { z += (v + dv / 2) * dt; v += dv; } else if (prevA !== null) { const dv2 = prevA * dt * dir; z += (v + dv2 / 2) * dt * dir; v += dv2; } }
      else if (prevA !== null) { const am = (aw + prevA) / 2; const dv = am * dt * dir; z += (v + dv / 2) * dt * dir; v += dv; }
      A[k] = aw; V[k] = v; Z[k] = z; prevA = aw;
      // turn to the next sample (backward: undo this sample's turn)
      const w = [r.gx[i] - bias[0], r.gy[i] - bias[1], r.gz[i] - bias[2]];
      if (dir > 0 && k < len - 1) { const w2 = [r.gx[i + 1] - bias[0], r.gy[i + 1] - bias[1], r.gz[i + 1] - bias[2]]; q = step(q, w.map((x, j) => (x + w2[j]) / 2), dt); }
      if (dir < 0 && k < len - 1) { const w2 = [r.gx[i - 1] - bias[0], r.gy[i - 1] - bias[1], r.gz[i - 1] - bias[2]]; q = step(q, w.map((x, j) => -(x + w2[j]) / 2), dt); }
    }
    return { A, V, Z };
  }
  // orientation and gyro bias from a still stretch
  function restState(r, i0, i1, biasFrom) {
    const f = [mean(r, "ax", i0, i1), mean(r, "ay", i0, i1), mean(r, "az", i0, i1)];
    const [b0, b1] = biasFrom || [i0, i1];
    const bias = [mean(r, "gx", b0, b1), mean(r, "gy", b0, b1), mean(r, "gz", b0, b1)];
    return { q: fromGravity(f), bias, g: Math.hypot(...f) };
  }
  // the gyro's offset drifts slowly, so take it from the steadiest still stretch: the longest one, which is the
  // standing still before the run (lying on the mat, you breathe and the mat settles)
  const longest = (rs) => rs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

  // ---- vertical jump ----
  // Stand still ~1 s, jump, land, stand still ~1 s. Two answers that don't share their errors:
  //   flight time: h = g·T²/8 (timing only, no drift; reads high if you land with bent knees)
  //   takeoff speed: integrate from standing still to takeoff, with the drift taken out by also integrating on to
  //   standing still after landing, where the speed has to be zero again: h = v²/2g
  function analyzeJump(r) {
    const N = n(r), still = runs(stillMask(r), Math.round(0.4 * r.hz)), ff = freeFalls(r);
    if (!ff.length) return { ok: false, why: "No flight found: no moment where the pod was in the air." };
    const [f0, f1] = ff.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    const pre = still.filter(([, e]) => e <= f0).pop(), post = still.find(([s]) => s >= f1);
    if (!pre) return { ok: false, why: "Stand still for about a second before jumping." };
    if (!post) return { ok: false, why: "Stand still for about a second after landing." };
    const thr = 0.3 * G, tTo = crossT(r, f0 - 1, thr), tLand = crossT(r, f1 - 1, thr), T = tLand - tTo;
    const hFlight = (G * T * T) / 8;
    // Integrate from the end of standing still (the last 0.3 s of it sets the orientation) through the takeoff to the
    // end of the flight, and stop before the feet touch down: the landing (a stuck landing or a deep squat, hard
    // impacts) never enters the answer. About a second of integration, short enough that the leftover sensor error
    // barely builds up (the standing still before sets the gravity and the gyro offsets).
    const kL0 = Math.round(tLand * r.hz) - 1;
    const i0 = Math.max(pre[0], pre[1] - Math.round(0.3 * r.hz)), i1 = Math.max(kL0, i0 + 2);
    const st = restState(r, i0, pre[1], longest(still)), I = integrate(r, i0, i1, +1, st.q, st.bias, 0, 0, st.g);
    const L = I.V.length, Vc = I.V;
    const kTo = Math.round(tTo * r.hz) - i0, vTo = Vc[Math.max(0, Math.min(L - 1, kTo))];
    const hVel = vTo > 0 ? (vTo * vTo) / (2 * G) : 0;
    // height profile (from the corrected speed), for the chart: 0 = standing
    const Zc = new Float64Array(L); for (let k = 1; k < L; k++) Zc[k] = Zc[k - 1] + ((Vc[k] + Vc[k - 1]) / 2) / r.hz;
    const dip = Math.min(...Zc.slice(0, Math.max(1, kTo)));
    const kL = L, hRise = Math.max(...Zc.slice(kTo, Math.max(kTo + 1, kL))) - Zc[Math.max(0, kTo)];
    // heightStanding: standing tall (before the dip) to the highest point, like a jump-and-reach test: the takeoff
    // extension onto the toes plus the rise.
    // The answer: the average of the takeoff speed (v²/2g) and the rise of the height profile. In tests they err in
    // opposite directions by about a centimetre (where exactly "takeoff" falls), so the average lands on the truth.
    const diff = hFlight - (hVel + hRise) / 2;
    // The countermovement, like a force plate reads it: when they start down (onset), the bottom of the dip, takeoff.
    //   down: onset → bottom (unweighting + braking) · up: bottom → takeoff (propulsion) · time to takeoff = both
    //   RSImod = jump height / time to takeoff (m/s): the "fast and springy" number
    //   power per kg = (g + a) · v (vertical); peak force in body weights = (g + a) / g
    const kT = Math.max(1, Math.min(L - 1, kTo));
    // onset: the first clear move down (0.1 m/s), then back to where the acceleration began
    let kOn = 0; while (kOn < kT && Vc[kOn] > -0.1) kOn++;
    while (kOn > 0 && Math.abs(I.A[kOn]) > 0.5) kOn--;
    // bottom: where the speed turns from down to up for the last time before takeoff
    let kBot = kT; while (kBot > kOn && Vc[kBot] > 0) kBot--;
    let pk = 0, pSum = 0, pN = 0, fMax = 0, vMin = 0;
    for (let k = kOn; k <= kT; k++) {
      const f = G + I.A[k], pw = f * Vc[k];
      if (f > fMax) fMax = f; if (Vc[k] < vMin) vMin = Vc[k];
      if (k >= kBot) { if (pw > pk) pk = pw; pSum += pw; pN++; }
    }
    const tDown = (kBot - kOn) / r.hz, tUp = (kT - kBot) / r.hz, tTT = tDown + tUp, hAns = (hVel + hRise) / 2;
    const cm = { tDown, tUp, tTT, rsiMod: tTT > 0 ? hAns / tTT : null, depth: Zc[kOn] - Zc[kBot], peakPowerKg: pk, meanPowerKg: pN ? pSum / pN : 0, peakForceBW: fMax / G, downSpeed: -vMin };
    return {
      ok: true, cm, height: (hVel + hRise) / 2, heightStanding: Math.max(...Zc.slice(kTo)), heightSpeed: hVel, heightRise: hRise, heightFlight: hFlight, flightTime: T, takeoffSpeed: vTo, dip: -dip,
      tTakeoff: tTo, tLand, agree: Math.abs(diff) <= 0.03,
      note: Math.abs(diff) <= 0.03 ? "" : diff > 0 ? "Landed lower than you took off (bent knees): the height above doesn't depend on the landing." : "Flight time reads lower than the takeoff speed: check the pod is snug on the strap.",
      window: (i1 - i0) / r.hz, profile: { hz: r.hz, t0: i0 / r.hz, z: Array.from(Zc) },
    };
  }

  // ---- vault: peak height of the pod (your hips) ----
  // Lie still on the mat for about a second after landing. From there everything is known: speed zero, and the
  // pod's height (restHeight: the pod's height off the ground when you lie on the mat, measured once). Integrate
  // backward from that moment through the landing and the flight; the highest point of that path is the peak. The
  // flight is free fall, where the accelerometer reads near zero, so tilt errors barely matter there; the landing is
  // short. About 1.5–2 s of integration in all.
  function analyzeVault(r, restHeight) {
    const N = n(r), still = runs(stillMask(r), Math.round(0.6 * r.hz));
    const rest = still.filter(([s]) => s > 0).pop();
    if (!rest) return { ok: false, why: "Lie still on the mat for about a second after landing." };
    const ff = freeFalls(r).filter(([, e]) => e <= rest[0]);
    if (!ff.length) return { ok: false, why: "No flight found before the landing." };
    const fl = ff[ff.length - 1];                         // the last flight before lying still: off the pole into the pit
    // the first ~0.4 s of lying still sets the orientation; integrate back from its start
    const r1 = Math.min(rest[1], rest[0] + Math.round(0.4 * r.hz)), st = restState(r, rest[0], r1, longest(still));
    const iStart = Math.max(0, fl[0] - Math.round(0.5 * r.hz));
    // gravity as the pod itself reads it lying still (takes out its own small offset along that direction)
    const I = integrate(r, rest[0], iStart, -1, st.q, st.bias, 0, restHeight, st.g);
    // highest point between the start of the flight and the landing
    const kFlightStart = rest[0] - fl[0], kLand = rest[0] - fl[1];
    let peak = -Infinity, kPeak = 0;
    for (let k = kLand; k <= Math.min(I.Z.length - 1, kFlightStart + Math.round(0.5 * r.hz)); k++) if (I.Z[k] > peak) { peak = I.Z[k]; kPeak = k; }
    const vImpact = I.V[kLand], tFlight = (fl[1] - fl[0]) / r.hz;
    // the peak should be in the flight (or the last moment of the push off the pole): if the highest point is the
    // far end of the window, the flight started later than the push-off and the peak may be underestimated
    const atEdge = kPeak >= I.Z.length - 2;
    return {
      ok: true, peak, impactSpeed: -vImpact, flightTime: tFlight, tPeak: (rest[0] - kPeak) / r.hz, tLand: fl[1] / r.hz,
      window: kPeak / r.hz, note: atEdge ? "The highest point was at the start of the flight: the push off the pole may have been higher." : "",
      profile: { hz: r.hz, t0: iStart / r.hz, z: Array.from(I.Z).reverse() },
    };
  }

  return { integrate, restState, G, analyzeJump, analyzeVault, stillMask, freeFalls, runs, fromGravity, rot, qmul, step };
})();
if (typeof module !== "undefined") module.exports = PodEngine;
