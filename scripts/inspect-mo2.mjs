import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { inspectMo2 } = require('../electron/installed-inventory.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');
const [root, output, ...flags] = process.argv.slice(2);
if (
  !root ||
  !output ||
  flags.some((v) => !['--hash-files', '--installation-files'].includes(v))
)
  throw new Error(
    'Usage: node scripts/inspect-mo2.mjs <instance> <new-local-report.json> [--hash-files] [--installation-files]',
  );
const target = path.resolve(output);
if (fs.existsSync(target))
  throw new Error('Choose a new report path to preserve prior evidence.');
if (contains(canonical(root), canonical(target)))
  throw new Error('Keep inventory reports outside the inspected instance.');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const report = await inspectMo2(root, {
  signal: controller.signal,
  hashFiles: flags.includes('--hash-files'),
  installationFiles: flags.includes('--installation-files'),
  progress: (v) => {
    if (
      ['files', 'hashes', 'stability'].includes(v.phase) ||
      v.completed % 25 === 0
    )
      console.log(JSON.stringify(v));
  },
});
for (const folder of [
  report.source.gameFolder,
  report.source.modsFolder,
  report.source.profilesFolder,
  report.source.overwriteFolder,
  report.source.downloadsFolder,
]) {
  if (contains(canonical(folder), canonical(target)))
    throw new Error(
      'Keep inventory reports outside source game/mod/profile directories.',
    );
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify(
    { report: target, ...report.summary, installable: false },
    null,
    2,
  ),
);
