const fs = require('node:fs');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createInflate } = require('node:zlib');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { relativeFile } = require('./manifest.cjs');

const limits = Object.freeze({
  archiveBytes: 0xffffffff,
  metadataBytes: 64 * 1024 * 1024,
  folders: 100000,
  files: 500000,
  memberBytes: 1_000_000_000,
  totalBytes: 20_000_000_000,
  milliseconds: 300000,
});
function demand(ok, message) {
  if (!ok) throw new Error(`BSA inspection: ${message}`);
}
function ascii(bytes) {
  for (const value of bytes)
    demand(
      value >= 32 && value <= 126,
      'only printable ASCII names are supported.',
    );
  return bytes.toString('ascii');
}
function normalizedName(bytes, folder = false) {
  const name = ascii(bytes).replaceAll('\\', '/');
  demand((folder && !name) || relativeFile(name), 'unsafe member name.');
  return name;
}

// Original, deliberately limited BSA 104 reader. See docs/bsa-inspection.md
// for format references and unsupported variants. No payload is written to disk.
async function inspectBsa104(file, options = {}) {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(limits.milliseconds),
      ])
    : AbortSignal.timeout(limits.milliseconds);
  signal.throwIfAborted();
  const expected = options.expected;
  if (expected)
    demand(
      Number.isSafeInteger(expected.bytes) &&
        expected.bytes >= 36 &&
        expected.bytes <= limits.archiveBytes &&
        /^[a-f0-9]{64}$/.test(expected.sha256),
      'invalid expected fingerprint.',
    );
  const before = ordinaryFile(file, limits.archiveBytes);
  demand(before.size >= 36, 'truncated header.');
  const fd = fs.openSync(file, 'r');
  function unchanged() {
    demand(
      sameFile(before, fs.fstatSync(fd)) &&
        sameFile(before, ordinaryFile(file, limits.archiveBytes)),
      'input changed during inspection.',
    );
  }
  function read(offset, length) {
    signal.throwIfAborted();
    demand(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(length) &&
        offset >= 0 &&
        length >= 0 &&
        length <= limits.metadataBytes &&
        offset + length <= before.size,
      'read exceeds input bounds.',
    );
    const bytes = Buffer.alloc(length);
    demand(
      fs.readSync(fd, bytes, 0, length, offset) === length,
      'truncated input.',
    );
    return bytes;
  }
  async function digestRange(offset, storedBytes, bytes, compressed = false) {
    signal.throwIfAborted();
    const digest = crypto.createHash('sha256');
    let count = 0;
    if (storedBytes) {
      const input = fs.createReadStream(null, {
        fd,
        autoClose: false,
        start: offset,
        end: offset + storedBytes - 1,
      });
      const sink = new Writable({
        write(chunk, encoding, callback) {
          count += chunk.length;
          if (count > bytes)
            return callback(
              new Error('BSA inspection: output exceeds declared size.'),
            );
          digest.update(chunk);
          callback();
        },
      });
      if (compressed) {
        const inflate = createInflate();
        await pipeline(input, inflate, sink, { signal });
        demand(
          inflate.bytesWritten === storedBytes,
          'trailing compressed data.',
        );
      } else await pipeline(input, sink, { signal });
    } else demand(!compressed, 'missing compressed data.');
    demand(count === bytes, 'output differs from declared size.');
    return digest.digest('hex');
  }
  try {
    unchanged();
    const sha256 = await digestRange(0, before.size, before.size);
    demand(
      !expected ||
        (before.size === expected.bytes && sha256 === expected.sha256),
      'input differs from expected fingerprint.',
    );
    const header = read(0, 36),
      flags = header.readUInt32LE(12),
      folderCount = header.readUInt32LE(16),
      fileCount = header.readUInt32LE(20),
      folderNameBytes = header.readUInt32LE(24),
      fileNameBytes = header.readUInt32LE(28);
    demand(
      header.subarray(0, 4).equals(Buffer.from('42534100', 'hex')),
      'invalid signature.',
    );
    demand(header.readUInt32LE(4) === 104, 'only version 104 is supported.');
    demand(
      header.readUInt32LE(8) === 36 && (flags & 3) === 3 && !(flags & ~0x187),
      'unsupported index layout or flags.',
    );
    demand(
      folderCount <= limits.folders && fileCount <= limits.files,
      'too many index records.',
    );
    const metadataEnd =
      36 +
      folderCount * 16 +
      folderCount +
      folderNameBytes +
      fileCount * 16 +
      fileNameBytes;
    const metadata = read(0, metadataEnd),
      entries = [],
      folders = new Set();
    let position = 36 + folderCount * 16,
      folderNamesRead = 0;
    for (let i = 0; i < folderCount; i++) {
      signal.throwIfAborted();
      const count = metadata.readUInt32LE(36 + i * 16 + 8),
        offset = metadata.readUInt32LE(36 + i * 16 + 12);
      demand(
        offset === position + fileNameBytes &&
          entries.length + count <= fileCount,
        'invalid folder offset or count.',
      );
      const length = metadata[position++];
      demand(
        length > 0 &&
          position + length + count * 16 <= metadataEnd &&
          metadata[position + length - 1] === 0,
        'invalid folder block.',
      );
      const folder = normalizedName(
        metadata.subarray(position, position + length - 1),
        true,
      );
      demand(!folders.has(folder.toLowerCase()), 'duplicate folder name.');
      folders.add(folder.toLowerCase());
      folderNamesRead += length;
      position += length;
      for (let j = 0; j < count; j++, position += 16) {
        const rawSize = metadata.readUInt32LE(position + 8);
        demand(!(rawSize & 0x80000000), 'unsupported file size flags.');
        entries.push({
          folder,
          compressed: Boolean(flags & 4) !== Boolean(rawSize & 0x40000000),
          storedBytes: rawSize & 0x3fffffff,
          offset: metadata.readUInt32LE(position + 12),
        });
      }
    }
    demand(
      entries.length === fileCount &&
        folderNamesRead === folderNameBytes &&
        position + fileNameBytes === metadataEnd,
      'inconsistent index totals.',
    );
    const paths = new Set();
    for (const entry of entries) {
      const end = metadata.indexOf(0, position);
      demand(end >= position && end < metadataEnd, 'unterminated file name.');
      const name = normalizedName(metadata.subarray(position, end));
      demand(!name.includes('/'), 'file name contains a folder separator.');
      entry.path = [entry.folder, name].filter(Boolean).join('/');
      demand(
        relativeFile(entry.path) && !paths.has(entry.path.toLowerCase()),
        'unsafe or duplicate member path.',
      );
      paths.add(entry.path.toLowerCase());
      position = end + 1;
      demand(
        entry.offset >= metadataEnd &&
          entry.offset + entry.storedBytes <= before.size,
        'member exceeds data bounds.',
      );
    }
    demand(position === metadataEnd, 'unused file name data.');
    for (const name of [...paths, ...folders]) {
      const parts = name.split('/');
      if (folders.has(name))
        demand(!paths.has(name), 'file and folder paths overlap.');
      while (parts.length > 1) {
        parts.pop();
        demand(!paths.has(parts.join('/')), 'file and folder paths overlap.');
      }
    }
    let previous,
      sharedExtents = 0;
    for (const entry of [...entries].sort(
      (a, b) => a.offset - b.offset || a.storedBytes - b.storedBytes,
    )) {
      if (previous && entry.offset < previous.offset + previous.storedBytes) {
        demand(
          entry.offset === previous.offset &&
            entry.storedBytes === previous.storedBytes &&
            entry.compressed === previous.compressed,
          'partially overlapping or conflicting data ranges.',
        );
        sharedExtents++;
      }
      previous = entry;
    }
    let totalBytes = 0;
    for (const entry of entries) {
      let start = entry.offset,
        length = entry.storedBytes;
      if (flags & 0x100) {
        demand(length >= 1, 'missing embedded name.');
        const nameLength = read(start, 1)[0];
        demand(nameLength + 1 <= length, 'embedded name exceeds member.');
        // Shared extents retain one name blob for several indexed paths. The
        // blob is validated, but never used as a path or a destination.
        normalizedName(read(start + 1, nameLength));
        start += nameLength + 1;
        length -= nameLength + 1;
      }
      let bytes = length;
      if (entry.compressed) {
        demand(length >= 4, 'missing uncompressed size.');
        bytes = read(start, 4).readUInt32LE();
        start += 4;
        length -= 4;
      }
      totalBytes += bytes;
      demand(
        bytes <= limits.memberBytes && totalBytes <= limits.totalBytes,
        'uncompressed content exceeds inspection limits.',
      );
      Object.assign(entry, { start, length, bytes });
    }
    const hashed = new Map(),
      members = [];
    for (const entry of entries) {
      signal.throwIfAborted();
      const key = `${entry.offset}:${entry.storedBytes}:${entry.compressed}`;
      let memberHash = hashed.get(key);
      if (!memberHash) {
        memberHash = await digestRange(
          entry.start,
          entry.length,
          entry.bytes,
          entry.compressed,
        );
        hashed.set(key, memberHash);
      }
      members.push({
        path: entry.path,
        bytes: entry.bytes,
        sha256: memberHash,
      });
      if (members.length % 1000 === 0)
        options.progress?.({
          inspected: members.length,
          total: entries.length,
        });
    }
    signal.throwIfAborted();
    unchanged();
    return {
      schemaVersion: 1,
      kind: 'loadstone-bsa-inventory',
      version: 104,
      archive: { bytes: before.size, sha256 },
      flags,
      sharedExtents,
      totalBytes,
      members,
      installable: false,
      publicationApproved: false,
    };
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { inspectBsa104, limits };
