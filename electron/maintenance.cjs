const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { owned } = require('./installer.cjs');
const { canonical, contains } = require('./live-catalog.cjs');

async function assertGamesClosed() {
  const { stdout } = await promisify(execFile)(
    'tasklist.exe',
    ['/FO', 'CSV', '/NH'],
    { windowsHide: true, timeout: 10000, maxBuffer: 4_000_000 },
  );
  if (
    /^"(?:ModOrganizer|FalloutNV|FalloutNVLauncher|SkyrimSE|SkyrimSELauncher|Fallout4|Fallout4Launcher|nvse_loader|skse64_loader|f4se_loader|Wabbajack|wabbajack-cli)\.exe"/im.test(
      stdout,
    )
  )
    throw new Error(
      'Close supported games, script extenders, Mod Organizer and Wabbajack before removing a setup.',
    );
}
function recoveryPath(job) {
  return `${job.destination}.loadstone-recovery-${job.id}`;
}
function protectedPath(job, root, userData, applicationRoots = []) {
  const game = canonical(job.gameFolder);
  const protectedRoots = [
    ...applicationRoots,
    game,
    userData,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.USERPROFILE,
  ].filter(Boolean);
  if (
    root === path.parse(root).root ||
    protectedRoots.some((folder) => {
      const resolved = canonical(folder);
      return (
        contains(root, resolved) ||
        (folder !== process.env.USERPROFILE && contains(resolved, root))
      );
    })
  )
    throw new Error(
      'This setup overlaps a game, system or application folder and cannot be removed.',
    );
}
async function scanProfile(root) {
  const profile = path.join(root, 'profile'),
    files = [],
    directories = [];
  if (!fs.existsSync(profile)) return { files, directories, bytes: 0 };
  const queue = [{ file: profile, keep: false }];
  let bytes = 0,
    count = 0;
  while (queue.length) {
    const { file, keep } = queue.pop();
    if (++count > 500000)
      throw new Error('This setup exceeds the removal scan limit.');
    const stat = await fs.promises.lstat(file);
    if (
      stat.isSymbolicLink() ||
      canonical(file).toLowerCase() !== path.resolve(file).toLowerCase()
    )
      throw new Error(
        'A setup path is redirected. Restore its original layout before removal.',
      );
    if (!contains(root, file))
      throw new Error('A removal path escapes the setup.');
    const relative = path.relative(profile, file).replaceAll('\\', '/');
    const preserve =
      keep ||
      /(^|\/)saves($|\/)/i.test(relative) ||
      /^(profiles|overwrite)($|\/)/i.test(relative) ||
      /^ModOrganizer\.ini$/i.test(relative);
    if (stat.isDirectory()) {
      if (!preserve) directories.push(file);
      for (const name of await fs.promises.readdir(file))
        queue.push({ file: path.join(file, name), keep: preserve });
    } else if (stat.isFile()) {
      if (!preserve) {
        files.push(file);
        bytes += stat.size;
      }
    } else
      throw new Error('An unsupported filesystem entry prevents safe removal.');
  }
  return { files, directories: directories.reverse(), bytes };
}
class Maintenance {
  constructor(installer, options = {}) {
    this.installer = installer;
    this.idle = options.idle || assertGamesClosed;
    this.unlink = options.unlink || fs.promises.unlink.bind(fs.promises);
  }
  locate(id) {
    const job = this.installer.jobs.find((item) => item.id === id);
    if (!job || !['installed', 'removal-failed'].includes(job.status))
      throw new Error(
        'This installation cannot be removed in its current state.',
      );
    const recovery = recoveryPath(job);
    const moved = job.status === 'removal-failed' && fs.existsSync(recovery);
    if (fs.existsSync(job.destination) && fs.existsSync(recovery))
      throw new Error(
        'Both the setup and recovery folders exist. Resolve this conflict before continuing.',
      );
    const root = owned({
      ...job,
      destination: moved ? recovery : job.destination,
    });
    protectedPath(
      job,
      root,
      path.dirname(this.installer.file),
      this.installer.catalog?.applicationRoots,
    );
    if (
      canonical(recovery).toLowerCase() !== path.resolve(recovery).toLowerCase()
    )
      throw new Error('The recovery folder points to another location.');
    return { job, root, recovery, moved };
  }
  async preview(id) {
    if (
      this.installer.running ||
      this.installer.starting ||
      this.installer.maintenance
    )
      throw new Error(
        'Wait for the current installation or maintenance operation to finish.',
      );
    await this.idle();
    const located = this.locate(id);
    const plan = await scanProfile(located.root);
    return {
      destination: located.job.destination,
      recovery: located.recovery,
      files: plan.files.length,
      bytes: plan.bytes,
    };
  }
  async remove(id) {
    if (
      this.installer.running ||
      this.installer.starting ||
      this.installer.maintenance
    )
      throw new Error(
        'Another installation or maintenance operation is running.',
      );
    this.installer.maintenance = true;
    let begun = false;
    try {
      await this.idle();
      const located = this.locate(id);
      await scanProfile(located.root);
      await this.idle();
      // Revalidate ownership and both absolute paths immediately before the move.
      const current = this.locate(id);
      this.installer.change(id, {
        status: 'removing',
        removalRecoveryPath: current.recovery,
        error: null,
      });
      begun = true;
      if (!current.moved) fs.renameSync(current.root, current.recovery);
      const root = owned({ ...current.job, destination: current.recovery });
      const plan = await scanProfile(root);
      for (const file of plan.files) {
        if (
          !contains(root, file) ||
          canonical(file).toLowerCase() !== path.resolve(file).toLowerCase() ||
          (await fs.promises.lstat(file)).isSymbolicLink()
        )
          throw new Error(
            'A removal path changed. Remaining files were preserved.',
          );
        await this.unlink(file);
      }
      for (const directory of plan.directories) {
        if (
          !contains(root, directory) ||
          canonical(directory).toLowerCase() !==
            path.resolve(directory).toLowerCase()
        )
          throw new Error('A removal directory changed.');
        try {
          await fs.promises.rmdir(directory);
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
      this.installer.change(id, {
        status: 'removed',
        removedAt: new Date().toISOString(),
        error: null,
      });
      return this.installer.list();
    } catch (error) {
      if (begun) {
        try {
          this.installer.change(id, {
            status: 'removal-failed',
            error:
              'Removal stopped. Preserved data remains in the setup or recovery folder. ' +
              error.message,
          });
        } catch {
          /* The durable removing state is recoverable on next launch. */
        }
      }
      throw error;
    } finally {
      this.installer.maintenance = false;
    }
  }
}
module.exports = { Maintenance, recoveryPath, scanProfile, assertGamesClosed };
