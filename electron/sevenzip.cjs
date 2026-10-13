const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { crc32 } = require('node:zlib');
const { spawn } = require('node:child_process');
const { relativeFile } = require('./manifest.cjs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { archiveKind } = require('./archive-kind.cjs');

// This optional creator dependency is chosen by the operator, never by a recipe.
// Archive content is emitted only to stdout; 7-Zip never receives an output path.
async function runTool(
  executable,
  args,
  { signal, maxBytes, consume, timeoutMs = 120000 } = {},
) {
  signal?.throwIfAborted();
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.dirname(executable),
  });
  let failure,
    bytes = 0,
    errorBytes = 0;
  const stop = (error) => {
    failure ||= error;
    child.kill();
  };
  const abort = () =>
    stop(signal.reason || new Error('Archive operation cancelled.'));
  const timer = setTimeout(
    () => stop(new Error('Archive tool exceeded its time limit.')),
    timeoutMs,
  );
  signal?.addEventListener('abort', abort, { once: true });
  child.on('error', () =>
    stop(new Error('Could not start the selected archive tool.')),
  );
  child.stderr.on('data', (chunk) => {
    errorBytes += chunk.length;
    if (errorBytes > 65536)
      stop(new Error('Archive tool exceeded its diagnostic limit.'));
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  if (signal?.aborted) abort();
  try {
    // Await consumers so a slow disk applies backpressure to the child. Never
    // report completion while writes or a cancelled child are still running.
    try {
      for await (const chunk of child.stdout) {
        if (failure) throw failure;
        bytes += chunk.length;
        if (bytes > maxBytes)
          throw new Error('Archive output exceeds its declared limit.');
        await consume(chunk);
      }
    } catch (error) {
      stop(error);
    }
    const code = await closed;
    if (failure) throw failure;
    if (code !== 0)
      throw new Error('Archive tool did not complete successfully.');
    return bytes;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseListing(text) {
  if (!text || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(text))
    throw new Error('Invalid archive listing.');
  const entries = [],
    paths = new Map();
  let total = 0;
  for (const block of text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split(/\n\n+/)) {
    const fields = new Map();
    for (const line of block.split('\n')) {
      const split = line.indexOf(' = ');
      if (split < 1 || fields.has(line.slice(0, split)))
        throw new Error('Ambiguous archive listing.');
      fields.set(line.slice(0, split), line.slice(split + 3));
    }
    const raw = fields.get('Path'),
      name = raw?.replaceAll('\\', '/');
    const size = fields.get('Size'),
      attributes = fields.get('Attributes') || '';
    const directory =
      fields.get('Folder') === '+' ||
      /^D/.test(attributes) ||
      /^\S* d/.test(attributes);
    if (
      !relativeFile(name) ||
      name !== name.normalize('NFC') ||
      paths.has(name.toLowerCase()) ||
      !/^\d+$/.test(size || '') ||
      !Number.isSafeInteger(Number(size)) ||
      fields.get('Encrypted') !== '-' ||
      fields.get('Anti') === '+' ||
      fields.get('Alternate Stream') === '+' ||
      [...fields].some(
        ([key, value]) => /link|reparse/i.test(key) && value !== '',
      ) ||
      fields.get('Split Before') === '+' ||
      fields.get('Split After') === '+' ||
      /[Ll]|reparse|^\S* [^d-]/.test(attributes)
    )
      throw new Error(
        'Unsafe, duplicate, encrypted or unsupported archive entry.',
      );
    const bytes = Number(size);
    if (directory && bytes !== 0)
      throw new Error('Invalid archive directory size.');
    paths.set(name.toLowerCase(), directory ? 'directory' : 'file');
    const crc = fields.get('CRC');
    if (crc && !/^[a-f0-9]{8}$/i.test(crc))
      throw new Error('Invalid archive member checksum.');
    entries.push({
      name,
      selector: raw,
      bytes,
      directory,
      ...(crc ? { crc32: crc.toLowerCase() } : {}),
    });
    total += bytes;
    if (entries.length > 500000 || total > 100_000_000_000)
      throw new Error('Archive inventory exceeds limits.');
  }
  for (const name of paths.keys()) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (paths.get(parts.join('/')) === 'file')
        throw new Error('Archive paths overlap.');
    }
  }
  return entries;
}

function parseArchiveListing(text, extension) {
  const normalized = text.replace(/\r\n/g, '\n');
  const chunks = normalized.split('\n----------\n');
  if (chunks.length !== 2)
    throw new Error('Ambiguous archive listing envelope.');
  const types = [...chunks[0].matchAll(/^Type = (.+)$/gm)].map((v) => v[1]);
  if (
    types.length !== 1 ||
    !(extension === '.7z' ? ['7z'] : ['Rar', 'Rar5']).includes(types[0]) ||
    /^Multivolume = \+|^Volumes = (?!1$)\d+|^Volume = |^Offset = (?!0$)\d+/m.test(
      chunks[0],
    )
  )
    throw new Error('Unsupported, embedded or multipart archive.');
  return parseListing(chunks[1]);
}

async function createSevenZip(executable, { signal } = {}) {
  if (
    typeof executable !== 'string' ||
    !path.isAbsolute(executable) ||
    path.basename(executable).toLowerCase() !== '7z.exe'
  )
    throw new Error('Select an absolute trusted 7z.exe path.');
  const toolSnapshot = ordinaryFile(executable, 20_000_000);
  const library = path.join(path.dirname(executable), '7z.dll');
  const librarySnapshot = ordinaryFile(library, 50_000_000);
  const chunks = [];
  await runTool(executable, ['i', '-sccUTF-8'], {
    signal,
    maxBytes: 128000,
    consume: (v) => chunks.push(v),
  });
  const info = Buffer.concat(chunks).toString('utf8');
  const version = info.match(/^7-Zip (\d+)\.(\d+) \(x64\)/m);
  if (!version || Number(version[1]) * 100 + Number(version[2]) < 2604)
    throw new Error(
      'Use 7-Zip x64 26.04 or newer for native source inspection.',
    );
  const loadedLibrary = info.match(/^\s*0 : (\d+\.\d+) : (.+)$/m);
  if (
    !loadedLibrary ||
    loadedLibrary[1] !== `${version[1]}.${version[2]}` ||
    path.resolve(loadedLibrary[2].trim()).toLowerCase() !==
      library.toLowerCase()
  )
    throw new Error(
      'Use the matching 7z.dll beside the selected archive tool.',
    );
  function guard() {
    if (
      !sameFile(toolSnapshot, ordinaryFile(executable, 20_000_000)) ||
      !sameFile(librarySnapshot, ordinaryFile(library, 50_000_000))
    )
      throw new Error('Selected archive tool changed.');
  }
  guard();
  async function inspect(candidate, operationSignal) {
    guard();
    if (
      !candidate ||
      typeof candidate.archive !== 'string' ||
      !path.isAbsolute(candidate.archive) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(candidate.sha256)
    )
      throw new Error('Use a locked absolute archive input.');
    const kind = archiveKind(candidate.archive);
    if (!['7z', 'rar', 'rar5'].includes(kind))
      throw new Error('This adapter accepts local 7z/RAR archives only.');
    const before = ordinaryFile(candidate.archive, 50_000_000_000);
    if (before.size !== candidate.bytes)
      throw new Error('Archive byte length differs from its fingerprint.');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(candidate.archive)) {
      operationSignal?.throwIfAborted();
      hash.update(chunk);
    }
    if (hash.digest('hex') !== candidate.sha256)
      throw new Error('Archive differs from its fingerprint.');
    const listing = [];
    await runTool(
      executable,
      [
        'l',
        `-t${kind}`,
        '-slt',
        '-sccUTF-8',
        '-bd',
        '-y',
        '-p-',
        '--',
        candidate.archive,
      ],
      {
        signal: operationSignal,
        maxBytes: 128_000_000,
        consume: (v) => listing.push(v),
      },
    );
    const entries = parseArchiveListing(
      Buffer.concat(listing).toString('utf8'),
      `.${kind}`,
    );
    guard();
    if (!sameFile(before, ordinaryFile(candidate.archive, 50_000_000_000)))
      throw new Error('Archive changed during inspection.');
    return { entries, snapshot: before, kind };
  }
  async function readMember(
    candidate,
    inspected,
    entry,
    consume,
    operationSignal,
  ) {
    guard();
    if (
      !sameFile(
        inspected.snapshot,
        ordinaryFile(candidate.archive, 50_000_000_000),
      )
    )
      throw new Error('Archive changed before reading.');
    if (
      entry.directory ||
      !inspected.entries.includes(entry) ||
      entry.bytes > 20_000_000_000
    )
      throw new Error('Archive member exceeds reading limits.');
    const count = await runTool(
      executable,
      [
        'x',
        `-t${inspected.kind}`,
        '-so',
        '-spd',
        '-ssc',
        '-r-',
        '-bd',
        '-y',
        '-p-',
        '--',
        candidate.archive,
        entry.selector,
      ],
      {
        signal: operationSignal,
        maxBytes: entry.bytes,
        consume,
        timeoutMs: 600000,
      },
    );
    guard();
    if (
      count !== entry.bytes ||
      !sameFile(
        inspected.snapshot,
        ordinaryFile(candidate.archive, 50_000_000_000),
      )
    )
      throw new Error(
        'Archive member differs from its declared size or the archive changed.',
      );
    return count;
  }
  async function hashMember(candidate, inspected, entry, operationSignal) {
    if (entry.bytes > 1_000_000_000)
      throw new Error('Archive member exceeds hashing limits.');
    const hash = crypto.createHash('sha256');
    const count = await readMember(
      candidate,
      inspected,
      entry,
      (v) => hash.update(v),
      operationSignal,
    );
    return `${count}:${hash.digest('hex')}`;
  }
  async function streamArchive(
    candidate,
    inspected,
    consumer,
    operationSignal,
  ) {
    guard();
    // Listing and extraction use ascending archive item indices in 26.04.
    // CRC checks at every boundary additionally reject wrong byte framing.
    if (
      version[1] !== '26' ||
      version[2] !== '04' ||
      typeof crc32 !== 'function' ||
      inspected.kind !== '7z'
    )
      throw new Error(
        'Single-pass inspection is not verified for this tool or format.',
      );
    const files = inspected.entries.filter((v) => !v.directory);
    const total = files.reduce((sum, v) => sum + v.bytes, 0);
    if (total > 20_000_000_000 || files.some((v) => v.bytes > 0 && !v.crc32))
      throw new Error(
        'Single-pass inspection requires bounded content and per-file checksums.',
      );
    if (
      !sameFile(
        inspected.snapshot,
        ordinaryFile(candidate.archive, 50_000_000_000),
      )
    )
      throw new Error('Archive changed before reading.');
    let index = 0,
      remaining = files[0]?.bytes || 0,
      checksum = 0;
    async function finish() {
      const entry = files[index];
      if (entry.crc32 && checksum.toString(16).padStart(8, '0') !== entry.crc32)
        throw new Error(
          'Archive stream boundary checksum differs from its listing.',
        );
      await consumer.finish(entry);
      index++;
      remaining = files[index]?.bytes || 0;
      checksum = 0;
    }
    async function emptyFiles() {
      while (index < files.length && remaining === 0) {
        operationSignal?.throwIfAborted();
        await finish();
      }
    }
    await emptyFiles();
    const count = await runTool(
      executable,
      ['x', '-t7z', '-so', '-bd', '-y', '-p-', '--', candidate.archive],
      {
        signal: operationSignal,
        maxBytes: total,
        timeoutMs: 300000,
        consume: async (chunk) => {
          let offset = 0;
          while (offset < chunk.length) {
            if (index >= files.length)
              throw new Error(
                'Unexpected bytes after the final archive member.',
              );
            const size = Math.min(remaining, chunk.length - offset),
              part = chunk.subarray(offset, offset + size);
            checksum = crc32(part, checksum);
            await consumer.consume(files[index], part);
            remaining -= size;
            offset += size;
            if (remaining === 0) {
              await finish();
              await emptyFiles();
            }
          }
        },
      },
    );
    guard();
    if (
      count !== total ||
      index !== files.length ||
      !sameFile(
        inspected.snapshot,
        ordinaryFile(candidate.archive, 50_000_000_000),
      )
    )
      throw new Error('Archive stream is incomplete or its input changed.');
  }
  async function hashArchive(candidate, inspected, wanted, operationSignal) {
    const sizes = new Set([...wanted].map((v) => Number(v.split(':')[0]))),
      matches = new Map();
    let hash;
    await streamArchive(
      candidate,
      inspected,
      {
        consume(entry, chunk) {
          if (sizes.has(entry.bytes)) {
            hash ||= crypto.createHash('sha256');
            hash.update(chunk);
          }
        },
        finish(entry) {
          if (sizes.has(entry.bytes)) {
            hash ||= crypto.createHash('sha256');
            const identity = `${entry.bytes}:${hash.digest('hex')}`;
            if (wanted.has(identity)) {
              const names = matches.get(identity) || [];
              names.push(entry.name);
              if (names.length > 128)
                throw new Error('Too many equivalent archive members.');
              matches.set(identity, names);
            }
          }
          hash = null;
        },
      },
      operationSignal,
    );
    return matches;
  }
  const batch7z =
    version[1] === '26' && version[2] === '04' && typeof crc32 === 'function';
  function planExtraction(inspected, names) {
    const selected = inspected.entries.filter(
      (v) => !v.directory && names.has(v.name),
    );
    if (selected.length !== names.size)
      throw new Error('A required archive member is missing.');
    const batch =
      batch7z &&
      inspected.kind === '7z' &&
      inspected.entries.every((v) => v.directory || v.bytes === 0 || v.crc32) &&
      inspected.entries.reduce((sum, v) => sum + v.bytes, 0) <= 20_000_000_000;
    if (
      selected.length > (batch ? 100000 : 10000) ||
      selected.reduce((sum, v) => sum + v.bytes, 0) > 20_000_000_000
    )
      throw new Error('Selected archive members exceed reconstruction limits.');
    return { selected, batch };
  }
  async function extractMembers(
    candidate,
    inspected,
    names,
    consumer,
    operationSignal,
  ) {
    const { selected, batch } = planExtraction(inspected, names);
    if (batch) {
      await streamArchive(
        candidate,
        inspected,
        {
          consume: (entry, chunk) =>
            names.has(entry.name) ? consumer.consume(entry, chunk) : undefined,
          finish: (entry) =>
            names.has(entry.name) ? consumer.finish(entry) : undefined,
        },
        operationSignal,
      );
    } else {
      for (const entry of selected) {
        operationSignal?.throwIfAborted();
        await readMember(
          candidate,
          inspected,
          entry,
          (chunk) => consumer.consume(entry, chunk),
          operationSignal,
        );
        await consumer.finish(entry);
      }
    }
  }
  return {
    version: `${version[1]}.${version[2]}`,
    directory: path.dirname(executable),
    guard,
    inspect,
    hashMember,
    hashArchive,
    batch7z,
    planExtraction,
    extractMembers,
  };
}

