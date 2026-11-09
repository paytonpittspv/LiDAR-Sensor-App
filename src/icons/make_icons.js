// Renders icon.svg into the PNG sizes phones use. Run: node src/icons/make_icons.js  (needs Playwright)
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8'), out = path.join(__dirname, '..', '..', 'icons');
fs.mkdirSync(out, { recursive: true });
const jobs = [
  ['apple-touch-icon.png', 180, 0],     // iPhone home screen (iOS rounds the corners itself)
  ['icon-192.png', 192, 0.22],          // Android / Chrome, rounded
  ['icon-512.png', 512, 0.22],
  ['icon-maskable-512.png', 512, 0],    // Android adaptive icon: full bleed, the mark sits inside the safe circle
  ['favicon-32.png', 32, 0.22],
];
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  for (const [name, size, round] of jobs) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;border-radius:${round * size}px;overflow:hidden">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
    console.log(name, fs.statSync(path.join(out, name)).size, 'bytes');
  }
  await b.close();
})();
