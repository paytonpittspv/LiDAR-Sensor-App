// ===== ENGINE START =====
// Measurement engine for PAYTON'S LiDAR SENSOR.
// One smoothed distance line is made first; speed, splits, top speed and the takeoff all come from it.
const Engine = (() => {
  const FT = 0.3048;

  // ---------- filters ----------
  function biquadLP(fc, fs) {
    const w0 = (2 * Math.PI * fc) / fs, c = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2);
    const a0 = 1 + al;
    return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
  }
  function runBiquad(x, q) {
    const y = new Float64Array(x.length);
    let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
    for (let i = 0; i < x.length; i++) {
      const v = q.b0 * x[i] + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // zero-phase low-pass (forward + backward), with mirrored padding so the ends don't droop
  function filtfilt(x, fc, fs) {
    const n = x.length, pad = Math.min(n - 1, Math.round((3 * fs) / fc));
    const ext = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
    ext.set(x, pad);
    const q = biquadLP(fc, fs);
    let y = runBiquad(ext, q);
    y.reverse(); y = runBiquad(y, q); y.reverse();
    return y.slice(pad, pad + n);
  }
  function deriv(x, fs) {
    const n = x.length, v = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) v[i] = ((x[i + 1] - x[i - 1]) * fs) / 2;
    v[0] = v[1]; v[n - 1] = v[n - 2];
    return v;
  }

  // ---------- 1) raw sensor frames → one clean, evenly spaced distance track ----------
  function track(raw, limitCm) {
    const n = raw.t.length;
    if (n < 300) return { error: "Not enough data recorded." };
    // The sensor sends frames at a fixed rate: fit time vs frame number to remove Wi-Fi/serial jitter.
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const t0 = raw.t[0];
    for (let i = 0; i < n; i++) { const y = (raw.t[i] - t0) | 0; sx += i; sy += y; sxx += i * i; sxy += i * y; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    const fs = 1e6 / b;
    const T = [], D = [];
    for (let i = 0; i < n; i++) { const cm = raw.d[i]; if (cm > 10 && cm < Math.min(raw.maxCm, limitCm || Infinity)) { T.push((a + b * i) / 1e6); D.push(cm / 100); } }
    if (T.length < 300) return { error: "The sensor didn't see the athlete for most of the run. Check the aim." };
    // Drop single bad readings (arms, the pole, background) with a running median.
    const W = 15, kt = [], kd = [];
    for (let k = 0; k < D.length; k++) {
      const lo = Math.max(0, k - W), hi = Math.min(D.length, k + W + 1);
      const win = D.slice(lo, hi).sort((p, q) => p - q), med = win[win.length >> 1];
      if (Math.abs(D[k] - med) < 0.35) { kt.push(T[k]); kd.push(D[k]); }
    }
    // Split into continuous pieces (a gap over 0.12 s = athlete lost) and keep the piece that travels furthest.
    const pieces = []; let s = 0;
    for (let k = 1; k <= kt.length; k++) if (k === kt.length || kt[k] - kt[k - 1] > 0.12) { pieces.push([s, k]); s = k; }
    let best = pieces[0], bestGain = -1;
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 50) continue;
      let mn = Infinity, mx = -Infinity; for (let k = p0; k < p1; k++) { mn = Math.min(mn, kd[k]); mx = Math.max(mx, kd[k]); }
      if (mx - mn > bestGain) { bestGain = mx - mn; best = [p0, p1]; }
    }
    // Resample that piece onto an even grid.
    const [p0, p1] = best, dt = 1 / fs;
    const m = Math.floor((kt[p1 - 1] - kt[p0]) / dt) + 1;
    const d = new Float64Array(m); let j = p0;
    for (let i = 0; i < m; i++) {
      const t = kt[p0] + i * dt;
      while (j < p1 - 2 && kt[j + 1] < t) j++;
      const f = (t - kt[j]) / ((kt[j + 1] - kt[j]) || 1e-9);
      d[i] = kd[j] + Math.max(0, Math.min(1, f)) * (kd[j + 1] - kd[j]);
    }
    return { fs, t0: kt[p0], d, lostAtEnd: p1 < kt.length || true };
  }

  // ---------- 2) smooth distance, then speed from it ----------
  const SMOOTH_HZ = 3;     // the one line: splits, speed curve and top speed all use this
  const STEP_HZ = 7;       // keeps the per-step speed wobble, only used to find foot contacts
  const RAW_HZ = 12;
  const STRIDE_S = 0.46;
  let SHARPEN = false, REPAIR = true;   // one stride (two steps) for the speed curve and top speed       // "raw speed" line drawn on charts
  function lines(tr) {
    const ds = filtfilt(tr.d, SMOOTH_HZ, tr.fs);
    const v = deriv(ds, tr.fs);
    const vStep = deriv(filtfilt(tr.d, STEP_HZ, tr.fs), tr.fs);
    const vRaw = deriv(filtfilt(tr.d, RAW_HZ, tr.fs), tr.fs);
    // stride speed: distance covered over one stride (~0.46 s, two steps) of the same smoothed line,
    // so the curve shows the run, not the small speed-up/slow-down inside every step
    const h = Math.round(STRIDE_S / 2 * tr.fs), n = ds.length, vStride = new Float64Array(n);
    for (let k = 0; k < n; k++) { const a = Math.max(0, k - h), b = Math.min(n - 1, k + h); vStride[k] = b > a ? (ds[b] - ds[a]) / ((b - a) / tr.fs) : v[k]; }
    return { d: tr.d, ds, v, vStep, vRaw, vStride };
  }

  // time when the smoothed distance first reaches x (searching from index k0)
  function crossTime(ds, fs, k0, x) {
    if (ds[k0] >= x) return k0 / fs;
    for (let k = k0 + 1; k < ds.length; k++) if (ds[k] >= x) { const f = (x - ds[k - 1]) / ((ds[k] - ds[k - 1]) || 1e-9); return (k - 1 + f) / fs; }
    return NaN;
  }

  // ---------- 3) foot contacts and lefts ----------
  // Each foot contact slows the trunk a little, then the push speeds it up again: one wobble in speed per step.
  // We take that wobble (step-speed minus smoothed speed), keep only step-like frequencies (1.8–6.5 Hz), and
  // follow its phase: one full turn = one step, a contact sits at the bottom of each turn. Counting turns is
  // much steadier than hunting for individual dips. Then we walk back from the takeoff (a left) and stop at
  // the first step that breaks the rhythm, so hops, skips and walk-ins aren't counted.
  function fft(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function stepPhase(L, fs, kFrom, kTo) {
    const dec = Math.max(1, Math.round(fs / 200)), f2 = fs / dec;
    const m = Math.floor((kTo - kFrom) / dec) + 1;
    let N = 1; while (N < m * 2) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    // use the distance wobble (raw distance minus the smooth line): less noisy than a speed wobble
    for (let i = 0; i < m; i++) { const k = kFrom + i * dec; let a = 0; for (let q = 0; q < dec; q++) a += L.d[Math.min(L.d.length - 1, k + q)] - L.ds[Math.min(L.d.length - 1, k + q)]; re[i] = a / dec / Math.max(1, L.v[k]); }
    // taper the ends a little
    const tap = Math.min(m >> 3, Math.round(0.2 * f2));
    for (let i = 0; i < tap; i++) { const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / tap); re[i] *= w; re[m - 1 - i] *= w; }
    fft(re, im, false);
    for (let i = 0; i < N; i++) {
      const f = i <= N / 2 ? (i * f2) / N : -((N - i) * f2) / N;
      if (f < 1.8 || f > 6.5) { re[i] = 0; im[i] = 0; } else { re[i] *= 2; im[i] *= 2; }   // analytic, band-limited
    }
    fft(re, im, true);
    const ph = new Float64Array(m), amp = new Float64Array(m);
    let prev = 0, off = 0;
    for (let i = 0; i < m; i++) {
      let p = Math.atan2(im[i], re[i]) + Math.PI / 2;   // speed wobble leads the distance wobble by a quarter turn
      if (i) { while (p + off - prev > Math.PI) off -= 2 * Math.PI; while (p + off - prev < -Math.PI) off += 2 * Math.PI; }
      ph[i] = p + off; prev = ph[i]; amp[i] = Math.hypot(re[i], im[i]);
    }
    return { ph, amp, dec, f2, kFrom, m };
  }
  // contacts = where the phase passes the bottom of the wobble (π, 3π, ...)
  function contactsFromPhase(S, L) {
    let out = [];
    // phase only moves forward (stops wobbles around a crossing from counting twice)
    const mono = new Float64Array(S.m); mono[0] = S.ph[0];
    for (let i = 1; i < S.m; i++) mono[i] = Math.max(mono[i - 1], S.ph[i]);
    for (let i = 1; i < S.m; i++) {
      const a = mono[i - 1], b = mono[i];
      const na = Math.floor((a - Math.PI) / (2 * Math.PI)), nb = Math.floor((b - Math.PI) / (2 * Math.PI));
      if (nb > na) { const target = Math.PI + 2 * Math.PI * nb; const f = (target - a) / ((b - a) || 1e-9); out.push(S.kFrom + (i - 1 + f) * S.dec); }
    }
    out = out.map((k) => Math.round(k));
    // merge contacts that are far closer together than the steps around them (a phase slip, not a step)
    const fsx = S.f2 * S.dec;
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (let i = 1; i < out.length; i++) {
        const lo = Math.max(1, i - 3), hi = Math.min(out.length - 1, i + 3), ivs = [];
        for (let j = lo; j <= hi; j++) if (j !== i) ivs.push(out[j] - out[j - 1]);
        const med = ivs.sort((a, b) => a - b)[ivs.length >> 1] || 0;
        if (out[i] - out[i - 1] < 0.62 * med && out[i] - out[i - 1] < 0.2 * fsx) { out.splice(i, 1, Math.round((out[i] + out[i - 1]) / 2)); out.splice(i - 1, 1); changed = true; break; }
      }
    }
    return out;
  }
  // kAnchor = where we expect the last contact (the takeoff for vault)
  function trackSteps(L, fs, kGo, kEnd, kAnchor) {
    const kFrom = Math.max(0, kGo - Math.round(0.6 * fs)), kTo = Math.min(L.v.length - 1, kEnd + Math.round(0.2 * fs));
    const S = stepPhase(L, fs, kFrom, kTo);
    const contacts = contactsFromPhase(S, L);
    // takeoff / last step: carry the rhythm of the steady steps just before the plant forward to it,
    // then use the contact that sits there (or the predicted spot if the plant blurred that dip)
    let lastIdx = -1;
    // (the plant bends the last ~0.3 s of the wobble, so only trust contacts before that)
    const before = contacts.filter((k) => k < kAnchor - 0.3 * fs);
    if (before.length >= 4) {
      const iv = []; for (let i = before.length - 4; i < before.length; i++) iv.push(before[i] - before[i - 1]);
      const Im = iv.sort((a, b) => a - b)[iv.length >> 1];
      let cur = before[before.length - 1];
      const chain = before.slice();
      while (cur + 0.5 * Im <= kAnchor + 0.06 * fs) {
        const pred = cur + Im;
        const snap = contacts.filter((k) => Math.abs(k - pred) <= 0.3 * Im).sort((a, b) => Math.abs(a - pred) - Math.abs(b - pred))[0];
        cur = snap != null ? snap : Math.round(pred); chain.push(cur);
      }
      contacts.splice(0, contacts.length, ...chain);
      lastIdx = contacts.length - 1;
    } else {
      let bestD = 0.12 * fs;
      contacts.forEach((k, i) => { const d = Math.abs(k - kAnchor); if (d <= bestD) { bestD = d; lastIdx = i; } });
    }
    if (lastIdx < 0) return [];
    // typical wobble size during the run, to spot where the rhythm fades out
    const ampAt = (k) => S.amp[Math.max(0, Math.min(S.m - 1, Math.round((k - S.kFrom) / S.dec)))];
    // (skip the last two steps: the plant makes the wobble there look bigger than it is)
    const amps = contacts.slice(Math.max(0, lastIdx - 10), Math.max(1, lastIdx - 1)).map(ampAt).sort((a, b) => a - b);
    const refAmp = amps[amps.length >> 1] || 0;
    const out = [contacts[lastIdx]];
    let guesses = 0;
    for (let i = lastIdx - 1; i >= 0; i--) {
      const last = out[out.length - 1], k = contacts[i], dt = (last - k) / fs;
      // reference = median of the last three step times we accepted (one noisy step won't break the count)
      const recent = []; for (let j = Math.max(1, out.length - 3); j < out.length; j++) recent.push((out[j - 1] - out[j]) / fs);
      const ref = recent.length ? recent.sort((a, b) => a - b)[recent.length >> 1] : dt;
      if (L.v[k] < 1.5) break;                                            // before the run started
      if (out.length > 1 && dt < ref * 0.6) continue;                     // a stray contact between two steps: skip it
      if (dt < 0.17) continue;
      if (out.length > 1 && dt >= ref * 1.7 && dt <= ref * 2.3 && L.v[k] > 4 && guesses < 2) {
        out.push(Math.round((last + k) / 2)); guesses++;                  // one dip missed inside a steady rhythm
      } else if (dt > 0.5 || (out.length > 1 && dt > ref * 1.8)) break;  // rhythm breaks (hop, skip, walk-in)
      // wobble gone for two steps in a row: no real steps here
      if (ampAt(k) < 0.2 * refAmp && i > 0 && ampAt(contacts[i - 1]) < 0.2 * refAmp) break;
      out.push(k);
    }
    return out.reverse();
  }

  // ---------- 4) force–velocity profile (simple model, no air resistance) ----------
  function fvProfile(L, fs, kGo, kTop, mass) {
    // fit v(t) = vmax * (1 - e^(-t/tau)) to the smoothed speed from the start to top speed
    let best = null;
    const n = kTop - kGo; if (n < fs * 0.8) return null;
    const stepK = Math.max(1, Math.round(fs / 100));
    for (let tau = 0.5; tau <= 2.5; tau += 0.005) {
      let sxy = 0, sxx = 0;
      for (let k = kGo; k <= kTop; k += stepK) { const x = 1 - Math.exp(-((k - kGo) / fs) / tau); sxy += x * L.v[k]; sxx += x * x; }
      const vmax = sxy / sxx; let err = 0;
      for (let k = kGo; k <= kTop; k += stepK) { const e = L.v[k] - vmax * (1 - Math.exp(-((k - kGo) / fs) / tau)); err += e * e; }
      if (!best || err < best.err) best = { tau, vmax, err };
    }
    const { tau, vmax } = best, F0 = vmax / tau, P0 = (F0 * vmax) / 4, slope = -F0 / vmax;
    // model curves for power and force over the run
    let pk = 0, sumP = 0, sumF = 0, c = 0;
    const T = (kTop - kGo) / fs;
    for (let t = 0; t <= T; t += 0.01) { const a = (vmax / tau) * Math.exp(-t / tau), v = vmax * (1 - Math.exp(-t / tau)); const p = a * v; pk = Math.max(pk, p); sumP += p; sumF += a; c++; }
    return { tau, V0: vmax, F0, P0, slope, peakPowerKg: pk, meanPowerKg: sumP / c, meanForceKg: sumF / c,
      F0abs: mass ? F0 * mass : null, P0abs: mass ? P0 * mass : null, peakPower: mass ? pk * mass : null, meanPower: mass ? (sumP / c) * mass : null, meanForce: mass ? (sumF / c) * mass : null };
  }

  // ---------- main ----------
  // ctx: { mode: "sprint", target: m } | { mode: "vault", setup: "runway100" | "runway150" | "polerun" }, mass (kg, optional)
  function process(raw, ctx) {
    const boxM = ctx.mode === "vault" && (ctx.setup === "runway100" || ctx.setup === "runway150") ? (ctx.setup === "runway100" ? 100 : 150) * FT : null;
    const tr = track(raw, boxM ? Math.round(boxM * 100) : null); if (tr.error) return tr;
    const fs = tr.fs, L = lines(tr), n = tr.d.length;
    // top speed of the whole recording (to find the run)
    let kTopAll = 0; for (let k = 0; k < n; k++) if (L.v[k] > L.v[kTopAll]) kTopAll = k;
    if (L.v[kTopAll] < 2) return { error: "No run found in this recording." };
    // start: the last moment before the run where speed was under 0.2 m/s
    const START_MS = 0.2;
    let kGo = -1; for (let k = kTopAll; k >= 0; k--) if (L.v[k] < START_MS) { kGo = k; break; }
    if (kGo < 0) {
      // already moving when the sensor first saw them (start out of view)
      if (ctx.mode === "sprint") return { error: "The sensor didn't see the start. Stand still in the beam before you go." };
      kGo = 0;
    }
    // refine to the exact crossing
    const goT = Math.max(kGo, Math.min(kGo + 1, kGo + (START_MS - L.v[kGo]) / ((L.v[kGo + 1] - L.v[kGo]) || 1e-9)));
    const tGo = goT / fs, dGo = L.ds[kGo] + (L.ds[kGo + 1] - L.ds[kGo]) * (goT - kGo);
    const at = (dist) => crossTime(L.ds, fs, kGo, dGo + dist) - tGo;      // time from start to a distance
    const speedAtK = (k) => L.v[Math.max(0, Math.min(n - 1, k))];

    const res = { ctx, fs, start: { threshold: START_MS, t: tGo, d: dGo } };

    // ----- where the run ends -----
    let kEnd = n - 1;
    if (ctx.mode === "sprint") {
      const tf = crossTime(L.ds, fs, kGo, dGo + ctx.target);
      if (!isFinite(tf)) return { error: `The run didn't reach ${ctx.target} m. Check the target distance or the aim.` };
      kEnd = Math.min(n - 1, Math.ceil(tf * fs));
    } else {
      for (let k = kTopAll + 1; k < n; k++) if (L.v[k] < 0.75 * L.v[kTopAll]) { kEnd = k; break; }
    }
    // top speed within the run
    // top speed = fastest stride, so a single step or a noisy reading can't set it
    let kTop = kGo; for (let k = kGo; k <= kEnd; k++) if (L.vStride[k] > L.vStride[kTop]) kTop = k;
    res.top = { speed: L.vStride[kTop], t: kTop / fs - tGo, dist: L.ds[kTop] - dGo };

    // ----- steps -----
    // vault / pole run: count back from the takeoff (the plant shows up as a sudden ~10% drop in speed,
    // about 0.045 s after the takeoff contact); sprint: from the last contact before the finish
    let kAnchor = kEnd;
    if (ctx.mode === "vault") {
      const win = Math.round(0.5 * fs);
      for (let k = kTopAll; k < n; k++) {
        let mx = 0; for (let q = Math.max(0, k - win); q <= k; q += 5) mx = Math.max(mx, L.v[q]);
        if (L.vStep[k] < 0.9 * mx) { kAnchor = k - Math.round(0.045 * fs); break; }
      }
    }
    let stepKs = trackSteps(L, fs, kGo, kEnd, kAnchor);
    if (ctx.mode === "vault" && kAnchor < kEnd && stepKs.length) {
      // the plant pins the takeoff contact better than the step dips do: anything after it is not a step,
      // and the last step is the takeoff itself
      const tol = Math.round(0.06 * fs);
      stepKs = stepKs.filter((k) => k <= kAnchor + tol);
      const last = stepKs[stepKs.length - 1];
      if (last != null && Math.abs(last - kAnchor) <= tol) stepKs[stepKs.length - 1] = kAnchor;
      else if (last == null || kAnchor - last > Math.round(0.16 * fs)) stepKs.push(kAnchor);
      else stepKs[stepKs.length - 1] = kAnchor;
    }
    const takeoffK = ctx.mode === "vault" && stepKs.length ? stepKs[stepKs.length - 1] : null;
    res.steps = {
      counted: stepKs.length,
      lefts: Math.ceil(stepKs.length / 2),
      times: stepKs.map((k) => +(k / fs - tGo).toFixed(3)),
      firstAt: stepKs.length ? +(L.ds[stepKs[0]] - dGo).toFixed(2) : null,
    };

    if (ctx.mode === "sprint") {
      const T = ctx.target;
      res.time = at(T);
      res.avgSpeed = T / res.time;
      res.splits = [];
      for (let x = 5; x <= T + 1e-9; x += 5) { const t1 = at(x), t0 = x === 5 ? 0 : at(x - 5); res.splits.push({ from: x - 5, to: x, time: t1 - t0, at: t1, speed: 5 / (t1 - t0) }); }
      res.cum = {}; for (const x of [10, 20, 30, 40, 50, 60]) if (x <= T) res.cum[x] = at(x);
      // best flying 10 m inside the test distance
      let fly = null;
      if (T >= 10) for (let x = 0; x + 10 <= T + 1e-9; x += 0.05) { const dt = at(x + 10) - at(x); if (isFinite(dt) && (!fly || dt < fly.time)) fly = { from: x, to: x + 10, time: dt, speed: 10 / dt }; }
      res.fly10 = fly;
      // acceleration
      let aPk = 0, aPkRaw = 0; for (let k = kGo; k <= kTop; k++) { aPk = Math.max(aPk, (L.v[Math.min(n - 1, k + 1)] - L.v[Math.max(0, k - 1)]) * fs / 2); }
      for (let k = kGo; k <= kTop; k++) aPkRaw = Math.max(aPkRaw, (L.vRaw[Math.min(n - 1, k + 1)] - L.vRaw[Math.max(0, k - 1)]) * fs / 2);
      res.accel = { peak: aPk, peakRaw: aPkRaw, mean: res.top.speed / Math.max(0.1, res.top.t) };
      res.fv = fvProfile(L, fs, kGo, kTop, ctx.mass);
      // stride at top speed: steps per second and metres per step, from a straight-line fit through
      // every step from 5 m before the fastest 10 m to the finish (one jittery contact can't skew it)
      if (fly) {
        const ta = (at(Math.max(0, fly.from - 5)) + tGo) * fs, ks = stepKs.filter((k) => k >= ta && k <= kEnd);
        if (ks.length >= 6) {
          const N = ks.length, mi = (N - 1) / 2, mt = ks.reduce((s, k) => s + k, 0) / N / fs;
          let sxy = 0, sxx = 0; ks.forEach((k, i) => { sxy += (i - mi) * (k / fs - mt); sxx += (i - mi) ** 2; });
          const stepT = sxy / sxx, freq = 1 / stepT;
          const sp = (L.ds[ks[N - 1]] - L.ds[ks[0]]) / ((ks[N - 1] - ks[0]) / fs);
          res.stride = { freq, length: res.top.speed / freq, steps: N, speed: sp };   // length at top speed, so rate × length = top speed
        }
      }
      // speed build-up: where the athlete reached 90 / 95 / 98% of top speed (stride line)
      res.reach = {};
      for (const p of [0.9, 0.95, 0.98]) { for (let k = kGo; k <= kTop; k++) if (L.vStride[k] >= p * res.top.speed) { res.reach[Math.round(p * 100)] = L.ds[k] - dGo; break; } }
    } else {
      // vault: end of the last 5 m = the takeoff contact (or the slowdown if no steps were found)
      const kTo = takeoffK != null ? takeoffK : kEnd;
      const dTo = L.ds[kTo];
      const seg = (a, b) => { const ta = crossTime(L.ds, fs, kGo, a), tb = crossTime(L.ds, fs, kGo, b); return isFinite(ta) && isFinite(tb) && tb > ta ? { time: tb - ta, speed: (b - a) / (tb - ta) } : null; };
      res.takeoff = { t: kTo / fs - tGo, dist: dTo - dGo, sensor: dTo, fromSteps: takeoffK != null };
      // stride speed must not reach past the takeoff (the plant slows the body, not the run-up)
      const h = Math.round(STRIDE_S / 2 * fs);
      for (let k = Math.max(0, kTo - h); k < n; k++) { const a = Math.max(0, Math.min(k, kTo) - h), b = Math.min(kTo, k + h); L.vStride[k] = b > a ? (L.ds[b] - L.ds[a]) / ((b - a) / fs) : L.v[k]; }
      let kT2 = kGo; for (let k = kGo; k <= kTo; k++) if (L.vStride[k] > L.vStride[kT2]) kT2 = k;
      res.top = { speed: L.vStride[kT2], t: kT2 / fs - tGo, dist: L.ds[kT2] - dGo };
      res.fv = fvProfile(L, fs, kGo, kT2, ctx.mass);   // power from the run-up (same model as sprint)
      // into the box: speed over the last 0.25 s before the plant vs the 0.25 s half a second earlier
      // (ends 0.05 s before the takeoff contact so the plant itself doesn't leak in)
      const win = (kb, len) => { const ka = Math.max(kGo, kb - Math.round(len * fs)); return kb > ka ? (L.ds[kb] - L.ds[ka]) / ((kb - ka) / fs) : null; };
      const ke = kTo - Math.round(0.05 * fs), vEnd = win(ke, 0.25), vBefore = win(ke - Math.round(0.5 * fs), 0.25);
      res.finish = vEnd != null && vBefore != null ? { vEnd, vBefore, change: vEnd - vBefore, accel: (vEnd - vBefore) / 0.5 } : null;
      // every contact: where it landed, in feet from the box (runway) or from the start (pole runs)
      const LEAD_STEP = 0.4, LEAD_TO = 0.5, nC = stepKs.length;
      // sharpen each contact to the bottom of its speed dip (12 Hz speed line, ±0.08 s around the step estimate)
      const sharpen = (k0) => {
        const w = Math.round(0.08 * fs), a = Math.max(1, Math.round(k0) - w), b = Math.min(n - 2, Math.round(k0) + w);
        let m = a; for (let q = a; q <= b; q++) if (L.vRaw[q] < L.vRaw[m]) m = q;
        if (m <= a || m >= b) return k0;   // no clear dip: keep the estimate
        const y0 = L.vRaw[m - 1], y1 = L.vRaw[m], y2 = L.vRaw[m + 1], den = y0 - 2 * y1 + y2;
        return m + (den > 0 ? 0.5 * (y0 - y2) / den : 0);
      };
      // repair contacts that break the rhythm: if one is more than 0.035 s off the smooth line through its
      // two neighbours on each side, move it onto that line (real step-to-step changes are smaller than this)
      const kc = stepKs.map((k) => (SHARPEN ? sharpen(k) : k));
      if (REPAIR && kc.length >= 6) {
        const orig = kc.slice();
        for (let i = 2; i < kc.length - 2; i++) {
          const xs = [-2, -1, 1, 2], ys = xs.map((d) => orig[i + d]);
          // least-squares quadratic through the 4 neighbours, evaluated at 0
          let S0 = 4, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
          xs.forEach((x, j) => { S1 += x; S2 += x * x; S3 += x ** 3; S4 += x ** 4; T0 += ys[j]; T1 += x * ys[j]; T2 += x * x * ys[j]; });
          const det = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
          const c0 = (T0 * (S2 * S4 - S3 * S3) - S1 * (T1 * S4 - S3 * T2) + S2 * (T1 * S3 - S2 * T2)) / det;
          if (Math.abs(orig[i] - c0) > 0.035 * fs) kc[i] = c0;
        }
      }
      res.contacts = kc.map((kEst, i) => {
        const k0 = kEst, k = Math.max(0, Math.min(n - 1, Math.round(k0)));
        const fromEnd = nC - 1 - i, left = fromEnd % 2 === 0, lead = fromEnd === 0 ? LEAD_TO : LEAD_STEP;
        return { t: +(k0 / fs - tGo).toFixed(3), left, takeoff: fromEnd === 0, out: left ? fromEnd / 2 : null, n: left ? res.steps.lefts - fromEnd / 2 : null,
          boxFt: boxM ? +((boxM - (L.ds[k] + lead)) / FT).toFixed(2) : null, startFt: +((L.ds[k] - dGo + lead) / FT).toFixed(2), v: +L.vStride[k].toFixed(3) };
      });
      res.last5 = dTo - 5 >= dGo ? seg(dTo - 5, dTo) : null;
      res.prev5 = dTo - 10 >= dGo ? seg(dTo - 10, dTo - 5) : null;
      res.approachTime = kTo / fs - tGo;
      res.approachDist = dTo - dGo;
      if (ctx.setup === "runway100" || ctx.setup === "runway150") {
        const box = (ctx.setup === "runway100" ? 100 : 150) * FT;
        const LEAD = 0.5;   // takeoff foot is roughly this far ahead of the lower back the laser sees
        res.box = box;
        res.takeoff.outFt = (box - (dTo + LEAD)) / FT;
        res.startMarkFt = (box - (dGo + 0.3)) / FT;
        // fixed windows measured from the box, the same every jump
        res.box10to5 = seg(box - 10, box - 5);
      }
    }

    // ----- curves to keep (50 points per second) -----
    const every = Math.max(1, Math.round(fs / 50)), kLast = Math.min(n - 1, kEnd + Math.round(0.25 * fs));
    const curve = { t: [], d: [], v: [], vr: [] };
    for (let k = Math.max(0, kGo - Math.round(0.2 * fs)); k <= kLast; k += every) {
      curve.t.push(+(k / fs - tGo).toFixed(3)); curve.d.push(+(L.ds[k] - dGo).toFixed(3));
      curve.v.push(+L.vStride[k].toFixed(3)); curve.vr.push(+L.vRaw[k].toFixed(3));
    }
    res.curve = curve;
    res.rate = Math.round(fs);
    return res;
  }

  // ---------- simulated runs (demo + tests) ----------
  // A runner with per-step speed dips. opts: { vmax, tau, back (tripod behind start, m), target (m, sprint)
  //   or steps (vault: number of run-up steps, last = takeoff), hop (true = hop/skip before the run), seed, noise }
  function simulate(o) {
    o = Object.assign({ vmax: 9.2, tau: 1.2, back: 3, noise: 0.025, rate: 1000, seed: 7, wait: 1.2, dip: 0.045 }, o);
    let s = o.seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    // step contact times
    const contacts = []; let t = o.wait;
    if (o.hop) { t += 0.0; contacts.push(t); t += 0.42; contacts.push(t); t += 0.12; contacts.push(t); t += 0.55; }  // walk-in, skip, hop
    const runStart = t;
    const nSteps = o.steps || 40;
    for (let i = 0; i < nSteps; i++) { contacts.push(t); const iv = 0.235 + 0.16 * Math.exp(-i / 2.5); t += iv; }
    const vaultEnd = o.steps ? contacts[contacts.length - 1] : null;
    const dt = 1 / o.rate, T = [], D = [], truth = [];
    let x = 0, micros = 123456, endT = null;
    for (let i = 0; ; i++) {
      const tm = i * dt;
      // base speed: gentle shuffle during a hop/skip, then the real run from runStart
      let vb = 0;
      if (tm > o.wait && tm < runStart) vb = 1.4;
      if (tm >= runStart) vb = o.vmax * (1 - Math.exp(-(tm - runStart) / o.tau)) + (o.hop ? 1.4 * Math.exp(-(tm - runStart) / 0.3) : 0);
      // finish: extra speed gained (+) or lost (−) over the last second before takeoff, m/s
      if (o.finish && vaultEnd != null && tm > vaultEnd - 1) vb += o.finish * Math.min(1, tm - (vaultEnd - 1));
      // dip at each contact
      let dip = 0; for (const c of contacts) { const u = (tm - c) / 0.05; if (u > -3 && u < 3) dip += Math.exp(-u * u); }
      let v = vb * (1 - o.dip * dip);
      if (vaultEnd != null && tm > vaultEnd) v = vb * Math.max(0, 1 - (tm - vaultEnd) * 2.2);   // plant: speed falls away
      x += v * dt; truth.push([tm, x]);
      const done = o.target ? x > o.target + 3 : vaultEnd != null ? tm > vaultEnd + 0.45 : false;
      if (done && endT == null) endT = tm;
      if (endT != null && tm > endT + 0.4) break;
      let cm;
      if (vaultEnd != null && tm > vaultEnd + 0.35) cm = 0;   // athlete rises out of the beam
      else { let meas = o.back + x + gauss() * o.noise; if (rnd() < 0.005) meas -= 1 + rnd() * 2; cm = Math.max(20, Math.round(meas * 100)); }
      micros += Math.round(1e6 / o.rate);
      const lag = rnd() < 0.03 ? Math.round(rnd() * 8000) : Math.round(rnd() * 300);
      T.push((micros + lag) >>> 0); D.push(cm);
    }
    const atX = (X) => { for (const [tt, xx] of truth) if (xx >= X) return tt; return NaN; };
    const xAt = (tt) => { for (const [a, xx] of truth) if (a >= tt) return xx; return NaN; };
    return { raw: { t: T, d: D, maxCm: 9900 }, truth: { atX, xAt, runStart, contacts, nRun: nSteps, vaultEnd } };
  }

  return { process, simulate, FT, set sharpen(v) { SHARPEN = v; }, set repair(v) { REPAIR = v; } };
})();
// ===== ENGINE END =====
