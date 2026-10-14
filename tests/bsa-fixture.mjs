import { deflateSync } from 'node:zlib';

// Original synthetic encoder for reader tests, not a game-archive writer.
// Lookup hashes are intentionally zero; the reader enumerates indexed names.
export function bsaFixture(files, flags = 3) {
  const groups = new Map();
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    const folder = slash < 0 ? '' : file.path.slice(0, slash);
    const group = groups.get(folder) || [];
    group.push({ ...file, name: file.path.slice(slash + 1) });
    groups.set(folder, group);
  }
  const ordered = [...groups.values()].flat();
  const names = Buffer.concat(
    ordered.map((f) => Buffer.from(f.name + '\0', 'latin1')),
  );
  const folderNames = [...groups.keys()].map((n) =>
    Buffer.from(n.replaceAll('/', '\\') + '\0', 'latin1'),
  );
  const folderNameBytes = folderNames.reduce((n, b) => n + b.length, 0);
  const metaEnd =
    36 +
    groups.size * 16 +
    groups.size +
    folderNameBytes +
    ordered.length * 16 +
    names.length;
  const meta = Buffer.alloc(metaEnd);
  meta.write('BSA\0');
  [
    104,
    36,
    flags,
    groups.size,
    files.length,
    folderNameBytes,
    names.length,
    0,
  ].forEach((v, i) => meta.writeUInt32LE(v, 4 + i * 4));
  let position = 36 + groups.size * 16,
    groupIndex = 0,
    dataPosition = metaEnd;
  const payloads = [],
    records = [],
    entries = [];
  for (const group of groups.values()) {
    meta.writeUInt32LE(group.length, 36 + groupIndex * 16 + 8);
    meta.writeUInt32LE(position + names.length, 36 + groupIndex * 16 + 12);
    const folder = folderNames[groupIndex++];
    meta[position++] = folder.length;
    folder.copy(meta, position);
    position += folder.length;
    for (const file of group) {
      const data = Buffer.from(file.data || ''),
        compressed = file.compressed ?? Boolean(flags & 4);
      let offset, size;
      if (file.alias !== undefined) ({ offset, size } = entries[file.alias]);
      else {
        const chunks = [];
        if (flags & 0x100) {
          const name = Buffer.from(file.path.replaceAll('/', '\\'));
          chunks.push(Buffer.from([name.length]), name);
        }
        if (compressed) {
          const originalSize = Buffer.alloc(4);
          originalSize.writeUInt32LE(data.length);
          chunks.push(originalSize, deflateSync(data));
        } else chunks.push(data);
        const payload = Buffer.concat(chunks);
        offset = dataPosition;
        size = payload.length;
        payloads.push(payload);
        dataPosition += size;
      }
      const toggle = compressed !== Boolean(flags & 4) ? 0x40000000 : 0;
      meta.writeUInt32LE(size | toggle, position + 8);
      meta.writeUInt32LE(offset, position + 12);
      records.push(position);
      entries.push({ offset, size });
      position += 16;
    }
  }
  names.copy(meta, position);
  return {
    bytes: Buffer.concat([meta, ...payloads]),
    records,
    entries,
    namesOffset: position,
    metaEnd,
  };
}
