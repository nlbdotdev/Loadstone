const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { steamRoots } = require('./game-discovery.cjs');
const { canonical } = require('./live-catalog.cjs');
const { launchPlan } = require('./launcher.cjs');
const { quoteArgument } = require('./shortcuts.cjs');
const { decode, encode, field } = require('./steam-vdf.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function assertSteamClosed() {
  const { stdout } = await promisify(execFile)(
    'tasklist.exe',
    ['/FO', 'CSV', '/NH'],
    { windowsHide: true, timeout: 10000, maxBuffer: 4_000_000 },
  );
  if (/^"(?:steam|steamwebhelper)\.exe"/im.test(stdout))
    throw new Error(
      'Exit Steam completely, then try again. Steam must be closed while its library shortcuts are updated.',
    );
}
class SteamShortcuts {
  constructor(options = {}) {
    this.roots = options.roots || steamRoots;
    this.closed = options.closed || assertSteamClosed;
    this.busy = false;
  }
  async accounts() {
    const results = [],
      seen = new Set();
    for (const root of await this.roots()) {
      const userdata = path.join(root, 'userdata');
      if (!fs.existsSync(userdata)) continue;
      for (const entry of fs.readdirSync(userdata, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[1-9]\d{0,9}$/.test(entry.name))
          continue;
        const folder = path.join(userdata, entry.name, 'config');
        if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory())
          continue;
        if (
          canonical(folder).toLowerCase() !== path.resolve(folder).toLowerCase()
        )
          continue;
        const id = hash(folder.toLowerCase());
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          label: `Steam account ${entry.name} (${root})`,
          folder,
        });
      }
    }
    return results;
  }
  async list() {
    return (await this.accounts()).map(({ folder, ...account }) => account);
  }
  read(account) {
    const file = path.join(account.folder, 'shortcuts.vdf');
    if (canonical(file).toLowerCase() !== file.toLowerCase())
      throw new Error('The Steam shortcuts file points to another location.');
    const exists = fs.existsSync(file);
    if (exists && fs.statSync(file).size > 16_000_000)
      throw new Error('The Steam shortcuts file is too large.');
    const original = exists ? fs.readFileSync(file) : null;
    const tree = original
      ? decode(original)
      : [{ type: 0, key: 'shortcuts', value: [] }];
    if (tree.length !== 1 || tree[0].type !== 0 || tree[0].key !== 'shortcuts')
      throw new Error('Unexpected Steam shortcuts structure.');
    const entries = tree[0].value;
    if (entries.some((node) => node.type !== 0 || !/^\d{1,9}$/.test(node.key)))
      throw new Error('Unexpected Steam shortcut entries.');
    return { file, exists, original, entries };
  }
  async write({ file, exists, original }, output) {
    decode(output);
    await this.closed();
    if (
      exists !== fs.existsSync(file) ||
      (exists && !fs.readFileSync(file).equals(original))
    )
      throw new Error('Steam shortcuts changed during preparation. Try again.');
    if (canonical(file).toLowerCase() !== file.toLowerCase())
      throw new Error('Steam shortcut location changed.');
    const suffix = crypto.randomUUID();
    const backup = exists ? `${file}.loadstone-${suffix}.bak` : null;
    const temporary = `${file}.loadstone-${suffix}.tmp`;
    if (backup) fs.writeFileSync(backup, original, { flag: 'wx', flush: true });
    try {
      fs.writeFileSync(temporary, output, { flag: 'wx', flush: true });
      if (exists) fs.renameSync(temporary, file);
      else fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return backup;
  }
  async remove(job) {
    if (!/^[a-f0-9-]{36}$/.test(job?.id) || job.status !== 'removed')
      throw new Error('Only removed setups can clean up shortcuts.');
    if (this.busy) throw new Error('Another Steam shortcut update is running.');
    this.busy = true;
    try {
      const backups = [];
      for (const account of await this.accounts()) {
        const snapshot = this.read(account);
        const kept = snapshot.entries.filter((node) => {
          const tags = field(node.value, 'tags');
          return !(
            tags?.type === 0 &&
            tags.value.some(
              (tag) => tag.type === 1 && tag.value === `Loadstone:${job.id}`,
            )
          );
        });
        if (kept.length === snapshot.entries.length) continue;
        await this.closed();
        // Steam uses sequential indices; preserve every field and app ID.
        const entries = kept.map((node, index) =>
          node.key === String(index)
            ? node
            : { type: 0, key: String(index), value: node.value },
        );
        backups.push(
          await this.write(
            snapshot,
            encode([{ type: 0, key: 'shortcuts', value: entries }]),
          ),
        );
      }
      return backups;
    } finally {
      this.busy = false;
    }
  }
  async create(job, accountId) {
    if (this.busy) throw new Error('Another Steam shortcut update is running.');
    this.busy = true;
    try {
      const plan = launchPlan(job);
      const account = (await this.accounts()).find(
        (item) => item.id === accountId,
      );
      if (!account) throw new Error('Select an available local Steam account.');
      await this.closed();
      const snapshot = this.read(account);
      const { entries } = snapshot;
      const marker = `Loadstone:${job.id}`,
        appname = `${job.name} ${job.manifest.version} — Loadstone`;
      const exe = quoteArgument(plan.executable);
      const owned = entries.filter((node) => {
        const tags = field(node.value, 'tags');
        return (
          tags?.type === 0 &&
          tags.value.some((tag) => tag.type === 1 && tag.value === marker)
        );
      });
      if (owned.length > 1)
        throw new Error(
          'Multiple Steam entries claim this setup. Resolve the duplicates in Steam first.',
        );
      const previous = owned[0];
      if (
        !previous &&
        entries.some((node) => field(node.value, 'appname')?.value === appname)
      )
        throw new Error(
          'An unrelated Steam entry already uses this setup name. It was left unchanged.',
        );
      const oldId = previous && field(previous.value, 'appid');
      if (oldId && oldId.type !== 2)
        throw new Error('The owned Steam entry has an invalid app ID.');
      const appid = oldId?.value ?? (crc32(exe + appname) | 0x80000000) >>> 0;
      if (
        entries.some(
          (node) =>
            node !== previous && field(node.value, 'appid')?.value === appid,
        )
      )
        throw new Error(
          'This shortcut conflicts with another Steam app ID. No changes were made.',
        );
      const fields = previous ? [...previous.value] : [];
      const set = (key, value, type = 1) => {
        const index = fields.findIndex(
          (node) => node.key.toLowerCase() === key.toLowerCase(),
        );
        const node = { type, key, value };
        if (index >= 0) fields[index] = node;
        else fields.push(node);
      };
      set('appid', appid, 2);
      set('AppName', appname);
      set('Exe', exe);
      set('StartDir', quoteArgument(plan.cwd));
      set('LaunchOptions', plan.args.map(quoteArgument).join(' '));
      set('icon', plan.executable);
      if (!previous) {
        set('ShortcutPath', '');
        for (const [key, value] of Object.entries({
          IsHidden: 0,
          AllowDesktopConfig: 1,
          AllowOverlay: 1,
          OpenVR: 0,
          Devkit: 0,
          DevkitOverrideAppID: 0,
          LastPlayTime: 0,
        }))
          set(key, value, 2);
        set('DevkitGameID', '');
        set('FlatpakAppID', '');
        set('tags', [{ type: 1, key: '0', value: marker }], 0);
      }
      const key =
        previous?.key ??
        String(Math.max(-1, ...entries.map((node) => Number(node.key))) + 1);
      const replacement = { type: 0, key, value: fields };
      const updated = previous
        ? entries.map((node) => (node === previous ? replacement : node))
        : [...entries, replacement];
      const output = encode([{ type: 0, key: 'shortcuts', value: updated }]);
      const backup = await this.write(snapshot, output);
      return {
        accountId,
        appid,
        backup,
        message: 'Steam entry saved. Open Steam to see it in your library.',
      };
    } finally {
      this.busy = false;
    }
  }
}
module.exports = { SteamShortcuts, crc32, assertSteamClosed };
