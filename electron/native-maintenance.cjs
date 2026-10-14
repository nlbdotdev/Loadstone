const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonical, contains } = require('./live-catalog.cjs');
const { candidateMetadata } = require('./native-library.cjs');
const { assertGamesClosed } = require('./maintenance.cjs');
const { matchesMtime } = require('./native-file-metadata.cjs');

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function demand(value, message) {
  if (!value) throw new Error(message);
}
function rootIdentity(root) {
  const stat = fs.lstatSync(root, { bigint: true });
  demand(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      same(canonical(root), path.resolve(root)),
    'The native candidate or recovery directory is redirected. Preserve it before recovery.',
  );
  return `${stat.dev}:${stat.ino}`;
}
function fileIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  demand(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      same(canonical(file), path.resolve(file)),
    'A native removal file is redirected or no longer ordinary.',
  );
  return {
    bytes: Number(stat.size),
    mtimeMs: Number(stat.mtimeNs) / 1e6,
    identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
  };
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
function preserve(relative) {
  return (
    /(^|\/)saves($|\/)/i.test(relative) ||
    /^(profiles|overwrite|downloads)($|\/)/i.test(relative) ||
    /(^|\/)\.loadstone/i.test(relative) ||
    /\.(ini|json|toml|ya?ml|cfg|conf|fos|ess|nvse|skse|f4se|bak)$/i.test(
      relative,
    )
  );
}
async function matching(file, output, expectedIdentity, signal) {
  if (!exists(file)) return false;
  const before = fileIdentity(file);
  if (
    before.bytes !== output.bytes ||
    !matchesMtime(before, output) ||
    (expectedIdentity && before.identity !== expectedIdentity)
  )
    return false;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file, { signal })) {
    bytes += chunk.length;
    if (bytes > output.bytes) return false;
    hash.update(chunk);
  }
  const after = fileIdentity(file);
  return before.identity === after.identity &&
    bytes === output.bytes &&
    hash.digest('hex') === output.sha256
    ? after
    : false;
}
async function scanNativeRemoval(meta, options = {}) {
  const files = new Map(),
    queue = [meta.root];
  let count = 0;
  const guard = () =>
    demand(
      rootIdentity(meta.root) === meta.identity,
      'The native removal directory changed. Remaining files were preserved.',
    );
  while (queue.length) {
    options.signal?.throwIfAborted();
    guard();
    const file = queue.pop();
    demand(
      ++count <= 1_000_000,
      'The native removal tree exceeds its scan limit.',
    );
    const stat = await fs.promises.lstat(file);
    demand(
      contains(meta.root, file) &&
        !stat.isSymbolicLink() &&
        same(canonical(file), file),
      'A candidate path is redirected. Restore its ordinary layout before removal.',
    );
    if (stat.isDirectory()) {
      for (const name of await fs.promises.readdir(file))
        queue.push(path.join(file, name));
    } else {
      demand(
        stat.isFile(),
        'An unsupported filesystem entry prevents safe native removal.',
      );
      const relative = path.relative(meta.root, file).replaceAll('\\', '/');
      files.set(relative.toLowerCase(), relative);
    }
    options.progress?.({ phase: 'inventory', completed: count, total: 0 });
  }
  const selected = [];
  let completed = 0,
    bytes = 0;
  for (const output of meta.recipe.outputs) {
    options.signal?.throwIfAborted();
    guard();
    const relative = files.get(output.path.toLowerCase());
    if (
      relative &&
      output.action.type !== 'mo2-config' &&
      !preserve(relative)
    ) {
      const match = await matching(
        path.join(meta.root, relative),
        output,
        null,
        options.signal,
      );
      if (match) {
        selected.push({
          path: relative,
          bytes: output.bytes,
          sha256: output.sha256,
          ...(output.mtimeMs === undefined ? {} : { mtimeMs: output.mtimeMs }),
          identity: match.identity,
        });
        bytes += output.bytes;
      }
    }
    options.progress?.({
      phase: 'removal-review',
      completed: ++completed,
      total: meta.recipe.outputs.length,
    });
  }
  guard();
  return { selected, bytes, preserved: files.size - selected.length };
}
class NativeMaintenance {
  constructor(library, options = {}) {
    this.library = library;
    this.options = options;
    this.idle = options.idle || assertGamesClosed;
    this.unlink = options.unlink || fs.unlinkSync;
    this.pending = null;
  }
  ensureIdle() {
    return this.idle();
  }
  locate(id) {
    const entry = this.library.record(id);
    demand(
      ['installed', 'repair-failed', 'removing', 'removal-failed'].includes(
        entry.status,
      ),
      'This native setup cannot be removed in its current state.',
    );
    const recovery = `${entry.root}.loadstone-recovery-${entry.id}`;
    const originalExists = exists(entry.root),
      recoveryExists = exists(recovery);
    demand(
      !(originalExists && recoveryExists),
      'Both native candidate and recovery folders exist. Resolve the conflict before removal.',
    );
    demand(
      !['installed', 'repair-failed'].includes(entry.status) || !recoveryExists,
      'The native recovery folder already exists. It was left unchanged.',
    );
    const root = !originalExists && recoveryExists ? recovery : entry.root;
    demand(
      originalExists || recoveryExists,
      'The native candidate and recovery folders are missing.',
    );
    demand(
      same(canonical(recovery), path.resolve(recovery)) &&
        same(path.dirname(recovery), path.dirname(entry.root)),
      'The native recovery destination is redirected or outside the selected parent.',
    );
    const protectedRoots = [
      path.dirname(this.library.file),
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      ...(this.options.protectedRoots?.(id) || []),
    ].filter(Boolean);
    for (const target of [root, recovery]) {
      demand(
        target !== path.parse(target).root &&
          !protectedRoots.some(
            (v) =>
              contains(canonical(v), target) || contains(target, canonical(v)),
          ) &&
          !(
            process.env.USERPROFILE &&
            contains(target, canonical(process.env.USERPROFILE))
          ),
        'The native removal location overlaps a protected application or system folder.',
      );
    }
    const meta = candidateMetadata(root, { ...entry, root }, entry.root);
    return { entry, root, recovery, meta, moved: root === recovery };
  }
  begin() {
    this.library.available();
    this.library.busy = true;
    this.library.controller = new AbortController();
  }
  end() {
    this.library.busy = false;
    this.library.controller = null;
    this.library.progress = null;
  }
  async preview(id) {
    this.begin();
    this.pending = null;
    try {
      demand(
        !this.library.launcher.sessions.get(id)?.child,
        'Close the launched mod manager before removing its setup.',
      );
      await this.ensureIdle();
      const located = this.locate(id);
      const scan = await scanNativeRemoval(located.meta, {
        signal: this.library.controller.signal,
        progress: (value) => {
          this.library.progress = value;
        },
      });
      this.library.controller.signal.throwIfAborted();
      const current = this.locate(id);
      demand(
        current.root === located.root,
        'The native candidate moved during removal review.',
      );
      this.pending = {
        id: crypto.randomUUID(),
        entryId: id,
        root: located.root,
        ...scan,
      };
      return {
        id: this.pending.id,
        destination: located.entry.root,
        recovery: located.recovery,
        files: scan.selected.length,
        bytes: scan.bytes,
        preserved: scan.preserved,
      };
    } catch (error) {
      if (this.library.controller.signal.aborted)
        throw new Error(
          'Native removal review cancelled. No files were changed.',
        );
      throw error;
    } finally {
      this.end();
    }
  }
  async remove(planId) {
    this.begin();
    let begun = false,
      id;
    try {
      const plan = this.pending;
      demand(
        plan?.id === planId,
        'Review native removal before confirming it.',
      );
      id = plan.entryId;
      this.pending = null;
      await this.ensureIdle();
      demand(
        !this.library.launcher.sessions.get(id)?.child,
        'Close the launched mod manager before removing its setup.',
      );
      const located = this.locate(id);
      demand(
        located.root === plan.root,
        'The native candidate moved after removal review.',
      );
      this.library.controller.signal.throwIfAborted();
      this.library.change(id, {
        status: 'removing',
        recoveryRoot: located.recovery,
        maintenanceError: null,
        shortcutsCleaned: false,
        shortcutError: null,
      });
      begun = true;
      // Both absolute paths were checked against the registered root, the same
      // ordinary parent and protected folders. Never replace a recovery folder.
      const current = this.locate(id);
      if (!current.moved) fs.renameSync(current.root, current.recovery);
      const root = current.recovery,
        directories = new Set();
      const guard = () =>
        demand(
          rootIdentity(root) === current.entry.identity,
          'The native recovery directory changed. Remaining files were preserved.',
        );
      let completed = 0;
      this.library.progress = {
        phase: 'removal',
        completed,
        total: plan.selected.length,
      };
      for (const output of plan.selected) {
        this.library.controller.signal.throwIfAborted();
        guard();
        const file = path.join(root, output.path);
        demand(
          contains(root, file),
          'A native removal path escapes its recovery folder.',
        );
        const match = await matching(
          file,
          output,
          output.identity,
          this.library.controller.signal,
        );
        guard();
        if (match && fileIdentity(file).identity === match.identity) {
          this.unlink(file);
          let folder = path.dirname(file);
          while (folder !== root) {
            demand(
              contains(root, folder),
              'A native removal directory escapes its recovery folder.',
            );
            directories.add(folder);
            folder = path.dirname(folder);
          }
        }
        this.library.progress = {
          phase: 'removal',
          completed: ++completed,
          total: plan.selected.length,
        };
      }
      for (const folder of [...directories].sort(
        (a, b) => b.length - a.length,
      )) {
        this.library.controller.signal.throwIfAborted();
        guard();
        demand(
          contains(root, folder) &&
            same(canonical(folder), folder) &&
            !fs.lstatSync(folder).isSymbolicLink(),
          'A native removal directory changed. Remaining files were preserved.',
        );
        try {
          fs.rmdirSync(folder);
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
      this.locate(id);
      this.library.change(id, { status: 'removed', maintenanceError: null });
      return this.library.list();
    } catch (error) {
      if (begun) {
        try {
          this.library.change(id, {
            status: 'removal-failed',
            maintenanceError:
              'Removal stopped. Remaining files are retained in the candidate or recovery folder. Review them to resume.',
          });
        } catch {
          /* Durable removing state is recovered on restart. */
        }
      }
      if (this.library.controller.signal.aborted)
        throw new Error(
          'Native removal stopped. Remaining files are retained for recovery.',
        );
      throw error;
    } finally {
      this.end();
    }
  }
}
module.exports = { NativeMaintenance, scanNativeRemoval, preserve };
