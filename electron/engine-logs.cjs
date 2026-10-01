const fs = require('node:fs');
const path = require('node:path');
const { canonical } = require('./live-catalog.cjs');
function redact(line, secret = '') {
  let value = String(line);
  if (secret) value = value.split(secret).join('[redacted]');
  return value
    .replace(/https?:\/\/[^\s"<>]+/gi, (url) => {
      try {
        const u = new URL(url);
        return u.origin + u.pathname + (u.search ? '?[redacted]' : '');
      } catch {
        return '[URL]';
      }
    })
    .replace(
      /(apikey|authorization|access_token|refresh_token)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .replace(/[\x00-\x08\x0b-\x1f]/g, '')
    .slice(0, 1000);
}

function isRuntimeLog(relative) {
  return /^logs\/wabbajack-cli(?:\.current|\.[0-9]+|_[0-9]+)\.log$/i.test(relative);
}
function sanitizeLogs(root, key) {
  const logs = path.join(root, 'logs');
  if (!fs.existsSync(logs)) return;
  if (
    canonical(logs).toLowerCase() !== path.resolve(logs).toLowerCase() ||
    fs.lstatSync(logs).isSymbolicLink()
  )
    throw new Error('The installer log folder is redirected.');
  for (const name of fs.readdirSync(logs)) {
    if (!isRuntimeLog('logs/' + name)) continue;
    const file = path.join(logs, name),
      stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      canonical(file).toLowerCase() !== path.resolve(file).toLowerCase()
    )
      throw new Error('An installer log is redirected or linked.');
    const text =
      stat.size <= 10_000_000
        ? fs
            .readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .map((line) => redact(line, key))
            .join('\n')
        : 'Oversized engine log omitted. Review the bounded installation output in Loadstone.';
    fs.writeFileSync(file, text);
  }
}
module.exports = { redact, isRuntimeLog, sanitizeLogs };
