// Simulated waist-pod recordings: a known jump or vault → what the BMI160 in the pod would read (its noise, leftover
// offsets after calibration, scale errors, ±16 g limit, 16-bit steps, read 1600×/s and averaged in 4s). Used by the
// tests (test_pod.js) and by the app's "Simulate a jump" when no pod is connected.
const PodSim = (() => {
  const G = 9.80665;
  // ---- motion paths: keyframes (t, position, speed, acceleration) joined by quintic curves ----
  function path(keys) {
    const segs = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, p0, v0, a0] = keys[i], [t1, p1, v1, a1] = keys[i + 1], T = t1 - t0;
      const c = [p0, v0, a0 / 2,
        (20 * (p1 - p0) - (8 * v1 + 12 * v0) * T - (3 * a0 - a1) * T * T) / (2 * T ** 3),
        (30 * (p0 - p1) + (14 * v1 + 16 * v0) * T + (3 * a0 - 2 * a1) * T * T) / (2 * T ** 4),
        (12 * (p1 - p0) - 6 * (v1 + v0) * T - (a0 - a1) * T * T) / (2 * T ** 5)];
      segs.push({ t0, t1, c });
    }
    return (t) => {
      const s = segs.find((x) => t <= x.t1) || segs[segs.length - 1], u = Math.min(Math.max(t - s.t0, 0), s.t1 - s.t0), c = s.c;
      return [c[0] + u * (c[1] + u * (c[2] + u * (c[3] + u * (c[4] + u * c[5])))),
        c[1] + u * (2 * c[2] + u * (3 * c[3] + u * (4 * c[4] + u * 5 * c[5]))),
        2 * c[2] + u * (6 * c[3] + u * (12 * c[4] + u * 20 * c[5]))];
    };
  }
  const deg = Math.PI / 180;
  let GYRO_SIGN = -1;
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // The body moves in the x (forward) / z (up) plane. hip(t), x(t): the hip's height and forward position; phi(t):
  // the pelvis's pitch (0 = upright facing forward; turning backward is negative). The pod sits on the front of the
  // belt, `off` in front of the hip, its outward face along the pelvis's forward direction.
  function record({ dur, hip, xs, phi, bounce, breathe, off = 0.12, hz = 400, over = 4, err }) {
    const out = rawRecord({ dur, hip, xs, phi, bounce, breathe, off, hz: hz * over, err });
    if (over === 1) return out;
    // what the pod sends: the mean of each `over` readings (truth height: the slot's middle)
    const m = { hz, avg: true, ax: [], ay: [], az: [], gx: [], gy: [], gz: [], podZ: [], podX: [] };
    for (let i = 0; i + over <= out.ax.length; i += over) for (const k of ["ax", "ay", "az", "gx", "gy", "gz"]) { let s = 0; for (let j = 0; j < over; j++) s += out[k][i + j]; m[k].push(s / over); }
    for (let i = 0; i + over <= out.ax.length; i += over) { m.podZ.push(out.podZ[i]); m.podX.push(out.podX[i]); }
    return m;
  }
  function rawRecord({ dur, hip, xs, phi, bounce, breathe, off, hz, err }) {
    const N = Math.round(dur * hz), out = { hz, ax: [], ay: [], az: [], gx: [], gy: [], gz: [], podZ: [], podX: [] };
    // the chip sits a few degrees off on its board and in the pod: a fixed tilt the math must not care about
    const m = err.mount;
    for (let i = 0; i < N; i++) {
      const t = i / hz, [z, vz, az0] = hip(t), [x0, , ax0] = xs(t);
      let [p, dp, ddp] = phi(t);
      let zb = 0, azb = 0; if (bounce) [zb, azb] = bounce(t);
      if (breathe) { const [bz, baz, bp, bdp, bddp] = breathe(t); zb += bz; azb += baz; p += bp; dp += bdp; ddp += bddp; }
      // pod position and acceleration: hip + off·n(phi), n = (cos φ, sin φ)
      const c = Math.cos(p), s = Math.sin(p);
      const aX = ax0 + off * (-s * ddp - c * dp * dp), aZ = az0 + azb + off * (c * ddp - s * dp * dp);
      out.podZ.push(z + zb + off * s); out.podX.push(x0 + off * c);
      // what the accelerometer feels (world): motion plus gravity's push-back
      const f = [aX, 0, aZ + G];
      // pod axes (world): x along the strap (sideways), y toward the head, z out of the body
      const sx = [0, 1, 0], sy = [-s, 0, c], sz = [c, 0, s];
      let fs = [f[0] * sx[0] + f[1] * sx[1] + f[2] * sx[2], f[0] * sy[0] + f[1] * sy[1] + f[2] * sy[2], f[0] * sz[0] + f[1] * sz[1] + f[2] * sz[2]];
      let ws = [GYRO_SIGN * dp, 0, 0];
      fs = m(fs); ws = m(ws);
      // the chip's errors
      const AS = 16 * G, LSB_A = AS / 32768, GS = 2000 * deg, LSB_G = GS / 32768;
      fs = fs.map((v, k) => { let y = v * (1 + err.aScale[k]) + err.aBias[k] + err.aNoise * gauss(); y = Math.max(-AS, Math.min(AS - LSB_A, y)); return Math.round(y / LSB_A) * LSB_A; });
      ws = ws.map((v, k) => { let y = v * (1 + err.gScale[k]) + err.gBias[k] + err.gNoise * gauss(); y = Math.max(-GS, Math.min(GS - LSB_G, y)); return Math.round(y / LSB_G) * LSB_G; });
      out.ax.push(fs[0]); out.ay.push(fs[1]); out.az.push(fs[2]); out.gx.push(ws[0]); out.gy.push(ws[1]); out.gz.push(ws[2]);
    }
    return out;
  }
  // a small fixed rotation (the chip not quite square in the pod)
  function mounting(maxDeg) {
    const a = (rnd() * 2 - 1) * maxDeg * deg, b = (rnd() * 2 - 1) * maxDeg * deg, c = (rnd() * 2 - 1) * maxDeg * deg;
    const R = (v) => { let [x, y, z] = v; [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
      [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)]; [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]; return [x, y, z]; };
    return R;
  }
  // the BMI160's errors after the one-time 6-side calibration (and the gyro bias the math measures while still)
  function chipErrors(calibrated = true) {
    const aB = calibrated ? 0.02 : 0.2, aS = calibrated ? 0.003 : 0.02;   // m/s² (≈2 mg vs 20 mg), scale fraction
    return {
      aBias: [0, 1, 2].map(() => aB * gauss()), aScale: [0, 1, 2].map(() => aS * gauss()),
      gBias: [0, 1, 2].map(() => 0.5 * deg * gauss()), gScale: [0, 1, 2].map(() => 0.005 * gauss()),
      aNoise: 180e-6 * G * Math.sqrt(700), gNoise: 0.008 * deg * Math.sqrt(700),   // datasheet noise density × √bandwidth (1600 Hz)
      mount: mounting(4),
    };
  }

  // ---- a countermovement jump: stand, dip, jump, land, stand ----
  // o: { dip: how deep the countermovement goes (m), ecc: s from starting down to the bottom, con: s from the bottom to takeoff }
  function jump(v0, landDrop, o = {}) {
    const dip = o.dip || 0.28, ecc = o.ecc || 0.45, con = o.con || 0.35;
    const z0 = 1.0, zTo = 1.1, t0 = 1.2, tBot = t0 + ecc, tTo = tBot + con;
    const tPeak = tTo + v0 / G, zPeak = zTo + v0 * v0 / (2 * G), zL = zTo - landDrop, tL = tPeak + Math.sqrt(2 * (zPeak - zL) / G), vL = -G * (tL - tPeak);
    const hip = path([[0, z0, 0, 0], [t0, z0, 0, 0], [tBot, z0 - dip, 0, 8 * (dip / 0.28) * (0.45 / ecc) ** 2], [tTo, zTo, v0, -G], [tL, zL, vL, -G], [tL + 0.05, zL - 0.08, -1.5, 45], [tL + 0.3, 0.8, 0, 6], [tL + 0.9, z0, 0, 0], [tL + 2.2, z0, 0, 0]]);
    const xs = path([[0, 0, 0, 0], [tL + 2.2, 0, 0, 0]]);
    const phi = path([[0, 0, 0, 0], [t0, 0, 0, 0], [tBot, 25 * deg, 0, 0], [tTo, -5 * deg, -40 * deg, 0], [tL, 3 * deg, 20 * deg, 0], [tL + 0.3, 20 * deg, 0, 0], [tL + 0.9, 0, 0, 0], [tL + 2.2, 0, 0, 0]]);
    return { dur: tL + 2.2, hip, xs, phi, truth: { tTo, tL, t0, tBot, dip } };
  }
  // ---- a full vault: run, plant and swing up, release, fall into the pit, lie still ----
  function vault(zRel, vRel, matTop) {
    const tRel = 4.1, zPeak = zRel + vRel * vRel / (2 * G), tPeak = tRel + vRel / G, zC = matTop + 0.2;   // hips 0.2 above the mat when lying on it
    const tC = tPeak + Math.sqrt(2 * (zPeak - zC) / G), vC = -G * (tC - tPeak);
    const comp = 0.6, tStop = 2 * comp / -vC * 1.05;        // the mat squashes ~0.6 m
    const hip = path([[0, 1.0, 0, 0], [3.0, 1.0, 0.3, 0], [3.6, 2.6, 4.5, 2], [tRel, zRel, vRel, -G],
      [tC, zC, vC, -G], [tC + tStop * 0.45, zC - comp * 0.7, vC * 0.35, -vC / tStop * 1.6], [tC + tStop, zC - comp, 0, 15], [tC + 0.55, matTop + 0.12, 0, 0], [tC + 2.2, matTop + 0.12, 0, 0]]);
    const xs = path([[0, 0, 9, 0], [3.0, 27, 9, 0], [tRel, 32.8, 1.5, 0], [tC, 32.8 + 1.5 * (tC - tRel), 1.5, 0], [tC + 0.15, 32.9 + 1.5 * (tC - tRel), 0, 0], [tC + 2.2, 32.9 + 1.5 * (tC - tRel), 0, 0]]);
    const phi = path([[0, 0, 0, 0], [3.0, 0, 0, 0], [3.6, -80 * deg, -250 * deg, 0], [tRel, -200 * deg, -150 * deg, 0], [tC, -270 * deg, -30 * deg, 0], [tC + 0.15, -272 * deg, 0, 0], [tC + 2.2, -272 * deg, 0, 0]]);
    const bounce = (t) => (t < 3.0 ? [0.04 * Math.sin(2 * Math.PI * 2.2 * t), -0.04 * (2 * Math.PI * 2.2) ** 2 * Math.sin(2 * Math.PI * 2.2 * t)] : [0, 0]);
    const w = 2 * Math.PI * 0.3, t0 = tC + 0.6;
    const breathe = (t) => { if (t < t0) return [0, 0, 0, 0, 0]; const u = t - t0;
      return [0.002 * Math.sin(w * u), -0.002 * w * w * Math.sin(w * u), 0.4 * deg * Math.sin(w * u), 0.4 * deg * w * Math.cos(w * u), -0.4 * deg * w * w * Math.sin(w * u)]; };
    return { dur: tC + 2.2, hip, xs, phi, bounce, breathe, truth: { tC, zPeak } };
  }

  // a ready-made jump recording of about h metres (for the app): returns { rec, truth }
  function simJump(h, s = Math.floor(Math.random() * 1e9)) {
    seed = s % 2147483646 + 1;
    const v0 = Math.sqrt(2 * G * h), J = jump(v0, 0.03 * rnd()), r = record({ ...J, err: chipErrors(true) });
    const iTo = Math.round(J.truth.tTo * r.hz), iL = Math.round(J.truth.tL * r.hz);
    r.calibrated = true;
    return { rec: r, truth: Math.max(...r.podZ.slice(iTo, iL)) - r.podZ[iTo] };
  }
  // a ready-made vault recording (for the app's simulated runs): faster into the box, a bit higher. { rec, rest, truth }
  function simVault(speed = 8.5, s = Math.floor(Math.random() * 1e9)) {
    seed = s % 2147483646 + 1;
    const zRel = 4.2 + Math.max(-0.6, Math.min(0.9, (speed - 8.3) * 0.35)) + 0.15 * gauss(), vRel = 0.4 + 0.8 * rnd(), mat = 0.8;
    const V = vault(zRel, vRel, mat), r = record({ ...V, err: chipErrors(true) });
    r.calibrated = true;
    return { rec: r, rest: r.podZ[r.podZ.length - 1], truth: V.truth.zPeak };
  }
  // a vault with the LiDAR too: the pod recording, what the LiDAR's run curve would hold (time from the run's
  // start, distance from the start, speed) and the truth (the pod's own path, x past the box, z up)
  function simVaultLidar(speed = 9, s = 7, o = {}) {
    seed = s % 2147483646 + 1;
    const zRel = 4.2 + Math.max(-0.6, Math.min(0.9, (speed - 8.3) * 0.35)) + 0.1 * gauss(), vRel = 0.4 + 0.8 * rnd();
    const V = vault(zRel, vRel, 0.8), r = record({ ...V, err: chipErrors(o.cal !== false) }); r.calibrated = o.cal !== false;
    const BOX = 30.8, tGo = 0;               // the sim's run is already at speed from t = 0: call that the start
    const lid = { t: [], d: [], v: [] };
    for (let t = 0; t <= 3.25; t += 0.02) { const [x, v] = V.xs(t); lid.t.push(+t.toFixed(3)); lid.d.push(x + 0.005 * gauss()); lid.v.push(v); }
    return { rec: r, rest: r.podZ[r.podZ.length - 1], lidar: lid, box: BOX, tTO: 3.0, truth: { x: r.podX.map((x) => x - BOX), z: r.podZ, zPeak: V.truth.zPeak } };
  }
  return { simVaultLidar, path, setGyroSign: (s) => (GYRO_SIGN = s), record, jump, vault, chipErrors, setSeed: (v) => (seed = v), gauss, simJump, simVault };
})();
if (typeof module !== "undefined") module.exports = PodSim;
