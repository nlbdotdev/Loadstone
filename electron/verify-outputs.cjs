const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonical, contains } = require('./live-catalog.cjs');
const { inspectList } = require('./wabbajack-list.cjs');

async function verifyOutputs(
  root,
  manifest,
  engineVersion,
  cancelled = () => false,
) {
  const checkCancelled = () => {
    if (cancelled())
      throw new Error(
        'Installation verification stopped. Retry to complete verification.',
      );
  };
  checkCancelled();
  const archive = path.join(root, 'list.wabbajack'),
    output = path.join(root, 'profile');
  if (
    canonical(archive).toLowerCase() !== archive.toLowerCase() ||
    canonical(output).toLowerCase() !== output.toLowerCase()
  )
    throw new Error(
      'The installation archive or output directory is redirected.',
    );
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) {
    checkCancelled();
    digest.update(chunk);
  }
  if (digest.digest('hex') !== manifest.archive.sha256)
    throw new Error(
      'The owned list archive changed before output verification.',
    );
  const list = await inspectList(archive, manifest, engineVersion, true);
  const hasBsa = list.outputs.some((item) => item.type === 'CreateBSA');
  let files = 0,
    sizeChecked = 0,
    presenceOnly = 0,
    temporaryInputs = 0;
  for (const item of list.outputs) {
    checkCancelled();
    const relative = item.path.replaceAll('\\', '/');
    // Wabbajack consumes these inputs while building the final BSA outputs.
    if (hasBsa && /^TEMP_BSA_FILES\//i.test(relative)) {
      temporaryInputs++;
      continue;
    }
    const target = path.join(output, ...relative.split('/'));
    let stat;
    try {
      if (
        !contains(output, target) ||
        canonical(target).toLowerCase() !== target.toLowerCase()
      )
        throw new Error('redirected');
      stat = await fs.promises.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('not a regular file');
    } catch {
      throw new Error(
        `An expected installed file is missing, inaccessible or redirected: ${relative}`,
      );
    }
    // The pinned engine rewrites INIs, modlist.txt and RemappedInlineFile outputs.
    const stable =
      ['InlineFile', 'FromArchive', 'PatchedFromArchive'].includes(item.type) &&
      !/\.ini$/i.test(relative) &&
      path.basename(relative).toLowerCase() !== 'modlist.txt';
    if (stable) {
      if (stat.size !== item.bytes)
        throw new Error(
          `An installed file has an unexpected size: ${relative}`,
        );
      sizeChecked++;
    } else presenceOnly++;
    files++;
    if (files % 128 === 0)
      await new Promise((resolve) => setImmediate(resolve));
  }
  checkCancelled();
  return {
    files,
    sizeChecked,
    presenceOnly,
    temporaryInputs,
    checkedAt: new Date().toISOString(),
  };
}
module.exports = { verifyOutputs };
