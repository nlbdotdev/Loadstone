const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeFile } = require('./manifest.cjs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');

function demand(ok, message) {
  if (!ok) throw new Error(`Invalid source hints: ${message}`);
}
function shape(value, keys) {
  demand(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    'unsupported or missing fields.',
  );
}
function validateSourceHints(value) {
  shape(value, ['schemaVersion', 'kind', 'mods']);
  demand(
    value.schemaVersion === 1 && value.kind === 'loadstone-source-hints',
    'unsupported format.',
  );
  demand(
    Array.isArray(value.mods) &&
      value.mods.length > 0 &&
      value.mods.length <= 10000,
    'declare 1–10,000 mod records.',
  );
  const seen = new Set();
  let references = 0;
  for (const mod of value.mods) {
    shape(mod, ['name', 'archives']);
    demand(
      relativeFile(mod.name) &&
        !/[\\/]/.test(mod.name) &&
        !seen.has(mod.name.toLowerCase()),
      'unsafe or duplicate mod name.',
    );
    seen.add(mod.name.toLowerCase());
    demand(
      Array.isArray(mod.archives) &&
        mod.archives.length > 0 &&
        mod.archives.length <= 100,
      'declare 1–100 archive paths per mod.',
    );
    const paths = new Set();
    for (const archive of mod.archives) {
      demand(
        typeof archive === 'string' &&
          archive.length <= 32767 &&
          !/[\x00-\x1f]/.test(archive) &&
          path.isAbsolute(archive),
        'archive paths must be absolute.',
      );
      const normalized = path.resolve(archive).toLowerCase();
      demand(!paths.has(normalized), 'duplicate archive path for one mod.');
      paths.add(normalized);
      demand(++references <= 100000, 'too many archive references.');
    }
  }
  return structuredClone(value);
}
function resolveSourceHints(value, inventory, archives) {
  const selected = new Map();
  if (value === undefined) return selected;
  const hints = validateSourceHints(value);
  const available = new Set(archives.map((v) => v.file.toLowerCase()));
  for (const hint of hints.mods) {
    const matches = inventory.mods.filter((v) => v?.name === hint.name);
    demand(
      matches.length === 1 &&
        !matches[0].separator &&
        !matches[0].unmanaged &&
        matches[0].files?.length,
      'each name must exactly identify an inventoried mod with files.',
    );
    const paths = new Set();
    for (const archive of hint.archives) {
      const normalized = path.resolve(archive).toLowerCase();
      demand(
        available.has(normalized),
        'archive is not in a selected download folder; select its direct parent folder.',
      );
      paths.add(normalized);
    }
    selected.set(hint.name, paths);
  }
  return selected;
}
function readSourceHints(file) {
  const before = ordinaryFile(file, 5_000_000);
  const content = fs.readFileSync(file);
  demand(
    sameFile(before, ordinaryFile(file, 5_000_000)),
    'file changed while reading.',
  );
  let value;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(content),
    );
  } catch {
    throw new Error('Source hints must contain valid UTF-8 JSON.');
  }
  return {
    hints: validateSourceHints(value),
    reference: {
      file: path.resolve(file),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    },
  };
}
module.exports = { validateSourceHints, resolveSourceHints, readSourceHints };
