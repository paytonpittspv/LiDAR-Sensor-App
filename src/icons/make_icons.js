// Renders the app icon (a wordmark: LiDAR over SENSOR, white on the pink→purple→blue gradient) into the PNG sizes
// phones use. Run: node src/icons/make_icons.js  (needs Playwright)
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', '..', 'icons');
const font = (f) => fs.readFileSync(path.join(__dirname, '..', 'fonts', f)).toString('base64');
const FACE = `@font-face{font-family:B;src:url(data:font/woff;base64,${font('BarlowCondensed-ExtraBold.woff')}) format("woff");font-weight:800}`;
fs.mkdirSync(out, { recursive: true });
const jobs = [
  ['apple-touch-icon.png', 180, 0, 1],     // iPhone home screen (iOS rounds the corners itself)
  ['icon-192.png', 192, 0.22, 1],          // Android / Chrome, rounded
  ['icon-512.png', 512, 0.22, 1],
  ['icon-maskable-512.png', 512, 0, 0.78], // Android adaptive icon: full bleed, the words inside the safe circle
  ['favicon-32.png', 32, 0.22, 1, true],   // browser tab: LiDAR alone
];
const html = (s, round, k, small) => `<html><head><style>${FACE}
body{margin:0;background:transparent}
.i{width:${s}px;height:${s}px;border-radius:${round * s}px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#ff2d8a 0%,#8b5cf6 52%,#22b8ff 100%);color:#fff;font-family:B;font-weight:800;line-height:.82}
.l{font-size:${(small ? 0.46 : 0.36) * s * k}px;letter-spacing:${-0.01 * s}px;text-shadow:0 ${0.012 * s}px ${0.03 * s}px rgba(30,10,70,.25)}
.s{font-size:${0.155 * s * k}px;letter-spacing:${0.028 * s * k}px;margin-top:${0.045 * s * k}px;padding-left:${0.028 * s * k}px;opacity:.95}
.bar{width:${0.5 * s * k}px;height:${Math.max(1, 0.022 * s * k)}px;border-radius:9px;background:#fff;opacity:.9;margin-top:${0.05 * s * k}px}
</style></head><body><div class="i"><div class="l">LiDAR</div>${small ? "" : `<div class="bar"></div><div class="s">SENSOR</div>`}</div></body></html>`;
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  for (const [name, size, round, k, small] of jobs) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(html(size, round, k, small)); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
    console.log(name, fs.statSync(path.join(out, name)).size, 'bytes');
  }
  await b.close();
  require('child_process').execFileSync('python3', [path.join(__dirname, 'shrink.py'), out], { stdio: 'inherit' });
})();
