import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '..');
const output = path.join(repo, 'release', 'steam-artwork');
fs.mkdirSync(output, { recursive: true });
// Reuse the original native mark, without compiling or executing the component.
const component = fs.readFileSync(path.join(repo, 'src/Logo.svelte'), 'utf8');
const mark = component.slice(
  component.indexOf('  <path'),
  component.lastIndexOf('</svg>'),
);
// Original geometric lettering: no font files or third-party artwork are embedded.
const glyphs = {
  L: 'M4 2V54H38',
  O: 'M12 2H30L38 10V46L30 54H12L4 46V10Z',
  A: 'M2 54L20 2H24L42 54M10 34H34',
  D: 'M4 2H25L40 17V39L25 54H4Z',
  S: 'M39 2H12L4 10V20L12 28H30L38 36V46L30 54H3',
  T: 'M2 2H42M22 2V54',
  N: 'M4 54V2L40 54V2',
  E: 'M38 2H4V54H38M4 27H31',
};
const title = [...'LOADSTONE']
  .map(
    (letter, i) =>
      `<path transform="translate(${i * 56} 0)" d="${glyphs[letter]}"/>`,
  )
  .join('');
const wordmark = (x, y, width) =>
  `<g transform="translate(${x} ${y}) scale(${width / 494})" fill="none" stroke="#f4e9db" stroke-width="5" stroke-linejoin="round" stroke-linecap="square">${title}</g>`;
const compass = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 72})">${mark}</g>`;
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
  const symbol = transparent ? 200 : hero ? 500 : portrait ? w * 0.5 : h * 0.47;
  let body = '';
  if (!transparent) {
    body += `<defs><radialGradient id="glow"><stop stop-color="#354443"/><stop offset="1" stop-color="#111819"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#glow)"/>`;
    const cx = w * (hero ? 0.6 : 0.5),
      cy = h * 0.45;
    for (let i = 1; i <= 7; i++)
      body += `<circle cx="${cx}" cy="${cy}" r="${h * (0.16 + i * 0.105)}" fill="none" stroke="#b68058" stroke-opacity="${0.17 - i * 0.015}" stroke-width="${Math.max(1, h / 900)}"/>`;
    body += `<path d="M0 ${h * 0.87}L${w * 0.28} ${h * 0.64}L${w * 0.49} ${h * 0.88}L${w * 0.78} ${h * 0.6}L${w} ${h * 0.81}V${h}H0Z" fill="#101718" opacity=".65"/>`;
  }
  if (transparent) body += compass(25, 40, symbol) + wordmark(250, 95, 990);
  else if (hero)
    body += compass(w * 0.6 - (symbol * 32) / 72, (h - symbol) / 2, symbol);
  else {
    const y = portrait ? h * 0.19 : h * 0.12;
    body += compass(w / 2 - (symbol * 32) / 72, y, symbol);
    const width = w * (portrait ? 0.82 : 0.75);
    body += wordmark((w - width) / 2, h * 0.72, width);
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
  app = await electron.launch({ args: [entry] });
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
