const { relativeFile } = require('./manifest.cjs');
function zipPath(entry) {
  const directory = entry.fileName.endsWith('/'),
    name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
  const type = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (
    !relativeFile(name) ||
    name.includes('\\') ||
    name !== name.normalize('NFC') ||
    (type && type !== (directory ? 0o040000 : 0o100000)) ||
    entry.generalPurposeBitFlag & 1 ||
    ![0, 8].includes(entry.compressionMethod)
  )
    throw new Error('Unsafe or unsupported ZIP entry.');
  return { name, directory };
}
module.exports = { zipPath };
