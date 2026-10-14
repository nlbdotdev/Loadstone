import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapBsaSources } = require('../electron/bsa-mapping.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');
const { ordinaryFile, sameFile } = require('../electron/native-package.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');
const { readSourceHints } = require('../electron/source-hints.cjs');
const [input, output, ...args] = process.argv.slice(2);
const containerMods = [];
let sevenZipPath;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mod' && args[i + 1] && !args[i + 1].startsWith('--'))
    containerMods.push(args[++i]);
  else if (
    args[i] === '--7zip' &&
    !sevenZipPath &&
    args[i + 1] &&
    !args[i + 1].startsWith('--')
  )
    sevenZipPath = args[++i];
  else throw new Error('Unsupported or incomplete BSA mapping option.');
}
if (!input || !output || !containerMods.length)
  throw new Error(
    'Usage: map-bsa-sources.mjs <private-ledger.json> <new-private-mapping.json> --mod "Container mod" [--mod "Another mod"] [--7zip absolute-path-to-7z.exe]',
  );
function read(file) {
  const before = ordinaryFile(file, 128_000_000),
    content = fs.readFileSync(file);
  if (!sameFile(before, ordinaryFile(file, 128_000_000)))
    throw new Error('Mapping input changed while reading.');
  return {
    value: JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(content),
    ),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}
const ledgerInput = read(input),
  ledger = ledgerInput.value;
if (typeof ledger.inventory?.file !== 'string')
  throw new Error('Use a ledger with its inventory reference.');
const inventoryInput = read(ledger.inventory.file);
if (inventoryInput.sha256 !== ledger.inventory.sha256)
  throw new Error('Referenced inventory has changed.');
const verifyHints = () => {
  if (
    ledger.sourceHints &&
    readSourceHints(ledger.sourceHints.file).reference.sha256 !==
      ledger.sourceHints.sha256
  )
    throw new Error('Referenced source hints have changed.');
};
verifyHints();
const source = inventoryInput.value.source,
  target = path.resolve(output);
const protectTarget = () => {
  if (fs.existsSync(target))
    throw new Error('Choose a new mapping report path.');
  for (const root of [
    source.root,
    source.gameFolder,
    source.modsFolder,
    source.profilesFolder,
    source.profileFolder,
    source.overwriteFolder,
    ...ledger.mods.flatMap((mod) =>
      mod.archiveCandidates.map((v) => path.dirname(v.archive)),
    ),
  ].filter(Boolean))
    if (contains(canonical(root), canonical(target)))
      throw new Error(
        'Keep mappings outside source installations and downloads.',
      );
};
protectTarget();
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const mapped = await mapBsaSources(ledger, {
  containerMods,
  modsFolder: source.modsFolder,
  signal: controller.signal,
  sevenZip: sevenZipPath ? await createSevenZip(sevenZipPath) : undefined,
  progress: (value) => console.log(JSON.stringify(value)),
});
if (
  read(input).sha256 !== ledgerInput.sha256 ||
  read(ledger.inventory.file).sha256 !== inventoryInput.sha256
)
  throw new Error('Referenced ledger or inventory changed during mapping.');
verifyHints();
mapped.bsaMapping.inputLedger = {
  file: path.resolve(input),
  sha256: ledgerInput.sha256,
};
const encoded = Buffer.from(JSON.stringify(mapped, null, 2) + '\n');
if (encoded.length > 128_000_000)
  throw new Error('Mapping report exceeds its size limit.');
controller.signal.throwIfAborted();
protectTarget();
fs.mkdirSync(path.dirname(target), { recursive: true });
protectTarget();
fs.writeFileSync(target, encoded, { flag: 'wx' });
const { sources, inspectedArchives, inspectedContainers, issues, ...summary } =
  mapped.bsaMapping;
console.log(
  JSON.stringify(
    {
      ...summary,
      sources: sources.length,
      inspectedArchives: inspectedArchives.length,
      inspectedContainers: inspectedContainers.length,
      issues: issues.length,
      installable: false,
      publicationApproved: false,
    },
    null,
    2,
  ),
);
