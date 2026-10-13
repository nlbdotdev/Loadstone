const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  validateRecipe,
  canonicalJson,
  limits,
} = require('./native-format.cjs');
const { ordinaryFile } = require('./native-package.cjs');
const { renderMo2Config } = require('./native-mo2-config.cjs');
const { decodeMo2Value } = require('./mo2-ini-value.cjs');
const { verifyGameLayout } = require('./game-layout.cjs');
const { games } = require('./manifest.cjs');
const { portableLaunchPlan, Launcher } = require('./launcher.cjs');
const { replaceStateFile } = require('./replace-state-file.cjs');

const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function demand(value, message) {
  if (!value) throw new Error(message);
}
function directory(folder) {
  const stat = fs.lstatSync(folder, { bigint: true });
  demand(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      same(fs.realpathSync(folder), path.resolve(folder)),
    'A native setup directory is missing or redirected.',
  );
  return `${stat.dev}:${stat.ino}`;
}
function read(file, limit) {
  const before = ordinaryFile(file, limit);
  const data = fs.readFileSync(file);
  const after = ordinaryFile(file, limit);
  demand(
    before.ino === after.ino &&
      before.dev === after.dev &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs,
    'A native setup file changed while being read.',
  );
  return data;
}
function iniEntries(data) {
  const sections = new Map();
  const sectionNames = new Set();
  let section, keys;
  for (const line of data.toString('utf8').split(/\r?\n/)) {
    if (!line.trim() || /^\s*[;#]/.test(line)) continue;
    const heading = line.trim().match(/^\[([^\]]+)\]$/);
    if (heading) {
      demand(
        !heading[1].includes('%') && heading[1] === heading[1].trim(),
        'Encoded or padded MO2 configuration section names are unsupported.',
      );
      demand(
        !sectionNames.has(heading[1].toLowerCase()),
        'Duplicate MO2 configuration section.',
      );
      sectionNames.add(heading[1].toLowerCase());
      section = new Map();
      keys = new Set();
      sections.set(heading[1], section);
      continue;
    }
    const entry = line.match(/^([^=]+)=(.*)$/);
    if (section && entry) {
      const key = entry[1].trim();
      demand(
        !key.includes('%'),
        'Encoded MO2 configuration keys are unsupported.',
      );
      demand(
        !keys.has(key.toLowerCase()),
        'Duplicate MO2 configuration setting.',
      );
      keys.add(key.toLowerCase());
      section.set(key, decodeMo2Value(entry[2]));
    }
  }
  return sections;
}
function metadata(root, record) {
  root = path.resolve(root);
  const identity = directory(root);
  if (record)
    demand(
      record.identity === identity && same(record.root, root),
      'The registered candidate directory has been replaced or redirected.',
    );
  const recipe = JSON.parse(
    read(path.join(root, '.loadstone-recipe.json'), limits.recipeBytes),
  );
  validateRecipe(recipe);
  const recipeSha256 = digest(canonicalJson(recipe));
  if (record)
    demand(
      record.recipeSha256 === recipeSha256,
      'The registered recipe has changed. Restore the reviewed recipe.',
    );
  const receipt = JSON.parse(
    read(path.join(root, '.loadstone-native.json'), 65536),
  );
  demand(
    receipt?.schemaVersion === 1 &&
      receipt.kind === 'loadstone-native-materialization' &&
      receipt.status === 'verified' &&
      receipt.recipeSha256 === recipeSha256 &&
      receipt.id === recipe.id &&
      receipt.version === recipe.version &&
      receipt.completedFiles === recipe.outputs.length &&
      receipt.expectedFiles === recipe.outputs.length,
    'Choose a completed native candidate with its verified reconstruction receipt.',
  );
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  demand(
    config,
    'Native library registration requires a generated portable MO2 configuration.',
  );
  const rendered = renderMo2Config(config, recipe, root);
  const generated = receipt.generatedConfigurations;
  demand(
    Array.isArray(generated) &&
      generated.length === 1 &&
      generated[0].path === config.path &&
      generated[0].generator === 'mo2-config' &&
      generated[0].sha256 === rendered.sha256 &&
      generated[0].bytes === rendered.bytes,
    'The generated configuration receipt does not match this destination.',
  );
  return { root, identity, recipe, recipeSha256, rendered, config };
}
function launchLayout(meta) {
  const { root, recipe, rendered, config } = meta;
  demand(
    read(path.join(root, 'portable.txt'), 0).length === 0,
    'Restore the empty portable marker before launching this candidate.',
  );
  const ini = read(path.join(root, 'ModOrganizer.ini'), 2_000_000);
  const actual = iniEntries(ini),
    expected = iniEntries(rendered.data);
  demand(
    actual.get('General')?.get('gameName') ===
      expected.get('General').get('gameName'),
    'The MO2 game type differs from the registered recipe.',
  );
  for (const [key, value] of expected.get('Settings')) {
    const configured = actual.get('Settings')?.get(key);
    if (key.endsWith('_directory')) {
      demand(
        typeof configured === 'string' &&
          same(
            path.resolve(root, configured.replaceAll('%BASE_DIR%', root)),
            path.resolve(value),
          ),
        'MO2 must keep its game, mods, profiles, downloads and writable state inside this candidate.',
      );
      directory(path.resolve(value));
    } else
      demand(
        configured === value,
        'MO2 local profile settings must remain enabled.',
      );
  }
  const entries = actual.get('customExecutables');
  const matches = [...(entries || [])].filter(
    ([key, value]) =>
      /^[1-9]\d*\\title$/i.test(key) &&
      value.toLowerCase() === recipe.launch.executable.toLowerCase(),
  );
  demand(
    matches.length === 1 && matches[0][1] === recipe.launch.executable,
    'The selected MO2 launch entry is missing or ambiguous.',
  );
  const prefix = matches[0][0].split('\\')[0] + '\\';
  const index = config.action.executables.findIndex(
    (v) => v.title === recipe.launch.executable,
  );
  const declared = config.action.executables[index];
  for (const key of ['binary', 'workingDirectory', 'arguments']) {
    const configured = entries.get(prefix + key) ?? '';
    const wanted = expected
      .get('customExecutables')
      .get(`${index + 1}\\${key}`);
    demand(
      key === 'arguments'
        ? configured === wanted
        : same(path.resolve(root, configured), path.resolve(wanted)),
      'The selected MO2 executable, working directory or arguments have changed.',
    );
  }
  demand(
    Number.isSafeInteger(Number(entries.get('size'))) &&
      Number(entries.get('size')) >= Number(prefix.slice(0, -1)) &&
      Number(prefix.slice(0, -1)) >= 1,
    'The selected MO2 launch entry is outside its declared array.',
  );
  const binary = path.resolve(root, declared.binary);
  verifyGameLayout({ manifest: recipe }, root, ini.toString('utf8'), binary);
  const profile = path.join(root, 'profiles', recipe.launch.profile);
  directory(profile);
  const settings = iniEntries(
    read(path.join(profile, 'settings.ini'), 2_000_000),
  ).get('General');
  demand(
    settings?.get('LocalSaves') === 'true' &&
      settings?.get('LocalSettings') === 'true',
    'Enable LocalSaves and LocalSettings in this profile before registering or launching it. Existing saves are never imported.',
  );
  if (fs.existsSync(path.join(profile, 'saves')))
    directory(path.join(profile, 'saves'));
  ordinaryFile(path.join(profile, 'modlist.txt'), 8_000_000);
  for (const relative of new Set([
    'ModOrganizer.exe',
    declared.binary,
    `${recipe.launch.gameRoot}/${games[recipe.game.id].executable}`,
  ])) {
    const output = recipe.outputs.find((v) => same(v.path, relative));
    demand(
      output?.sha256 && output.bytes <= 256_000_000,
      'A launch executable has no supported recipe fingerprint.',
    );
    const data = read(path.join(root, relative), output.bytes);
    demand(
      data.length === output.bytes &&
        data.subarray(0, 2).toString() === 'MZ' &&
        digest(data) === output.sha256,
      'A launch executable differs from the registered recipe. Restore it before launching.',
    );
  }
  return portableLaunchPlan({
    manager: path.join(root, 'ModOrganizer.exe'),
    profile: recipe.launch.profile,
    executable: recipe.launch.executable,
  });
}
function nativeLaunchPlan(record) {
  demand(record, 'Choose a registered native setup.');
  return launchLayout(metadata(record.root, record));
}
async function verifyCandidate(root, options = {}) {
  const meta = metadata(root, options.record);
  launchLayout(meta);
  let completed = 0;
  const report = () =>
    options.progress?.({ completed, total: meta.recipe.outputs.length });
  report();
  for (const output of meta.recipe.outputs) {
    options.signal?.throwIfAborted();
    if (output.action.type !== 'mo2-config') {
      const file = path.join(meta.root, output.path),
        before = ordinaryFile(file, output.bytes);
      demand(
        before.size === output.bytes,
        `Recipe file size differs: ${output.path}`,
      );
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file, { signal: options.signal });
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        demand(
          bytes <= output.bytes,
          `Recipe file changed during verification: ${output.path}`,
        );
        hash.update(chunk);
      }
      const after = ordinaryFile(file, output.bytes);
      demand(
        before.ino === after.ino &&
          before.dev === after.dev &&
          before.mtimeMs === after.mtimeMs &&
          bytes === output.bytes &&
          hash.digest('hex') === output.sha256,
        `Recipe file differs: ${output.path}`,
      );
    }
    completed++;
    report();
  }
  options.signal?.throwIfAborted();
  const latest = metadata(meta.root, meta);
  launchLayout(latest);
  return meta;
}
const text = (v, max = 2000) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
function validateRegistry(state) {
  demand(
    state?.schemaVersion === 1 &&
      state.kind === 'loadstone-native-library' &&
      Array.isArray(state.entries) &&
      state.entries.length <= 100,
    'Unsupported native library state. Preserve it and use a compatible app.',
  );
  const ids = new Set(),
    roots = new Set();
  const keys = [
    'id',
    'root',
    'identity',
    'recipeSha256',
    'name',
    'version',
    'profile',
    'game',
    'saveStatus',
    'saveNotes',
    'verifiedAt',
    'fileCount',
  ];
  for (const entry of state.entries) {
    demand(
      entry &&
        Object.keys(entry).length === keys.length &&
        keys.every((k) => Object.hasOwn(entry, k)) &&
        /^[a-f0-9-]{36}$/.test(entry.id) &&
        !ids.has(entry.id) &&
        text(entry.root, 32767) &&
        path.isAbsolute(entry.root) &&
        !roots.has(entry.root.toLowerCase()) &&
        /^\d+:\d+$/.test(entry.identity) &&
        /^[a-f0-9]{64}$/.test(entry.recipeSha256) &&
        text(entry.name) &&
        text(entry.version) &&
        text(entry.profile) &&
        ['fnv', 'skyrimse', 'fallout4'].includes(entry.game) &&
        ['new-save-required', 'unknown', 'compatible'].includes(
          entry.saveStatus,
        ) &&
        text(entry.saveNotes) &&
        text(entry.verifiedAt, 40) &&
        Number.isFinite(Date.parse(entry.verifiedAt)) &&
        Number.isSafeInteger(entry.fileCount) &&
        entry.fileCount > 0 &&
        entry.fileCount <= limits.outputs,
      'Native library state is invalid. Preserve it before recovery.',
    );
    ids.add(entry.id);
    roots.add(entry.root.toLowerCase());
  }
  return state.entries;
}
class NativeLibrary {
  constructor(dataDir, options = {}) {
    this.file = path.join(dataDir, 'native-library.json');
    this.options = options;
    this.entries = [];
    this.error = null;
    this.busy = false;
    this.progress = null;
    this.pending = null;
    try {
      if (fs.existsSync(this.file))
        this.entries = validateRegistry(JSON.parse(read(this.file, 1_000_000)));
    } catch {
      this.error =
        'Native library state cannot be read. Preserve native-library.json before recovery; registration and launch are disabled.';
    }
    const library = this;
    this.launcher = new Launcher(
      {
        get jobs() {
          return library.entries;
        },
        get maintenance() {
          return library.busy;
        },
        list: () => library.entries,
      },
      {
        plan: nativeLaunchPlan,
        ...(options.spawn ? { spawn: options.spawn } : {}),
      },
    );
  }
  list() {
    return {
      entries: this.launcher.list(),
      busy: this.busy,
      progress: this.progress,
      error: this.error,
    };
  }
  available() {
    demand(!this.error, this.error);
    demand(
      !this.busy,
      'Wait for native library verification to finish or cancel it.',
    );
    this.options.assertAvailable?.();
  }
  record(id) {
    const entry = this.entries.find((v) => v.id === id);
    demand(entry, 'Choose a registered native setup.');
    return entry;
  }
  persist(next) {
    const state = {
      schemaVersion: 1,
      kind: 'loadstone-native-library',
      entries: next,
    };
    validateRegistry(state);
    // Detect external changes instead of overwriting unknown or newer state.
    if (fs.existsSync(this.file))
      demand(
        canonicalJson(JSON.parse(read(this.file, 1_000_000))) ===
          canonicalJson({ ...state, entries: this.entries }),
        'Native library state changed outside this session. Restart Loadstone before continuing.',
      );
    else
      demand(
        this.entries.length === 0,
        'Native library state disappeared. Restart Loadstone before continuing.',
      );
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state) + '\n', {
      flag: 'wx',
      flush: true,
    });
    try {
      replaceStateFile(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    this.entries = next;
  }
  async scan(root, record) {
    this.controller = new AbortController();
    this.progress = { completed: 0, total: 0 };
    try {
      return await verifyCandidate(root, {
        record,
        signal: this.controller.signal,
        progress: (value) => {
          this.progress = value;
        },
      });
    } catch (error) {
      if (this.controller.signal.aborted)
        throw new Error(
          'Native verification cancelled. Candidate files were left unchanged.',
        );
      throw error;
    } finally {
      this.controller = null;
      this.progress = null;
    }
  }
  async prepare(pick) {
    this.available();
    this.busy = true;
    this.pending = null;
    try {
      const root = await pick();
      if (!root) return null;
      this.options.assertAvailable?.();
      demand(
        !this.entries.some((v) => same(path.resolve(root), v.root)),
        'This native candidate is already in your library.',
      );
      demand(
        this.entries.length < 100,
        'The native library supports at most 100 candidates.',
      );
      this.options.checkRoot?.(root);
      const meta = await this.scan(root);
      this.pending = {
        ...meta,
        id: crypto.randomUUID(),
        verifiedAt: new Date().toISOString(),
      };
      return {
        id: this.pending.id,
        name: meta.recipe.name,
        version: meta.recipe.version,
        root: meta.root,
        fileCount: meta.recipe.outputs.length,
        profile: meta.recipe.launch.profile,
        saveCompatibility: meta.recipe.saveCompatibility,
      };
    } finally {
      this.busy = false;
    }
  }
  register(id) {
    this.available();
    const pending = this.pending;
    demand(
      pending && pending.id === id,
      'Review the native candidate again before adding it.',
    );
    this.options.checkRoot?.(pending.root);
    nativeLaunchPlan(pending);
    const recipe = pending.recipe;
    const entry = {
      id,
      root: pending.root,
      identity: pending.identity,
      recipeSha256: pending.recipeSha256,
      name: recipe.name,
      version: recipe.version,
      profile: recipe.launch.profile,
      game: recipe.game.id,
      saveStatus: recipe.saveCompatibility.status,
      saveNotes: recipe.saveCompatibility.notes,
      verifiedAt: pending.verifiedAt,
      fileCount: recipe.outputs.length,
    };
    this.persist([...this.entries, entry]);
    this.pending = null;
    return this.list();
  }
  async verify(id) {
    this.available();
    demand(
      !this.launcher.sessions.get(id)?.child,
      'Close the launched mod manager before verifying its files.',
    );
    const entry = this.record(id);
    this.busy = true;
    try {
      await this.scan(entry.root, entry);
      this.persist(
        this.entries.map((v) =>
          v.id === id ? { ...v, verifiedAt: new Date().toISOString() } : v,
        ),
      );
      return this.list();
    } finally {
      this.busy = false;
    }
  }
  cancel() {
    this.controller?.abort();
  }
  launch(id) {
    this.available();
    this.record(id);
    return this.launcher.launch(id);
  }
  shortcutJob(id) {
    this.available();
    const entry = this.record(id);
    return {
      ...entry,
      status: 'installed',
      manifest: { version: entry.version },
    };
  }
}
module.exports = {
  NativeLibrary,
  nativeLaunchPlan,
  verifyCandidate,
  validateRegistry,
};
