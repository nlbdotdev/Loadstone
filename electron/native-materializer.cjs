const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setImmediate: yieldToEvents } = require('node:timers/promises');
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
const {
  expectedOutputs,
  assertBuildRecovery,
  assertRecoveryFile,
} = require('./native-build-recovery.cjs');
const { nativeActivity } = require('./native-activity.cjs');
const { matchesMtime, applyMtime } = require('./native-file-metadata.cjs');

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
async function verifyFile(file, expected, signal, activity) {
  activity?.start(expected.bytes);
  const before = ordinaryFile(file, expected.bytes);
  if (before.size !== expected.bytes)
    throw new Error('Native source byte length differs from the recipe.');
  if (!matchesMtime(before, expected))
    throw new Error(`Recipe file modification time differs: ${expected.path}`);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
    activity?.add(chunk.length);
  }
  if (
    hash.digest('hex') !== expected.sha256 ||
    !sameFile(before, ordinaryFile(file, expected.bytes))
  )
    throw new Error('Native source changed or differs from the recipe hash.');
  activity?.finish();
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
  const archiveSources = recipe.sources.filter((v) =>
    ['https-archive', 'nexus-archive'].includes(v.type),
  );
  const activity = nativeActivity(
    options.activity,
    'inputs',
    recipe.requirements.reduce((sum, v) => sum + v.files.length, 0) +
      (recipe.prerequisites || []).reduce((sum, v) => sum + v.files.length, 0) +
      archiveSources.length,
  );
  for (const required of recipe.requirements) {
    const root = options.games?.[required.id];
    if (typeof root !== 'string' || !path.isAbsolute(root))
      throw new Error('Select every required owned-game folder.');
    ordinaryDirectory(root);
    gameRoots.set(required.id, path.resolve(root));
    for (const locked of required.files)
      await verifyFile(
        path.join(root, locked.path),
        locked,
        options.signal,
        activity,
      );
  }
  const prerequisiteRoots = new Map();
  for (const prerequisite of recipe.prerequisites || []) {
    const root = options.prerequisites?.[prerequisite.id];
    if (typeof root !== 'string' || !path.isAbsolute(root))
      throw new Error('Select every required local prerequisite folder.');
    ordinaryDirectory(root);
    prerequisiteRoots.set(prerequisite.id, path.resolve(root));
    for (const locked of prerequisite.files)
      await verifyFile(
        path.join(root, locked.path),
        locked,
        options.signal,
        activity,
      );
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
      if (typeof archive !== 'string' || !path.isAbsolute(archive))
        throw new Error('Select every required local archive.');
      const kind = archiveKind(archive);
      if (!['zip', '7z', 'rar', 'rar5'].includes(kind))
        throw new Error(
          'Native reconstruction supports ZIP, 7z and RAR archives.',
        );
      ordinaryFile(archive, 50_000_000_000);
      if (kind === 'zip') {
        const snapshot = await verifyFile(
          archive,
          source,
          options.signal,
          activity,
        );
        sources.set(source.id, { file: archive, archive: true, snapshot });
      } else {
        if (!options.sevenZip)
          throw new Error(
            'Select a trusted 7-Zip x64 26.04 or newer tool to reconstruct 7z/RAR archives.',
          );
        const candidate = {
          archive,
          bytes: source.bytes,
          sha256: source.sha256,
        };
        activity.start(source.bytes);
        const inspectedArchive = await options.sevenZip.inspect(
          candidate,
          options.signal,
          (bytes) => activity.add(bytes),
        );
        activity.finish();
        sources.set(source.id, {
          file: archive,
          archive: true,
          snapshot: inspectedArchive.snapshot,
          candidate,
          inspectedArchive,
        });
      }
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
    (fs.existsSync(target) && !options.resume?.identity) ||
    target === path.parse(target).root ||
    canonical(target).toLowerCase() !== target.toLowerCase()
  )
    throw new Error('Native installation needs a new, ordinary destination.');
  if (options.resume) {
    if (options.resume.root !== target)
      throw new Error('Recovery destination differs from review.');
    assertBuildRecovery(options.resume);
  }
  ordinaryDirectory(path.dirname(target));
  const { inspected, gameRoots, prerequisiteRoots, sources } =
      await inspectInputs(file, options),
    { recipe } = inspected;
  // Bind typed configuration to this destination before any writes. The
  // reviewed recipe locks the generator inputs; these derived fingerprints
  // are independent expectations for writing and final on-disk verification.
  const { generated, outputs } = expectedOutputs(recipe, target);
  if (
    options.repair &&
    (!options.resume?.identity ||
      !/^\.loadstone-repair-recovery\/[a-f0-9-]{36}$/.test(
        options.repair.directory,
      ))
  )
    throw new Error(
      'Repair requires a reviewed existing candidate and recovery folder.',
    );
  const preserved = new Map();
  for (const item of options.resume?.files || []) {
    if (!item.preserved) continue;
    if (
      !options.repair ||
      !item.reuse ||
      !item.identity ||
      !Number.isSafeInteger(item.preserved.bytes) ||
      item.preserved.bytes < 0 ||
      item.preserved.bytes > 50_000_000_000 ||
      !/^[a-f0-9]{64}$/.test(item.preserved.sha256)
    )
      throw new Error('Only reviewed repair files can preserve local content.');
    preserved.set(item.path, item.preserved);
  }
  const protectedRoots = [
    path.resolve(__dirname, '..'),
    path.dirname(file),
    ...gameRoots.values(),
    ...prerequisiteRoots.values(),
    options.sevenZip?.directory,
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
  // Reject unsupported archive structure before creating the destination. Hash
  // verification already locked each selected archive's exact bytes.
  const groups = new Map();
  for (const output of outputs) {
    if (generated.has(output.path)) continue;
    const input = sources.get(output.action.source);
    if (output.action.type === 'extract' || input.package) {
      const group = groups.get(input.file) || {
        file: input.file,
        snapshot: input.snapshot,
        candidate: input.candidate,
        inspectedArchive: input.inspectedArchive,
        outputs: new Map(),
      };
      const member = input.package ? input.member : output.action.member;
      group.outputs.set(member, [...(group.outputs.get(member) || []), output]);
      groups.set(input.file, group);
    }
  }
  const archiveActivity = nativeActivity(
    options.activity,
    'archives',
    groups.size,
  );
  for (const group of groups.values()) {
    if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
      throw new Error('Archive changed after input verification.');
    if (group.inspectedArchive) {
      const { selected } = options.sevenZip.planExtraction(
        group.inspectedArchive,
        new Set(group.outputs.keys()),
      );
      if (
        selected.some((entry) =>
          group.outputs.get(entry.name).some((v) => v.bytes !== entry.bytes),
        )
      )
        throw new Error('Archive member size differs from expected output.');
      archiveActivity.finish();
      continue;
    }
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
    archiveActivity.finish();
  }
  options.signal?.throwIfAborted();
  options.sevenZip?.guard();
  const space = fs.statfsSync(path.dirname(target), { bigint: true });
  const needed =
    BigInt(options.resume?.writeBytes ?? inspected.summary.installBytes) +
    BigInt(Buffer.byteLength(canonicalJson(recipe))) +
    64_000_000n;
  if (space.bavail * space.bsize < needed)
    throw new Error(
      'Insufficient free space for native reconstruction and its receipt.',
    );
  if (options.resume) assertBuildRecovery(options.resume);
  if (!options.resume?.identity) fs.mkdirSync(target);
  const rootIdentity = ordinaryDirectory(target);
  const recoveryFiles = new Map(
    options.resume?.files.map((v) => [v.path, v]) || [],
  );
  const recoveryFolder = options.resume?.identity
    ? options.repair?.directory ||
      `.loadstone-build-recovery/${crypto.randomUUID()}`
    : null;
  let completed = 0;
  const outputActivity = nativeActivity(
    options.activity,
    'outputs',
    outputs.length,
  );
  const receiptFile = path.join(target, '.loadstone-native.json');
  function guard() {
    const current = ordinaryDirectory(target);
    if (current.ino !== rootIdentity.ino || current.dev !== rootIdentity.dev)
      throw new Error('Installation directory changed during reconstruction.');
  }
  function receipt(status) {
    guard();
    // Installed repair retains the original reconstruction receipt. Durable
    // library state tracks repair separately and blocks launch until it passes.
    if (options.repair)
      return {
        status: status === 'verified' ? 'repaired' : status,
        preservedFiles: preserved.size,
        recoveryDirectory: recoveryFolder,
      };
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
      ...(recoveryFolder ? { recoveryDirectory: recoveryFolder } : {}),
      ...(generated.size
        ? {
            generatedConfigurations: [...generated].map(([file, content]) => ({
              path: file,
              generator: 'mo2-config',
              bytes: content.bytes,
              sha256: content.sha256,
            })),
          }
        : {}),
    };
    const temporary = receiptFile + '.' + crypto.randomUUID() + '.tmp';
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
  function completedOutput() {
    completed++;
    outputActivity.finish();
    if (completed % 100 === 0) receipt('materializing');
    options.progress?.({ completed, total: recipe.outputs.length });
  }
  function prepareOutput(output) {
    const destinationFile = outputPath(output.path),
      reviewed = recoveryFiles.get(output.path);
    if (reviewed) {
      assertRecoveryFile(target, reviewed);
      if (reviewed.identity !== null) {
        if (reviewed.reuse || !recoveryFolder)
          throw new Error('A verified recovery file cannot be replaced.');
        const retained = outputPath(`${recoveryFolder}/${output.path}`);
        // Both resolved paths are inside the ordinary candidate. The reviewed
        // file identity is checked again; an exclusive recovery path is required.
        if (!contains(target, retained) || fs.existsSync(retained))
          throw new Error('Recovery destination already exists.');
        guard();
        assertRecoveryFile(target, reviewed);
        fs.renameSync(destinationFile, retained);
      }
    }
    return destinationFile;
  }
  async function writeOutput(openStream, output) {
    options.signal?.throwIfAborted();
    outputActivity.start(output.bytes);
    const destinationFile = prepareOutput(output),
      digest = crypto.createHash('sha256');
    let bytes = 0;
    const verify = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > output.bytes)
          return callback(new Error('Output exceeds its declared size.'));
        digest.update(chunk);
        outputActivity.add(chunk.length);
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
    applyMtime(destinationFile, output);
    completedOutput();
  }
  async function extractWithTool(group) {
    // Only Loadstone opens output paths. One file is open at a time, and each
    // write is awaited before reading more bytes from the archive process.
    let current;
    async function begin(entry) {
      options.signal?.throwIfAborted();
      if (!current) {
        const output = group.outputs.get(entry.name)[0];
        outputActivity.start(output.bytes);
        const file = prepareOutput(output);
        current = {
          entry,
          output,
          file,
          bytes: 0,
          digest: crypto.createHash('sha256'),
          handle: await fs.promises.open(file, 'wx'),
        };
      }
      if (current.entry !== entry)
        throw new Error('Archive output order changed.');
      return current;
    }
    try {
      await options.sevenZip.extractMembers(
        group.candidate,
        group.inspectedArchive,
        new Set(group.outputs.keys()),
        {
          async consume(entry, chunk) {
            const item = await begin(entry);
            item.bytes += chunk.length;
            if (item.bytes > item.output.bytes)
              throw new Error('Output exceeds its declared size.');
            item.digest.update(chunk);
            outputActivity.add(chunk.length);
            let offset = 0;
            while (offset < chunk.length) {
              options.signal?.throwIfAborted();
              const { bytesWritten } = await item.handle.write(
                chunk,
                offset,
                chunk.length - offset,
              );
              if (!bytesWritten)
                throw new Error('Could not write reconstructed output.');
              offset += bytesWritten;
            }
          },
          async finish(entry) {
            const item = await begin(entry);
            await item.handle.sync();
            await item.handle.close();
            item.handle = null;
            if (
              item.bytes !== item.output.bytes ||
              item.digest.digest('hex') !== item.output.sha256
            )
              throw new Error('Reconstructed file does not match the recipe.');
            applyMtime(item.file, item.output);
            completedOutput();
            for (const output of group.outputs.get(entry.name).slice(1))
              await writeOutput(() => fs.createReadStream(item.file), output);
            current = null;
          },
        },
        options.signal,
      );
    } finally {
      await current?.handle?.close();
    }
  }
  let writesStarted = false;
  try {
    if (options.resume?.identity) {
      assertBuildRecovery(options.resume);
      writesStarted = true;
      const retainedReceipt = outputPath(
        `${recoveryFolder}/.loadstone-native.json`,
      );
      fs.copyFileSync(receiptFile, retainedReceipt, fs.constants.COPYFILE_EXCL);
    }
    writesStarted = true;
    receipt('materializing');
    if (!options.resume?.identity)
      fs.writeFileSync(
        path.join(target, '.loadstone-recipe.json'),
        canonicalJson(recipe),
        { flag: 'wx', flush: true },
      );
    for (const output of outputs) {
      if (recoveryFiles.get(output.path)?.reuse) {
        options.signal?.throwIfAborted();
        assertRecoveryFile(target, recoveryFiles.get(output.path));
        completedOutput();
        if (completed % 100 === 0) await yieldToEvents();
      }
    }
    for (const [key, group] of groups) {
      for (const [member, items] of group.outputs) {
        const remaining = items.filter(
          (v) => !recoveryFiles.get(v.path)?.reuse,
        );
        if (remaining.length) group.outputs.set(member, remaining);
        else group.outputs.delete(member);
      }
      if (!group.outputs.size) groups.delete(key);
    }
    for (const output of outputs) {
      if (recoveryFiles.get(output.path)?.reuse) continue;
      if (generated.has(output.path)) {
        await writeOutput(
          () => Readable.from([generated.get(output.path).data]),
          output,
        );
        continue;
      }
      const input = sources.get(output.action.source);
      if (output.action.type !== 'copy' || input.package) continue;
      ordinaryFile(input.file, output.bytes);
      await writeOutput(() => fs.createReadStream(input.file), output);
    }
    for (const group of groups.values()) {
      if (!sameFile(group.snapshot, ordinaryFile(group.file, 50_000_000_000)))
        throw new Error('Source archive changed before extraction.');
      if (group.inspectedArchive) {
        await extractWithTool(group);
        continue;
      }
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
    const verificationActivity = nativeActivity(
      options.activity,
      'verification',
      outputs.length,
    );
    for (const output of outputs) {
      options.signal?.throwIfAborted();
      guard();
      await verifyFile(
        path.join(target, output.path),
        preserved.get(output.path) || output,
        options.signal,
        verificationActivity,
      );
    }
    if (generated.size) {
      for (const folder of [
        'downloads',
        'mods',
        'profiles',
        'overwrite',
        'webcache',
      ]) {
        const directory = path.dirname(
          outputPath(`${folder}/.directory-check`),
        );
        ordinaryDirectory(directory);
      }
    }
    options.signal?.throwIfAborted();
    return receipt('verified');
  } catch (error) {
    // Retain the candidate and any recovery copies. A later resume requires
    // a new review; never recursively delete a failed installation.
    try {
      if (writesStarted)
        receipt(options.signal?.aborted ? 'cancelled' : 'failed');
    } catch {
      /* Preserve the original failure and existing evidence. */
    }
    throw error;
  }
}
module.exports = { materializeNative };
