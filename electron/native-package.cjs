const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const {
  validateRecipe,
  canonicalJson,
  limits,
} = require('./native-format.cjs');

function ordinaryFile(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > maxBytes ||
    fs.realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()
  )
    throw new Error(
      'Native package input is too large, redirected or not an ordinary file.',
    );
  return stat;
}
function sameFile(before, after) {
  return (
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ino === after.ino
  );
}
async function readEntry(zip, entry, maxBytes, collect = false) {
  if (entry.uncompressedSize > maxBytes)
    throw new Error('Native package entry exceeds its size limit.');
  const stream = await zip.openReadStreamPromise(entry),
    chunks = [],
    digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      stream.destroy();
      throw new Error('Native package entry exceeds its size limit.');
    }
    digest.update(chunk);
    if (collect) chunks.push(chunk);
  }
  return {
    bytes,
    sha256: digest.digest('hex'),
    ...(collect ? { data: Buffer.concat(chunks) } : {}),
  };
}
async function inspectNativePackage(file) {
  const before = ordinaryFile(file, limits.packageBytes);
  const zip = await yauzl.openPromise(file, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  let recipe,
    recipeSha256,
    count = 0,
    payloadBytes = 0;
  const seen = new Set(),
    expected = new Map();
  try {
    for await (const entry of zip.eachEntry()) {
      if (++count > limits.sources + 1)
        throw new Error('Native package contains too many entries.');
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        (type && type !== 0o100000) ||
        entry.externalFileAttributes & 0x10 ||
        entry.generalPurposeBitFlag & 1 ||
        ![0, 8].includes(entry.compressionMethod) ||
        entry.fileComment.length
      )
        throw new Error(
          'Native package entries must be ordinary unencrypted files without comments.',
        );
      if (seen.has(entry.fileName))
        throw new Error('Duplicate native package entry.');
      seen.add(entry.fileName);
      if (count === 1) {
        if (entry.fileName !== 'recipe.json')
          throw new Error(
            'recipe.json must be the first native package entry.',
          );
        const content = await readEntry(zip, entry, limits.recipeBytes, true);
        let parsed;
        try {
          parsed = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(content.data),
          );
        } catch {
          throw new Error('Native recipe must contain valid UTF-8 JSON.');
        }
        recipe = validateRecipe(parsed);
        if (!content.data.equals(Buffer.from(canonicalJson(recipe))))
          throw new Error(
            'Native recipe must use canonical JSON; ambiguous or duplicate keys are rejected.',
          );
        recipeSha256 = content.sha256;
        for (const source of recipe.sources.filter((v) => v.type === 'payload'))
          expected.set(`payload/${source.sha256}`, source);
      } else {
        const source = expected.get(entry.fileName);
        if (!source)
          throw new Error(
            'Undeclared payload or unexpected native package entry.',
          );
        payloadBytes += entry.uncompressedSize;
        if (payloadBytes > limits.payloadBytes)
          throw new Error('Native payloads exceed the package size limit.');
        const content = await readEntry(zip, entry, source.bytes);
        if (content.bytes !== source.bytes || content.sha256 !== source.sha256)
          throw new Error(
            'Native payload does not match its locked bytes and SHA-256.',
          );
      }
    }
    if (!recipe || [...expected.keys()].some((key) => !seen.has(key)))
      throw new Error(
        'Native package is missing its recipe or a declared payload.',
      );
  } finally {
    zip.close();
  }
  if (!sameFile(before, ordinaryFile(file, limits.packageBytes)))
    throw new Error('Native package changed during inspection.');
  return {
    recipe,
    recipeSha256,
    summary: {
      sources: recipe.sources.length,
      outputs: recipe.outputs.length,
      installBytes: recipe.outputs.reduce((n, v) => n + v.bytes, 0),
      payloadBytes,
      requiredGames: recipe.requirements.map((v) => v.id),
      prerequisites: (recipe.prerequisites || []).map((v) => ({
        id: v.id,
        name: v.name,
        version: v.version,
        files: v.files.length,
      })),
    },
    publicationApproved: false,
  };
}
module.exports = { inspectNativePackage, ordinaryFile, sameFile };
