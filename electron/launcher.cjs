const { childEnvironment } = require('./child-environment.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { verifyProfile } = require('./installer.cjs');
const { canonical } = require('./live-catalog.cjs');
const { decodeMo2Value } = require('./mo2-ini-value.cjs');

function launchPlan(job) {
  if (!job || job.status !== 'installed')
    throw new Error('Only completed installations can be launched.');
  const verified = verifyProfile(job);
  const cwd = path.dirname(verified.manager);
  // This adapter supports the local profile layout verified by the installer.
  const ini = fs.readFileSync(path.join(cwd, 'ModOrganizer.ini'), 'utf8');
  let section = '';
  let base = cwd;
  const settings = {};
  for (const line of ini.split(/\r?\n/)) {
    const heading = line.match(/^\[([^\]]+)\]/);
    if (heading) {
      section = heading[1];
      continue;
    }
    const entry = line.match(/^(base_directory|profiles_directory)=(.*)$/);
    if (section === 'Settings' && entry)
      settings[entry[1]] = decodeMo2Value(entry[2]);
  }
  if (settings.base_directory)
    base = path.resolve(cwd, settings.base_directory);
  const profiles = settings.profiles_directory
    ? path.resolve(
        cwd,
        settings.profiles_directory.replaceAll('%BASE_DIR%', base),
      )
    : path.join(base, 'profiles');
  if (
    canonical(profiles).toLowerCase() !==
    path.join(cwd, 'profiles').toLowerCase()
  )
    throw new Error(
      'The mod manager points to a different profile directory. Restore this setup’s local profile layout before launching.',
    );
  const portable = path.join(cwd, 'portable.txt');
  if (
    !fs.existsSync(portable) ||
    !fs.statSync(portable).isFile() ||
    canonical(portable).toLowerCase() !== portable.toLowerCase()
  )
    throw new Error(
      'This setup needs its original portable.txt marker before it can launch.',
    );
  return {
    executable: verified.manager,
    args: ['-p', verified.profile, 'run', '-e', verified.executable],
    cwd,
  };
}

class Launcher {
  constructor(installer, options = {}) {
    this.installer = installer;
    this.spawn = options.spawn || spawn;
    this.sessions = new Map();
  }
  list() {
    return this.installer.list().map((job) => ({
      ...job,
      launch: this.sessions.get(job.id)?.status || null,
    }));
  }
  verify(id) {
    const plan = launchPlan(this.installer.jobs.find((job) => job.id === id));
    return plan;
  }
  async launch(id) {
    if (this.installer.maintenance)
      throw new Error('Wait for setup maintenance to finish before launching.');
    if (this.sessions.get(id)?.child)
      throw new Error('The mod manager launched by Loadstone is still open.');
    const plan = this.verify(id);
    const session = {
      child: null,
      status: { phase: 'starting', message: 'Starting the mod manager…' },
    };
    this.sessions.set(id, session);
    try {
      const env = childEnvironment();
      await new Promise((resolve, reject) => {
        const child = this.spawn(plan.executable, plan.args, {
          cwd: plan.cwd,
          env,
          shell: false,
          detached: true,
          windowsHide: false,
          stdio: 'ignore',
        });
        session.child = child;
        child.once('error', () => {
          session.child = null;
          session.status = {
            phase: 'error',
            message:
              'The mod manager could not start. Verify or repair this setup.',
          };
          reject(new Error(session.status.message));
        });
        child.once('spawn', () => {
          session.status = {
            phase: 'open',
            message:
              'Mod manager opened. Check its window for game startup or errors.',
          };
          child.unref();
          resolve();
        });
        child.once('exit', (code) => {
          session.child = null;
          session.status =
            code === 0
              ? {
                  phase: 'closed',
                  message:
                    'The launched manager process closed. It may have handed control to an existing MO2 window.',
                }
              : {
                  phase: 'error',
                  message: `The mod manager exited with code ${code ?? 'unknown'}. Check its logs before retrying.`,
                };
        });
      });
      return this.list();
    } catch (error) {
      session.child = null;
      session.status = {
        phase: 'error',
        message:
          'The mod manager could not start. Verify or repair this setup.',
      };
      throw new Error(session.status.message);
    }
  }
}
module.exports = { Launcher, launchPlan };
