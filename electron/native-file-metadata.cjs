const fs = require('node:fs');
const { ordinaryFile } = require('./native-package.cjs');

// Recipe timestamps are integer UTC milliseconds. Filesystems and Node may
// return a sub-millisecond fraction after converting through seconds.
function matchesMtime(stat, output) {
  return (
    output.mtimeMs === undefined || Math.round(stat.mtimeMs) === output.mtimeMs
  );
}
function applyMtime(file, output) {
  if (output.mtimeMs === undefined) return;
  const before = ordinaryFile(file, output.bytes);
  const handle = fs.openSync(file, 'r+');
  try {
    const opened = fs.fstatSync(handle);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      before.size !== opened.size ||
      before.mtimeMs !== opened.mtimeMs ||
      before.ctimeMs !== opened.ctimeMs ||
      opened.size !== output.bytes
    )
      throw new Error(
        'Reconstructed file changed before setting its modification time.',
      );
    fs.futimesSync(handle, opened.atimeMs / 1000, output.mtimeMs / 1000);
    fs.fsyncSync(handle);
    const after = ordinaryFile(file, output.bytes);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      !matchesMtime(after, output)
    )
      throw new Error('Could not preserve the recipe file modification time.');
  } finally {
    fs.closeSync(handle);
  }
}
module.exports = { matchesMtime, applyMtime };
