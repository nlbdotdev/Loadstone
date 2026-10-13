import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { materializeNative } = require('../electron/native-materializer.cjs');
const { ordinaryFile } = require('../electron/native-package.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');
const [file, inputsFile, destination, ...extra] = process.argv.slice(2);
if (
  !file ||
  !inputsFile ||
  !destination ||
  (extra.length &&
    (extra.length !== 2 || extra[0] !== '--sevenzip' || !extra[1]))
)
  throw new Error(
    'Usage: materialize-native.mjs <package.loadstone> <private-inputs.json> <new-absolute-destination> [--sevenzip <trusted-absolute-7z.exe>]',
  );
ordinaryFile(inputsFile, 1_000_000);
const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
if (
  !inputs ||
  typeof inputs !== 'object' ||
  Array.isArray(inputs) ||
  Object.keys(inputs).some(
    (v) => !['games', 'archives', 'prerequisites'].includes(v),
  )
)
  throw new Error(
    'Inputs may contain only games, archives and prerequisites path maps.',
  );
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const sevenZip = extra.length
  ? await createSevenZip(extra[1], { signal: controller.signal })
  : undefined;
const result = await materializeNative(file, destination, {
  sevenZip,
  games: inputs.games,
  archives: inputs.archives,
  prerequisites: inputs.prerequisites,
  signal: controller.signal,
  progress: (value) => {
    if (value.completed % 100 === 0 || value.completed === value.total)
      console.log(JSON.stringify(value));
  },
});
console.log(JSON.stringify(result, null, 2));
