const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchPlan } = require('./launcher.cjs');
const { canonical } = require('./live-catalog.cjs');
const samePath = (a, b) =>
  fs.realpathSync.native(a).toLowerCase() ===
  fs.realpathSync.native(b).toLowerCase();

// Windows command-line quoting for a single argument (no shell involved).
function quoteArgument(value) {
  return (
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'
  );
}
function desktopIdentity(job, desktop) {
  if (!/^[a-f0-9-]{36}$/.test(job?.id))
    throw new Error('Invalid installation identity.');
  const root = canonical(desktop);
  if (!fs.statSync(root).isDirectory())
    throw new Error('Your Desktop folder is unavailable.');
  const name =
    job.name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .slice(0, 70) || 'Setup';
  const file = path.join(root, `Loadstone - ${name} - ${job.id}.lnk`);
  const description = `Loadstone setup ${job.id}`;
  return { root, file, description };
}
function removeDesktopShortcut(job, desktop, shell) {
  if (job?.status !== 'removed')
    throw new Error('Only removed setups can clean up shortcuts.');
  const { file, description } = desktopIdentity(job, desktop);
  if (!fs.existsSync(file)) return;
  if (
    fs.lstatSync(file).isSymbolicLink() ||
    canonical(file).toLowerCase() !== file.toLowerCase() ||
    shell.readShortcutLink(file).description !== description
  )
    throw new Error(
      'A different desktop shortcut uses this filename. It was left unchanged.',
    );
  fs.unlinkSync(file);
}
function createDesktopShortcut(job, desktop, shell) {
  if (process.platform !== 'win32')
    throw new Error('Desktop shortcuts currently require Windows.');
  if (!/^[a-f0-9-]{36}$/.test(job?.id))
    throw new Error('Invalid installation identity.');
  const plan = launchPlan(job);
  const { file, description, root } = desktopIdentity(job, desktop);
  const exists = fs.existsSync(file);
  if (exists) {
    if (
      canonical(file).toLowerCase() !== file.toLowerCase() ||
      shell.readShortcutLink(file).description !== description
    )
      throw new Error(
        'A different shortcut already uses this filename. It was left unchanged.',
      );
  }
  const details = {
    target: plan.executable,
    cwd: plan.cwd,
    args: plan.args.map(quoteArgument).join(' '),
    description,
    icon: plan.executable,
    iconIndex: 0,
    appUserModelId: `dev.nlb.loadstone.setup.${job.id}`,
  };
  const temporary = path.join(root, `.loadstone-${crypto.randomUUID()}.lnk`);
  try {
    if (!shell.writeShortcutLink(temporary, 'create', details))
      throw new Error('Windows could not create the desktop shortcut.');
    const written = shell.readShortcutLink(temporary);
    if (
      !samePath(written.target, details.target) ||
      !samePath(written.cwd, details.cwd) ||
      written.args !== details.args ||
      written.description !== description
    )
      throw new Error('Windows could not verify the desktop shortcut.');
    if (exists) fs.renameSync(temporary, file);
    else fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL);
    return file;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
module.exports = {
  createDesktopShortcut,
  removeDesktopShortcut,
  quoteArgument,
};
