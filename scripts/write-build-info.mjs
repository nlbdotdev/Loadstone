import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
let commit = null,
  dirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  );
} catch {
  /* Source archives can be built without a Git checkout. */
}
fs.writeFileSync(
  'dist/build-info.json',
  JSON.stringify(
    {
      commit,
      dirty,
      lockfileSha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync('pnpm-lock.yaml'))
        .digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
