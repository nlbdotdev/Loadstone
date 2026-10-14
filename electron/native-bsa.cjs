const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { canonical, contains } = require('./live-catalog.cjs');
const { inspectBsa104, limits } = require('./bsa104.cjs');
const { zipPath } = require('./native-archive-path.cjs');
const { nativeActivity } = require('./native-activity.cjs');

function guardArchive(group) {
  if (
    !sameFile(
      group.input.snapshot,
      ordinaryFile(group.input.file, 50_000_000_000),
    )
  )
    throw new Error('BSA source archive changed after input verification.');
}
async function inspectOuter(group, options) {
  guardArchive(group);
  if (group.input.inspectedArchive) {
    const { selected } = options.sevenZip.planExtraction(
      group.input.inspectedArchive,
      new Set(group.members.keys()),
    );
    if (
      selected.some(
        (entry) => group.members.get(entry.name).expected.bytes !== entry.bytes,
      )
    )
      throw new Error('BSA container size differs from its archive member.');
    return;
  }
  const zip = await yauzl.openPromise(group.input.file, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: false,
    validateEntrySizes: true,
  });
  const paths = new Map(),
    found = new Set();
  let total = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      options.signal?.throwIfAborted();
      const { name, directory } = zipPath(entry),
        key = name.toLowerCase();
      if (paths.has(key)) throw new Error('Duplicate BSA source archive path.');
      paths.set(key, directory ? 'directory' : 'file');
      total += entry.uncompressedSize;
      if (paths.size > 500000 || total > 100_000_000_000)
        throw new Error('BSA source archive exceeds limits.');
      const wanted = group.members.get(name);
      if (wanted) {
        if (directory || wanted.expected.bytes !== entry.uncompressedSize)
          throw new Error(
            'BSA container size differs from its archive member.',
          );
        found.add(name);
      }
    }
    for (const name of paths.keys()) {
      const parts = name.split('/');
      while (parts.length > 1) {
        parts.pop();
        if (paths.get(parts.join('/')) === 'file')
          throw new Error('BSA source archive paths overlap.');
      }
    }
    if (found.size !== group.members.size)
      throw new Error('Required BSA container is missing.');
  } finally {
    zip.close();
  }
  guardArchive(group);
}

