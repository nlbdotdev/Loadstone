const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ordinaryFile, sameFile } = require('./native-package.cjs');

function nexusFilePage(source) {
  if (
    source?.type !== 'nexus-archive' ||
    !['falloutnv', 'fallout3', 'skyrimspecialedition', 'fallout4'].includes(
      source.game,
    ) ||
    ![source.modId, source.fileId].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    )
  )
    throw new Error('Choose a declared Nexus archive.');
  return `https://www.nexusmods.com/${source.game}/mods/${source.modId}?tab=files&file_id=${source.fileId}`;
}

async function verifyLocalArchive(file, source, { signal, progress } = {}) {
  if (
    !Number.isSafeInteger(source?.bytes) ||
    source.bytes < 0 ||
    source.bytes > 50_000_000_000 ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    throw new Error('The archive exceeds the supported verification limits.');
  try {
    signal?.throwIfAborted();
    const before = ordinaryFile(file, source.bytes);
    if (before.size !== source.bytes) throw new Error();
    const hash = crypto.createHash('sha256');
    let bytes = 0,
      last = 0;
    progress?.({ bytes, totalBytes: source.bytes });
    for await (const chunk of fs.createReadStream(file, { signal })) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > source.bytes) throw new Error();
      hash.update(chunk);
      const now = Date.now();
      if (now - last >= 250) {
        progress?.({ bytes, totalBytes: source.bytes });
        last = now;
      }
    }
    signal?.throwIfAborted();
    if (
      bytes !== source.bytes ||
      hash.digest('hex') !== source.sha256 ||
      !sameFile(before, ordinaryFile(file, source.bytes))
    )
      throw new Error();
    progress?.({ bytes, totalBytes: source.bytes });
    return path.resolve(file);
  } catch (error) {
    throw new Error(
      signal?.aborted
        ? 'Archive verification cancelled. The previous selection and files are unchanged.'
        : error.code === 'ENOENT'
          ? 'The archive was not found. Download the original file and choose it here; the previous selection is unchanged.'
          : 'This archive does not match the required size and SHA-256, or changed during verification. Choose the exact original file; the previous selection is unchanged.',
    );
  }
}
module.exports = { nexusFilePage, verifyLocalArchive };
