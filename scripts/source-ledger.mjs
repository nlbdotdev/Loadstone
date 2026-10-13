import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSourceLedger } = require('../electron/source-ledger.cjs');
const { ordinaryFile } = require('../electron/native-package.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');
const [input, output, ...downloads] = process.argv.slice(2);
if (!input || !output || !downloads.length)
  throw new Error(
    'Usage: source-ledger.mjs <hashed-inventory.json> <new-private-ledger.json> <download-folder> [...]',
  );
ordinaryFile(input, 128_000_000);
const content = fs.readFileSync(input),
  inventory = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(content),
  );
const target = path.resolve(output);
if (fs.existsSync(target))
  throw new Error('Choose a new ledger path to preserve prior evidence.');
const source = inventory.source || {};
for (const folder of [
  ...downloads,
  source.root,
  source.gameFolder,
  source.modsFolder,
  source.profilesFolder,
  source.profileFolder,
  source.overwriteFolder,
].filter(Boolean)) {
  if (contains(canonical(folder), canonical(target)))
    throw new Error(
      'Keep ledgers outside installed source and download directories.',
    );
}
const ledger = await buildSourceLedger(inventory, downloads, {
  progress: (v) => {
    if (v.completed % 25 === 0) console.log(JSON.stringify(v));
  },
});
ledger.inventory = {
  file: path.resolve(input),
  sha256: crypto.createHash('sha256').update(content).digest('hex'),
};
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(ledger, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify(
    { ...ledger.summary, installable: false, publicationApproved: false },
    null,
    2,
  ),
);
