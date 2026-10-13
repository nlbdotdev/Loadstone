import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapZipSources } = require('../electron/archive-mapping.cjs');
const { ordinaryFile } = require('../electron/native-package.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length)
  throw new Error(
    'Usage: map-zip-sources.mjs <private-ledger.json> <new-private-mapping.json>',
  );
ordinaryFile(input, 128_000_000);
const ledger = JSON.parse(fs.readFileSync(input, 'utf8'));
ordinaryFile(ledger.inventory.file, 128_000_000);
const inventoryBytes = fs.readFileSync(ledger.inventory.file);
if (
  crypto.createHash('sha256').update(inventoryBytes).digest('hex') !==
  ledger.inventory.sha256
)
  throw new Error('Referenced inventory has changed.');
const source = JSON.parse(inventoryBytes.toString('utf8')).source;
const target = path.resolve(output);
if (fs.existsSync(target)) throw new Error('Choose a new mapping report path.');
const protectedRoots = [
  source.root,
  source.gameFolder,
  source.modsFolder,
  source.profilesFolder,
  source.profileFolder,
  source.overwriteFolder,
  ...ledger.mods.flatMap((mod) =>
    mod.archiveCandidates.map((v) => path.dirname(v.archive)),
  ),
].filter(Boolean);
for (const root of protectedRoots)
  if (contains(canonical(root), canonical(target)))
    throw new Error(
      'Keep mappings outside source installations and downloads.',
    );
const mapped = await mapZipSources(ledger, {
  progress: (v) => {
    if (v.inspected % 10 === 0) console.log(JSON.stringify(v));
  },
});
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(mapped, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify(
    {
      inspectedZipArchives: mapped.mapping.inspected.length,
      archivesUnresolved: mapped.mapping.issues.length,
      matchedInstalledFiles: mapped.mapping.matchedInstalledFiles,
      unmatchedInstalledFiles: mapped.mapping.unmatchedInstalledFiles,
      installable: false,
    },
    null,
    2,
  ),
);
