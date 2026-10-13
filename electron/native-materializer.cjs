const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const {
  inspectNativePackage,
  ordinaryFile,
  sameFile,
} = require('./native-package.cjs');
const { canonicalJson } = require('./native-format.cjs');
const { canonical, contains } = require('./live-catalog.cjs');
const { relativeFile } = require('./manifest.cjs');
const { replaceStateFile } = require('./replace-state-file.cjs');
const { archiveKind } = require('./archive-kind.cjs');

function ordinaryDirectory(folder) {
  const stat = fs.lstatSync(folder);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(folder).toLowerCase() !== path.resolve(folder).toLowerCase()
  )
    throw new Error('Native installation refuses redirected directories.');
  return stat;
}
async function verifyFile(file, expected, signal) {
  const before = ordinaryFile(file, expected.bytes);
  if (before.size !== expected.bytes)
    throw new Error('Native source byte length differs from the recipe.');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  if (
    hash.digest('hex') !== expected.sha256 ||
    !sameFile(before, ordinaryFile(file, expected.bytes))
  )
    throw new Error('Native source changed or differs from the recipe hash.');
  return before;
}
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
async function inspectInputs(file, options) {
  const packageSnapshot = ordinaryFile(file, 512_000_000);
  const inspected = await inspectNativePackage(file),
    recipe = inspected.recipe;
  if (
    options.expectedRecipeSha256 !== undefined &&
    options.expectedRecipeSha256 !== inspected.recipeSha256
  )
    throw new Error('Native package changed after recipe review.');
  if (!sameFile(packageSnapshot, ordinaryFile(file, 512_000_000)))
    throw new Error('Native package changed during input inspection.');
  const gameRoots = new Map(),
    sources = new Map();
  for (const required of recipe.requirements) {
    const root = options.games?.[required.id];
    if (typeof root !== 'string' || !path.isAbsolute(root))
      throw new Error('Select every required owned-game folder.');
    ordinaryDirectory(root);
    gameRoots.set(required.id, path.resolve(root));
    for (const locked of required.files)
      await verifyFile(path.join(root, locked.path), locked, options.signal);
  }
  const prerequisiteRoots = new Map();
  for (const prerequisite of recipe.prerequisites || []) {
    const root = options.prerequisites?.[prerequisite.id];
    if (typeof root !== 'string' || !path.isAbsolute(root))
      throw new Error('Select every required local prerequisite folder.');
    ordinaryDirectory(root);
    prerequisiteRoots.set(prerequisite.id, path.resolve(root));
    for (const locked of prerequisite.files)
      await verifyFile(path.join(root, locked.path), locked, options.signal);
  }
  for (const source of recipe.sources) {
    if (source.type === 'payload')
      sources.set(source.id, {
        file,
        member: `payload/${source.sha256}`,
        package: true,
        snapshot: packageSnapshot,
      });
    else if (source.type === 'game-file')
      sources.set(source.id, {
        file: path.join(gameRoots.get(source.game), source.path),
      });
    else if (source.type === 'prerequisite-file')
      sources.set(source.id, {
        file: path.join(
          prerequisiteRoots.get(source.prerequisite),
          source.path,
        ),
      });
    else {
      const archive = options.archives?.[source.id];
      if (
        typeof archive !== 'string' ||
        !path.isAbsolute(archive) ||
        archiveKind(archive) !== 'zip'
      )
        throw new Error(
          'This native materializer requires verified local ZIP archives; 7z/RAR and downloads are not implemented.',
        );
      ordinaryFile(archive, 50_000_000_000);
      const snapshot = await verifyFile(archive, source, options.signal);
      sources.set(source.id, { file: archive, archive: true, snapshot });
    }
  }
  return { inspected, gameRoots, prerequisiteRoots, sources };
}
async function materializeNative(file, destination, options = {}) {
  options.signal?.throwIfAborted();
  file = path.resolve(file);
  if (typeof destination !== 'string' || !path.isAbsolute(destination))
    throw new Error('Choose an absolute new installation folder.');
  const target = path.resolve(destination);
  if (
    fs.existsSync(target) ||
    target === path.parse(target).root ||
    canonical(target).toLowerCase() !== target.toLowerCase()
  )
    throw new Error('Native installation needs a new, ordinary destination.');
  ordinaryDirectory(path.dirname(target));
  const { inspected, gameRoots, prerequisiteRoots, sources } =
      await inspectInputs(file, options),
    { recipe } = inspected;
  const protectedRoots = [
    path.resolve(__dirname, '..'),
    path.dirname(file),
    ...gameRoots.values(),
    ...prerequisiteRoots.values(),
    ...[...sources.values()]
      .filter((v) => v.archive)
      .map((v) => path.dirname(v.file)),
    ...(options.protectedRoots || []),
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter(Boolean);
  for (const root of protectedRoots) {
    const protectedPath = canonical(root);
    if (contains(protectedPath, target) || contains(target, protectedPath))
      throw new Error(
        'Keep native installation separate from source, game, application and system folders.',
      );
  }
  // Reject unsupported ZIP structure before creating the destination. Hash
  // verification already locked each selected archive's exact bytes.
  const groups = new Map();
  for (const output of recipe.outputs) {
    const input = sources.get(output.action.source);
    if (output.action.type === 'extract' || input.package) {
      const group = groups.get(input.file) || {
        file: input.file,
        snapshot: input.snapshot,
        outputs: new Map(),
      };
      const member = input.package ? input.member : output.action.member;
      group.outputs.set(member, [...(group.outputs.get(member) || []), output]);
      groups.set(input.file, group);
    }
  }
  for (const group of groups.values()) {
    if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
      throw new Error('Archive changed after input verification.');
    const zip = await yauzl.openPromise(group.file, {
      lazyEntries: true,
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const entries = new Map(),
      fileNames = new Set();
    let total = 0;
    try {
      for await (const entry of zip.eachEntry()) {
        options.signal?.throwIfAborted();
        const item = zipPath(entry),
          key = item.name.toLowerCase();
        if (entries.has(key)) throw new Error('Duplicate ZIP entry.');
        entries.set(key, item.directory ? 'directory' : 'file');
        if (!item.directory) fileNames.add(item.name);
        total += entry.uncompressedSize;
        if (entries.size > 500000 || total > 100_000_000_000)
          throw new Error('ZIP extraction exceeds native limits.');
        if (
          group.outputs.has(item.name) &&
          (item.directory ||
            group.outputs
              .get(item.name)
              .some((v) => v.bytes !== entry.uncompressedSize))
        )
          throw new Error('ZIP member size differs from expected output.');
      }
      for (const name of entries.keys()) {
        const parts = name.split('/');
        while (parts.length > 1) {
          parts.pop();
          if (entries.get(parts.join('/')) === 'file')
            throw new Error('ZIP file/directory paths overlap.');
        }
      }
      for (const member of group.outputs.keys())
        if (!fileNames.has(member))
          throw new Error('A required archive member is missing.');
    } finally {
      zip.close();
    }
    if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
      throw new Error('Archive changed during preflight.');
  }
  options.signal?.throwIfAborted();
  const space = fs.statfsSync(path.dirname(target), { bigint: true });
  const needed =
    BigInt(inspected.summary.installBytes) +
    BigInt(Buffer.byteLength(canonicalJson(recipe))) +
    64_000_000n;
  if (space.bavail * space.bsize < needed)
    throw new Error(
      'Insufficient free space for native reconstruction and its receipt.',
    );
  fs.mkdirSync(target); // Exclusive directory creation prevents existing-folder reuse.
  const rootIdentity = ordinaryDirectory(target);
  let completed = 0;
  const receiptFile = path.join(target, '.loadstone-native.json');
  function guard() {
    if (ordinaryDirectory(target).ino !== rootIdentity.ino)
      throw new Error('Installation directory changed during reconstruction.');
  }
  function receipt(status) {
    guard();
    const state = {
      schemaVersion: 1,
      kind: 'loadstone-native-materialization',
      id: recipe.id,
      version: recipe.version,
      recipeSha256: inspected.recipeSha256,
      status,
      completedFiles: completed,
      expectedFiles: recipe.outputs.length,
      launchVerified: false,
    };
    const temporary = receiptFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state) + '\n', {
      flag: 'wx',
      flush: true,
    });
    replaceStateFile(temporary, receiptFile);
    return state;
  }
  function outputPath(relative) {
    guard();
    const parts = relative.split('/');
    let folder = target;
    for (const part of parts.slice(0, -1)) {
      folder = path.join(folder, part);
      if (!fs.existsSync(folder)) fs.mkdirSync(folder);
      ordinaryDirectory(folder);
    }
    return path.join(target, relative);
  }
  async function writeOutput(openStream, output) {
    options.signal?.throwIfAborted();
    const destinationFile = outputPath(output.path),
      digest = crypto.createHash('sha256');
    let bytes = 0;
    const verify = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > output.bytes)
          return callback(new Error('Output exceeds its declared size.'));
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    const stream = await openStream();
    await pipeline(
      stream,
      verify,
      fs.createWriteStream(destinationFile, { flags: 'wx', flush: true }),
      { signal: options.signal },
    );
    if (bytes !== output.bytes || digest.digest('hex') !== output.sha256)
      throw new Error('Reconstructed file does not match the recipe.');
    completed++;
    if (completed % 100 === 0) receipt('materializing');
    options.progress?.({ completed, total: recipe.outputs.length });
  }
  try {
    receipt('materializing');
    fs.writeFileSync(
      path.join(target, '.loadstone-recipe.json'),
      canonicalJson(recipe),
      { flag: 'wx', flush: true },
    );
    for (const output of recipe.outputs) {
      const input = sources.get(output.action.source);
      if (output.action.type !== 'copy' || input.package) continue;
      ordinaryFile(input.file, output.bytes);
      await writeOutput(() => fs.createReadStream(input.file), output);
    }
    for (const group of groups.values()) {
      if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
        throw new Error('Source archive changed before extraction.');
      const zip = await yauzl.openPromise(group.file, {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      });
      const produced = new Set();
      try {
        for await (const entry of zip.eachEntry()) {
          options.signal?.throwIfAborted();
          const { name, directory } = zipPath(entry);
          if (directory || !group.outputs.has(name)) continue;
          if (produced.has(name))
            throw new Error('Duplicate archive member during extraction.');
          produced.add(name);
          for (const output of group.outputs.get(name))
            await writeOutput(() => zip.openReadStreamPromise(entry), output);
        }
        if (produced.size !== group.outputs.size)
          throw new Error('A required archive member was not produced.');
      } finally {
        zip.close();
      }
      if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
        throw new Error('Archive changed during extraction.');
    }
    for (const output of recipe.outputs) {
      guard();
      await verifyFile(path.join(target, output.path), output, options.signal);
    }
    return receipt('verified');
  } catch (error) {
    // Retain the new owned folder for diagnosis/recovery. Never recursively
    // delete a failed installation or silently reuse it on a later attempt.
    try {
      receipt(options.signal?.aborted ? 'cancelled' : 'failed');
    } catch {
      /* Preserve the original failure and existing evidence. */
    }
    throw error;
  }
}
module.exports = { materializeNative };
