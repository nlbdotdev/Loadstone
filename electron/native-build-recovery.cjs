const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonical, contains } = require('./live-catalog.cjs');
const { canonicalJson, limits } = require('./native-format.cjs');
const { ordinaryFile } = require('./native-package.cjs');
const { renderMo2Config } = require('./native-mo2-config.cjs');
const { nativeActivity } = require('./native-activity.cjs');

const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
function demand(value, message) {
  if (!value) throw new Error(message);
}
function identity(file, directory = false) {
  const s = fs.lstatSync(file, { bigint: true });
  demand(
    !s.isSymbolicLink() &&
      (directory ? s.isDirectory() : s.isFile()) &&
      canonical(file).toLowerCase() === path.resolve(file).toLowerCase(),
    'Build recovery refuses redirected or unsupported paths.',
  );
  return directory
    ? `${s.dev}:${s.ino}`
    : `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
function expectedOutputs(recipe, target) {
  const generated = new Map();
  const outputs = recipe.outputs.map((output) => {
    if (output.action.type !== 'mo2-config') return output;
    const content = renderMo2Config(output, recipe, target);
    generated.set(output.path, content);
    return { ...output, bytes: content.bytes, sha256: content.sha256 };
  });
  return { generated, outputs };
}
function readMetadata(file, max) {
  ordinaryFile(file, max);
  const before = identity(file),
    data = fs.readFileSync(file);
  demand(
    identity(file) === before,
    'Build metadata changed during recovery review.',
  );
  return {
    value: JSON.parse(data),
    fingerprint: digest(data),
    identity: before,
  };
}
async function reviewBuildRecovery(inspected, destination, options = {}) {
  const root = path.resolve(destination),
    { recipe, recipeSha256 } = inspected;
  identity(path.dirname(root), true);
  demand(
    root !== path.parse(root).root &&
      canonical(root).toLowerCase() === root.toLowerCase(),
    'Build recovery needs an ordinary destination.',
  );
  for (const protectedRoot of options.protectedRoots || []) {
    const protectedPath = canonical(protectedRoot);
    demand(
      !contains(protectedPath, root) && !contains(root, protectedPath),
      'Build recovery overlaps a protected installation or application folder.',
    );
  }
  const { outputs } = expectedOutputs(recipe, root);
  const review = {
    root,
    identity: null,
    metadata: null,
    files: [],
    reused: 0,
    conflicts: 0,
    missing: 0,
    retained: 0,
    writeBytes: 0,
  };
  if (!exists(root)) {
    review.missing = outputs.length;
    review.writeBytes = outputs.reduce((sum, v) => sum + v.bytes, 0);
    review.files = outputs.map((v) => ({
      path: v.path,
      identity: null,
      reuse: false,
    }));
    return review;
  }
  review.identity = identity(root, true);
  const recipeFile = readMetadata(
    path.join(root, '.loadstone-recipe.json'),
    limits.recipeBytes,
  );
  const receipt = readMetadata(
    path.join(root, '.loadstone-native.json'),
    65536,
  );
  demand(
    digest(canonicalJson(recipeFile.value)) === recipeSha256 &&
      receipt.value?.schemaVersion === 1 &&
      receipt.value.kind === 'loadstone-native-materialization' &&
      ['materializing', 'failed', 'cancelled', 'verified'].includes(
        receipt.value.status,
      ) &&
      receipt.value.recipeSha256 === recipeSha256 &&
      receipt.value.id === recipe.id &&
      receipt.value.version === recipe.version &&
      receipt.value.expectedFiles === outputs.length &&
      Number.isSafeInteger(receipt.value.completedFiles) &&
      receipt.value.completedFiles >= 0 &&
      receipt.value.completedFiles <= outputs.length &&
      receipt.value.launchVerified === false,
    'The partial candidate does not match the reviewed recipe and reconstruction receipt.',
  );
  review.metadata = [recipeFile, receipt].map(({ fingerprint, identity }) => ({
    fingerprint,
    identity,
  }));
  const queue = [root];
  let entries = 0,
    fileCount = 0;
  while (queue.length) {
    options.signal?.throwIfAborted();
    const item = queue.pop(),
      stat = await fs.promises.lstat(item);
    demand(
      ++entries <= 1_000_000,
      'Build recovery exceeds its tree scan limit.',
    );
    identity(item, stat.isDirectory());
    if (stat.isDirectory())
      for (const name of await fs.promises.readdir(item))
        queue.push(path.join(item, name));
    else fileCount++;
  }
  const activity = nativeActivity(options.activity, 'recovery', outputs.length);
  for (const output of outputs) {
    options.signal?.throwIfAborted();
    const file = path.join(root, output.path);
    let snapshot = null,
      reuse = false;
    if (exists(file)) {
      snapshot = identity(file);
      if (fs.statSync(file).size === output.bytes) {
        activity.start(output.bytes);
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        for await (const chunk of fs.createReadStream(file, {
          signal: options.signal,
        })) {
          bytes += chunk.length;
          demand(
            bytes <= output.bytes,
            'A candidate file grew during recovery review.',
          );
          hash.update(chunk);
          activity.add(chunk.length);
        }
        demand(
          identity(file) === snapshot,
          'A candidate file changed during recovery review.',
        );
        reuse = hash.digest('hex') === output.sha256;
      }
      if (reuse) review.reused++;
      else review.conflicts++;
    } else review.missing++;
    if (!reuse) review.writeBytes += output.bytes;
    review.files.push({ path: output.path, identity: snapshot, reuse });
    activity.finish();
  }
  review.retained = fileCount - review.reused - review.conflicts;
  demand(
    identity(root, true) === review.identity,
    'The partial candidate was replaced during review.',
  );
  assertBuildRecovery(review);
  return review;
}
function assertBuildRecovery(review) {
  if (review.identity === null) {
    demand(
      !exists(review.root),
      'The reviewed destination appeared. Review recovery again.',
    );
    return;
  }
  demand(
    identity(review.root, true) === review.identity,
    'The partial candidate was replaced. Review recovery again.',
  );
  for (const [index, file] of [
    '.loadstone-recipe.json',
    '.loadstone-native.json',
  ].entries()) {
    const current = readMetadata(
      path.join(review.root, file),
      index ? 65536 : limits.recipeBytes,
    );
    demand(
      current.identity === review.metadata[index].identity &&
        current.fingerprint === review.metadata[index].fingerprint,
      'Build metadata changed after review. Review recovery again.',
    );
  }
  for (const file of review.files) assertRecoveryFile(review.root, file);
}
function assertRecoveryFile(root, file) {
  const target = path.join(root, file.path);
  demand(contains(root, target), 'A recovery file escapes the candidate.');
  demand(
    file.identity === null
      ? !exists(target)
      : exists(target) && identity(target) === file.identity,
    'A candidate file changed after recovery review. Review recovery again.',
  );
}
module.exports = {
  reviewBuildRecovery,
  assertBuildRecovery,
  assertRecoveryFile,
  expectedOutputs,
  identity,
};