async function inspectSevenZipMembers(candidate, wanted, adapter, signal) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(300000)])
    : AbortSignal.timeout(300000);
  const inspected = await adapter.inspect(candidate, signal);
  const sizes = new Set([...wanted].map((v) => Number(v.split(':')[0]))),
    matches = new Map();
  const selected = inspected.entries.filter(
    (entry) => !entry.directory && sizes.has(entry.bytes),
  );
  if (!selected.length) return new Map();
  const batch =
    adapter.batch7z &&
    inspected.kind === '7z' &&
    inspected.entries.every(
      (entry) => entry.directory || entry.bytes === 0 || entry.crc32,
    ) &&
    inspected.entries.reduce((total, entry) => total + entry.bytes, 0) <=
      20_000_000_000;
  if (
    selected.length > (batch ? 100000 : 10000) ||
    selected.reduce((total, entry) => total + entry.bytes, 0) >
      20_000_000_000 ||
    (!batch && selected.some((entry) => entry.bytes > 1_000_000_000))
  )
    throw new Error('Archive member hashing exceeds limits.');
  if (batch) return adapter.hashArchive(candidate, inspected, wanted, signal);
  let scanned = 0,
    count = 0;
  for (const entry of selected) {
    signal?.throwIfAborted();
    if (entry.directory || !sizes.has(entry.bytes)) continue;
    scanned += entry.bytes;
    if (++count > 10000 || scanned > 20_000_000_000)
      throw new Error('Archive member hashing exceeds limits.');
    const identity = await adapter.hashMember(
      candidate,
      inspected,
      entry,
      signal,
    );
    if (wanted.has(identity)) {
      const names = matches.get(identity) || [];
      names.push(entry.name);
      if (names.length > 128)
        throw new Error('Too many equivalent archive members.');
      matches.set(identity, names);
    }
  }
  return matches;
}
module.exports = {
  createSevenZip,
  parseListing,
  parseArchiveListing,
  inspectSevenZipMembers,
};
