// Tests the pod math on simulated jumps and vaults: a known motion → what a BMI160 would read (with its noise,
// leftover offsets after calibration, scale errors, ±16 g limit, 16-bit steps) → the math → compare with the truth.
//   node src/test_pod.js [runs]
const PodEngine = require("./pod.js");
const PodSim = require("./podsim.js");
const G = PodEngine.G;
const { record, jump, vault, chipErrors, gauss } = PodSim;
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

module.exports = PodSim;
if (require.main === module) {
// ---- run ----
const RUNS = +process.argv[2] || 200;
const stats = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); const s = a.slice().sort((x, y) => Math.abs(x) - Math.abs(y)); return { mean: m, sd, p95: Math.abs(s[Math.floor(0.95 * (s.length - 1))]) }; };
const cm = (v) => (v * 100).toFixed(1).padStart(5) + " cm";
const report = (name, e) => { const s = stats(e); console.log(`${name.padEnd(46)} bias ${cm(s.mean)}  spread ±${cm(s.sd).trim()}  95% within ${cm(s.p95).trim()}`); };

for (const cal of [true, false]) {
  seed = 1; PodSim.setSeed(1);
  console.log(`\n== ${cal ? "after the 6-side calibration" : "no calibration"} (${RUNS} runs each) ==`);
  // vertical jumps from 30 to 70 cm, landing 0–4 cm lower than takeoff (bent knees)
  const eV = [], eS = [], eR = [], eF = [], fails = [];
  for (let k = 0; k < RUNS; k++) {
    const hT = 0.3 + 0.4 * rnd(), v0 = Math.sqrt(2 * G * hT), drop = 0.04 * rnd();
    const J = jump(v0, drop), r = record({ ...J, err: chipErrors(cal) });
    // truth for the pod itself: its rise from takeoff to its highest point
    const iTo = Math.round(J.truth.tTo * r.hz), iL = Math.round(J.truth.tL * r.hz), truth = Math.max(...r.podZ.slice(iTo, iL)) - r.podZ[iTo];
    const res = PodEngine.analyzeJump(r);
    if (!res.ok) { fails.push(res.why); continue; }
    eV.push(res.height - truth); eS.push(res.heightSpeed - truth); eR.push(res.heightRise - truth); eF.push(res.heightFlight - truth);
  }
  report("Vertical jump (the answer)", eV);
  report("  from takeoff speed alone", eS);
  report("  from the rise of the height profile alone", eR);
  report("  from flight time (the check)", eF);
  if (fails.length) console.log("  failed:", fails.length, fails[0]);
  // vaults: release 4.2–5.2 m, rising 0.3–1.5 m/s; mat 0.7–0.9 m; the rest height is measured to ±1 cm
  const eP = [], fv = [];
  let maxG = 0;
  for (let k = 0; k < RUNS; k++) {
    const zRel = 4.2 + rnd(), vRel = 0.3 + 1.2 * rnd(), mat = 0.7 + 0.2 * rnd();
    const Vt = vault(zRel, vRel, mat), r = record({ ...Vt, err: chipErrors(cal) });
    for (let i = 0; i < r.ax.length; i++) maxG = Math.max(maxG, Math.hypot(r.ax[i], r.ay[i], r.az[i]) / G);
    const iC = Math.round(Vt.truth.tC * r.hz), truth = Math.max(...r.podZ.slice(Math.round(3.5 * r.hz), iC));
    const restTrue = r.podZ[r.podZ.length - 1];
    const res = PodEngine.analyzeVault(r, restTrue + 0.01 * gauss());
    if (!res.ok) { fv.push(res.why); continue; }
    eP.push(res.peak - truth);
  }
  report("Vault, peak hip height", eP);
  if (fv.length) console.log("  failed:", fv.length, fv[0]);
  console.log(`  (hardest landing in these runs: ${maxG.toFixed(1)} g; the chip reads up to 16 g)`);
}
}
