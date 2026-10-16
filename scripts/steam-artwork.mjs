import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '..');
const output = path.join(repo, 'release', 'steam-artwork');
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(
  path.join(repo, 'public/brand/mark.svg'),
  'utf8',
);
const mark = source.slice(
  source.indexOf('>') + 1,
  source.lastIndexOf('</svg>'),
);
// Render the installed Windows UI typeface; no font files are redistributed.
const wordmark = (x, y, size, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="600" letter-spacing="${-size * 0.045}" fill="#F4EDE3">Loadstone</text>`;
const symbol = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 64})">${mark}</g>`;
const assets = [
  ['header', 920, 430],
  ['small', 462, 174],
  ['main', 1232, 706],
  ['vertical', 748, 896],
  ['library-capsule', 600, 900],
  ['library-header', 920, 430],
  ['library-hero', 3840, 1240],
  ['library-logo', 1280, 280],
];
function artwork(name, w, h) {
  const transparent = name === 'library-logo',
    hero = name === 'library-hero';
  const portrait = h > w;
  let body = '';
  if (!transparent) {
    body += `<defs><radialGradient id="glow" cx="65%" cy="25%" r="85%"><stop stop-color="#394449"/><stop offset=".55" stop-color="#232C31"/><stop offset="1" stop-color="#141B20"/></radialGradient><linearGradient id="edge" x2="1" y2="1"><stop stop-color="#D9AD87" stop-opacity=".04"/><stop offset=".5" stop-color="#D9AD87" stop-opacity=".22"/><stop offset="1" stop-color="#D9AD87" stop-opacity=".02"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#glow)"/>`;
    // Two quiet mineral planes leave space for the identity at every crop.
    body += `<path d="M${w * 0.56} 0H${w}V${h * 0.57}L${w * 0.26} ${h}H0V${h * 0.69}Z" fill="#768183" opacity=".035"/><path d="M0 ${h * 0.88}L${w} ${h * 0.23}" stroke="url(#edge)" stroke-width="${Math.max(1, h / 700)}"/>`;
  }
  if (transparent)
    body += symbol(24, 10, 256) + wordmark(304, 200, 190, 'start');
  else if (hero) body += symbol(w * 0.65 - 260, (h - 520) / 2, 520);
  else if (portrait) {
    const size = w * 0.58;
    body +=
      symbol((w - size) / 2, h * 0.19, size) +
      wordmark(w / 2, h * 0.76, w * 0.151);
  } else if (name === 'small') {
    body +=
      symbol(w * 0.064, h * 0.12, h * 0.76) +
      wordmark(w * 0.375, h * 0.62, h * 0.29, 'start');
  } else {
    const size = h * 0.49;
    body +=
      symbol((w - size) / 2, h * 0.1, size) +
      wordmark(w / 2, h * 0.79, w * 0.112);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-artwork-'));
const entry = path.join(temp, 'render.cjs');
fs.writeFileSync(
  entry,
  `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{new BrowserWindow({show:false,width:1280,height:720,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank');});`,
);
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [entry], env });
  const page = await app.firstWindow();
  const inventory = [];
  for (const [name, width, height] of assets) {
    const svg = artwork(name, width, height);
    fs.writeFileSync(path.join(output, `${name}.svg`), svg + '\n');
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height)
      throw new Error(`Wrong dimensions: ${name}`);
    fs.writeFileSync(path.join(output, `${name}.png`), png);
    inventory.push({
      name,
      width,
      height,
      sha256: crypto.createHash('sha256').update(png).digest('hex'),
    });
  }
  fs.writeFileSync(
    path.join(output, 'inventory.json'),
    JSON.stringify({ releaseApproved: false, assets: inventory }, null, 2) +
      '\n',
  );
  console.log(`Rendered ${inventory.length} brand assets in ${output}`);
} finally {
  if (app) await app.close();
  fs.unlinkSync(entry);
  fs.rmdirSync(temp);
}