// One operation owns one new temporary directory and numbered files. It never
// uses an archive name as a filesystem destination or recursively removes data.
class NativeBsaWork {
  constructor() {
    this.root = null;
    this.items = [];
  }
  guard() {
    const stat = fs.lstatSync(this.root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.ino !== this.identity.ino ||
      stat.dev !== this.identity.dev ||
      fs.realpathSync(this.root).toLowerCase() !== this.root.toLowerCase()
    )
      throw new Error('BSA staging directory changed.');
  }
  async prepare(outputs, sources, destination, options) {
    const groups = new Map();
    for (const output of outputs) {
      const action = output.action;
      if (action.type !== 'extract-bsa104') continue;
      const input = sources.get(action.source);
      if (!input?.archive)
        throw new Error('BSA extraction requires an original archive.');
      const group = groups.get(input.file) || { input, members: new Map() };
      const { container } = action;
      let item = group.members.get(container.member);
      if (
        item &&
        (item.expected.bytes !== container.bytes ||
          item.expected.sha256 !== container.sha256)
      )
        throw new Error('Conflicting BSA container fingerprints.');
      if (!item) {
        item = {
          expected: { bytes: container.bytes, sha256: container.sha256 },
          outputs: new Map(),
        };
        group.members.set(container.member, item);
        this.items.push(item);
      }
      const matches = item.outputs.get(action.member) || [];
      if (
        matches.some(
          (v) => v.bytes !== output.bytes || v.sha256 !== output.sha256,
        )
      )
        throw new Error('Conflicting BSA member fingerprints.');
      matches.push(output);
      item.outputs.set(action.member, matches);
      groups.set(input.file, group);
    }
    if (!this.items.length) return [];
    const bytes = this.items.reduce(
      (sum, item) => sum + item.expected.bytes,
      0,
    );
    if (this.items.length > limits.containers || bytes > limits.stagingBytes)
      throw new Error('BSA staging exceeds limits.');
    for (const group of groups.values()) await inspectOuter(group, options);
    options.signal?.throwIfAborted();
    const parent = fs.realpathSync(os.tmpdir()),
      space = fs.statfsSync(parent, { bigint: true });
    if (space.bavail * space.bsize < BigInt(bytes) + 64_000_000n)
      throw new Error('Insufficient temporary disk space for BSA containers.');
    this.root = fs.mkdtempSync(path.join(parent, 'loadstone-bsa-'));
    this.identity = fs.lstatSync(this.root);
    if (
      contains(canonical(destination), this.root) ||
      contains(this.root, canonical(destination))
    )
      throw new Error('BSA staging overlaps the installation destination.');
    this.items.forEach((item, index) => {
      item.file = path.join(this.root, `${index}.bsa`);
    });
    const activity = nativeActivity(
      options.activity,
      'archives',
      this.items.length * 2,
    );
    for (const group of groups.values()) {
      this.guard();
      guardArchive(group);
      let current;
      const begin = async (entry) => {
        options.signal?.throwIfAborted();
        this.guard();
        const item = group.members.get(entry.name);
        if (!item || item.expected.bytes !== entry.bytes)
          throw new Error('Unexpected BSA staging member.');
        if (!current) {
          const handle = await fs.promises.open(item.file, 'wx');
          current = {
            item,
            handle,
            bytes: 0,
            digest: crypto.createHash('sha256'),
          };
          item.identity = await handle.stat();
          activity.start(item.expected.bytes);
        }
        if (current.item !== item)
          throw new Error('BSA staging member order changed.');
        return current;
      };
      const consumer = {
        consume: async (entry, chunk) => {
          const item = await begin(entry);
          item.bytes += chunk.length;
          if (item.bytes > item.item.expected.bytes)
            throw new Error('BSA container exceeds declared size.');
          item.digest.update(chunk);
          activity.add(chunk.length);
          let offset = 0;
          while (offset < chunk.length) {
            options.signal?.throwIfAborted();
            const { bytesWritten } = await item.handle.write(
              chunk,
              offset,
              chunk.length - offset,
            );
            if (!bytesWritten)
              throw new Error('Could not write BSA staging file.');
            offset += bytesWritten;
          }
        },
        finish: async (entry) => {
          const item = await begin(entry);
          await item.handle.sync();
          await item.handle.close();
          item.handle = null;
          if (
            item.bytes !== item.item.expected.bytes ||
            item.digest.digest('hex') !== item.item.expected.sha256
          )
            throw new Error(
              'BSA container differs from its declared fingerprint.',
            );
          item.item.snapshot = ordinaryFile(
            item.item.file,
            item.item.expected.bytes,
          );
          current = null;
          activity.finish();
        },
      };
      try {
        if (group.input.inspectedArchive)
          await options.sevenZip.extractMembers(
            group.input.candidate,
            group.input.inspectedArchive,
            new Set(group.members.keys()),
            consumer,
            options.signal,
          );
        else {
          const zip = await yauzl.openPromise(group.input.file, {
            lazyEntries: true,
            autoClose: false,
            strictFileNames: false,
            validateEntrySizes: true,
          });
          const produced = new Set();
          try {
            for await (const entry of zip.eachEntry()) {
              options.signal?.throwIfAborted();
              const { name, directory } = zipPath(entry);
              if (directory || !group.members.has(name)) continue;
              if (produced.has(name))
                throw new Error('Duplicate BSA staging member.');
              produced.add(name);
              const selected = { name, bytes: entry.uncompressedSize };
              const stream = await zip.openReadStreamPromise(entry);
              for await (const chunk of stream)
                await consumer.consume(selected, chunk);
              await consumer.finish(selected);
            }
            if (produced.size !== group.members.size)
              throw new Error('BSA staging member was not produced.');
          } finally {
            zip.close();
          }
        }
      } finally {
        await current?.handle?.close();
      }
      guardArchive(group);
    }
    for (const item of this.items) {
      this.guard();
      activity.start(0);
      const inspected = await inspectBsa104(item.file, {
        expected: item.expected,
        signal: options.signal,
      });
      const members = new Map(
        inspected.members.map((member) => [member.path, member]),
      );
      for (const [name, outputs] of item.outputs) {
        const member = members.get(name);
        if (
          !member ||
          outputs.some(
            (output) =>
              member.bytes !== output.bytes || member.sha256 !== output.sha256,
          )
        )
          throw new Error('BSA member differs from the declared output.');
      }
      activity.finish();
    }
    return this.items.map((item) => ({
      file: item.file,
      snapshot: item.snapshot,
      bsa: item.expected,
      outputs: item.outputs,
    }));
  }
  close() {
    if (!this.root) return;
    this.guard();
    for (const item of this.items) {
      if (!item.file || !fs.existsSync(item.file)) continue;
      this.guard();
      const stat = ordinaryFile(item.file, limits.archiveBytes);
      if (
        !item.identity ||
        stat.ino !== item.identity.ino ||
        stat.dev !== item.identity.dev
      )
        throw new Error('BSA staging file changed before cleanup.');
      fs.unlinkSync(item.file);
    }
    this.guard();
    fs.rmdirSync(this.root);
    this.root = null;
  }
}
module.exports = { NativeBsaWork };
