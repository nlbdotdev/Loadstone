import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const mark = fs.readFileSync(path.join(root, 'public/brand/mark.svg'), 'utf8');
const geometry = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="1" y="1" width="62" height="62" rx="15" fill="#1B2227"/><rect x="1.5" y="1.5" width="61" height="61" rx="14.5" stroke="#D9AD87" stroke-opacity=".18"/><g transform="translate(7 7) scale(.78)">${geometry}</g></svg>\n`;
fs.writeFileSync(path.join(root, 'public/brand/icon.svg'), svg);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-icon-'));
const entry = path.join(temp, 'render.cjs');
fs.writeFileSync(
  entry,
  `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank'));`,
);
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [entry], env });
  const page = await app.firstWindow();
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size)
      throw new Error('Icon dimension mismatch.');
    if (size === 512) fs.writeFileSync(path.join(root, 'public/icon.png'), png);
    else frames.push({ size, png });
  }
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const start = 6 + index * 16;
    header[start] = header[start + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(png.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += png.length;
  });
  fs.writeFileSync(
    path.join(root, 'build/icon.ico'),
    Buffer.concat([header, ...frames.map((v) => v.png)]),
  );
  console.log(
    'Rendered SVG, 512px PNG and seven native ICO sizes from the shared mark.',
  );
} finally {
  if (app) await app.close();
  fs.unlinkSync(entry);
  fs.rmdirSync(temp);
}
