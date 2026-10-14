import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { inspectBsa104 } = require('../electron/bsa104.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length)
  throw new Error(
    'Usage: inspect-bsa.mjs <local.bsa> <new-private-report.json>',
  );
const source = path.resolve(input),
  target = path.resolve(output);
if (fs.existsSync(target)) throw new Error('Choose a new report path.');
if (contains(canonical(path.dirname(source)), canonical(target)))
  throw new Error('Keep the report outside the archive directory.');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const report = await inspectBsa104(source, {
  signal: controller.signal,
  progress: (value) => console.log(JSON.stringify(value)),
});
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    members: report.members.length,
    totalBytes: report.totalBytes,
    sha256: report.archive.sha256,
    installable: false,
  }),
);
