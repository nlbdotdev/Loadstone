const fs = require('node:fs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');

// Names in real download caches can have the wrong extension. This only selects
// a parser; the selected parser must still verify hashes and the full archive.
function archiveKind(file) {
  const before = ordinaryFile(file, 50_000_000_000);
  const header = Buffer.alloc(8);
  const descriptor = fs.openSync(file, 'r');
  let bytes;
  try {
    bytes = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!sameFile(before, ordinaryFile(file, 50_000_000_000)))
    throw new Error('Archive changed during format detection.');
  const signature = header.subarray(0, bytes).toString('hex');
  if (signature.startsWith('504b0304') || signature.startsWith('504b0506'))
    return 'zip';
  if (signature.startsWith('377abcaf271c')) return '7z';
  if (signature.startsWith('526172211a0700')) return 'rar';
  if (signature.startsWith('526172211a070100')) return 'rar5';
  throw new Error('Unsupported or embedded archive signature.');
}
module.exports = { archiveKind };
