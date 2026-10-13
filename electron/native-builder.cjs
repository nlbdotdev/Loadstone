const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectNativePackage, ordinaryFile } = require('./native-package.cjs');
const { materializeNative } = require('./native-materializer.cjs');
const { replaceStateFile } = require('./replace-state-file.cjs');

const statuses = new Set([
  'queued',
  'building',
  'stopping',
  'verified',
  'failed',
  'cancelled',
  'interrupted',
]);
const active = new Set(['queued', 'building', 'stopping']);
const uuid = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const text = (v, max = 500) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
function validateHistory(value) {
  if (
    value?.schemaVersion !== 1 ||
    value.kind !== 'loadstone-native-builds' ||
    !Array.isArray(value.jobs) ||
    value.jobs.length > 100
  )
    throw new Error(
      'Unsupported native build history. Preserve the file and use a compatible app.',
    );
  const seen = new Set();
  for (const job of value.jobs) {
    if (
      !job ||
      !uuid(job.id) ||
      seen.has(job.id) ||
      !text(job.name) ||
      !text(job.version) ||
      !/^[a-f0-9]{64}$/.test(job.recipeSha256) ||
      !text(job.destination, 32767) ||
      !path.isAbsolute(job.destination) ||
      !statuses.has(job.status) ||
      !Number.isSafeInteger(job.completed) ||
      !Number.isSafeInteger(job.total) ||
      job.completed < 0 ||
      job.total < 1 ||
      job.total > 500000 ||
      job.completed > job.total ||
      (job.error !== null && !text(job.error, 2000)) ||
      !text(job.createdAt, 40) ||
      !text(job.updatedAt, 40) ||
      Object.keys(job).some(
        (key) =>
          ![
            'id',
            'name',
            'version',
            'recipeSha256',
            'destination',
            'status',
            'completed',
            'total',
            'error',
            'createdAt',
            'updatedAt',
          ].includes(key),
      )
    )
      throw new Error(
        'Native build history is invalid. Preserve it before recovery.',
      );
    seen.add(job.id);
  }
  return value.jobs;
}
function readInputs(file, recipe) {
  ordinaryFile(file, 5_000_000);
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (v) => !['games', 'archives', 'prerequisites'].includes(v),
    )
  )
    throw new Error(
      'Choose a private local-inputs JSON with games and archives maps.',
    );
  for (const [key, expected] of [
    ['games', recipe.requirements.map((v) => v.id)],
    ['prerequisites', (recipe.prerequisites || []).map((v) => v.id)],
    [
      'archives',
      recipe.sources
        .filter((v) => ['https-archive', 'nexus-archive'].includes(v.type))
        .map((v) => v.id),
    ],
  ]) {
    const selected =
      input[key] ??
      (key === 'prerequisites' && !expected.length ? {} : undefined);
    if (
      !selected ||
      typeof selected !== 'object' ||
      Array.isArray(selected) ||
      Object.keys(selected).length !== expected.length ||
      expected.some((id) => !Object.hasOwn(selected, id)) ||
      Object.values(selected).some(
        (v) => !text(v, 32767) || !path.isAbsolute(v),
      )
    )
      throw new Error(
        'Local inputs must select every required game and archive exactly once.',
      );
  }
  return input;
}
class NativeBuilder {
  constructor(root, options = {}) {
    this.root = root;
    this.file = path.join(root, 'native-builds.json');
    this.options = options;
    this.jobs = [];
    this.preparing = false;
    this.controller = null;
    this.plan = null;
    this.persistenceFailed = false;
    fs.mkdirSync(root, { recursive: true });
    if (fs.existsSync(this.file)) {
      ordinaryFile(this.file, 5_000_000);
      this.jobs = validateHistory(
        JSON.parse(fs.readFileSync(this.file, 'utf8')),
      );
      if (this.jobs.some((v) => active.has(v.status))) {
        this.jobs = this.jobs.map((job) =>
          active.has(job.status)
            ? {
                ...job,
                status: 'interrupted',
                updatedAt: new Date().toISOString(),
                error:
                  'Loadstone closed before this build finished. Keep the partial folder; prepare a new build to retry.',
              }
            : job,
        );
        this.save(this.jobs);
      }
    }
  }
  get busy() {
    return this.preparing || Boolean(this.controller);
  }
  list() {
    return structuredClone(this.jobs);
  }
  save(jobs) {
    validateHistory({
      schemaVersion: 1,
      kind: 'loadstone-native-builds',
      jobs,
    });
    try {
      const root = fs.lstatSync(this.root);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        fs.realpathSync(this.root).toLowerCase() !==
          path.resolve(this.root).toLowerCase()
      )
        throw new Error('Redirected native history directory.');
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(
        temporary,
        JSON.stringify({
          schemaVersion: 1,
          kind: 'loadstone-native-builds',
          jobs,
        }) + '\n',
        { flag: 'wx', flush: true },
      );
      replaceStateFile(temporary, this.file);
    } catch {
      this.persistenceFailed = true;
      throw new Error(
        'Native build history could not be saved. Restart Loadstone before building again.',
      );
    }
  }
  change(id, patch, persist = true) {
    const jobs = this.jobs.map((v) =>
      v.id === id ? { ...v, ...patch, updatedAt: new Date().toISOString() } : v,
    );
    if (persist) this.save(jobs);
    this.jobs = jobs;
  }
  async prepare(choose) {
    if (this.persistenceFailed)
      throw new Error('Restart Loadstone to recover native build history.');
    if (this.busy)
      throw new Error('Wait for the current native build or selection.');
    this.options.assertAvailable?.();
    if (this.jobs.length >= 100)
      throw new Error(
        'The native build history is full. Preserve it before recovery.',
      );
    this.preparing = true;
    this.plan = null;
    try {
      const selected = await choose();
      if (!selected) return null;
      if (
        path.extname(selected.packageFile).toLowerCase() !== '.loadstone' ||
        !path.isAbsolute(selected.parent)
      )
        throw new Error('Choose a native package and a local parent folder.');
      const inspected = await inspectNativePackage(selected.packageFile);
      const inputs = readInputs(selected.inputsFile, inspected.recipe);
      const id = crypto.randomUUID();
      const summary = {
        id,
        name: inspected.recipe.name,
        version: inspected.recipe.version,
        recipeSha256: inspected.recipeSha256,
        destination: path.join(
          selected.parent,
          `${inspected.recipe.id}-${id.slice(0, 8)}`,
        ),
        outputs: inspected.summary.outputs,
        installBytes: inspected.summary.installBytes,
        requiredGames: inspected.summary.requiredGames,
        prerequisites: inspected.summary.prerequisites,
        archiveCount: Object.keys(inputs.archives).length,
      };
      this.plan = { summary, packageFile: selected.packageFile, inputs };
      return structuredClone(summary);
    } finally {
      this.preparing = false;
    }
  }
  start(id) {
    if (this.persistenceFailed)
      throw new Error('Restart Loadstone to recover native build history.');
    if (this.busy) throw new Error('A native build is already running.');
    this.options.assertAvailable?.();
    if (!uuid(id) || this.plan?.summary.id !== id)
      throw new Error('Review the local build inputs again before starting.');
    const plan = this.plan,
      summary = plan.summary,
      now = new Date().toISOString();
    const job = {
      id,
      name: summary.name,
      version: summary.version,
      recipeSha256: summary.recipeSha256,
      destination: summary.destination,
      status: 'queued',
      completed: 0,
      total: summary.outputs,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const jobs = [...this.jobs, job];
    this.save(jobs);
    this.jobs = jobs;
    this.plan = null;
    this.controller = new AbortController();
    this.done = this.run(plan, this.controller);
    return this.list();
  }
  cancel(id) {
    if (
      !uuid(id) ||
      !this.controller ||
      !this.jobs.some((v) => v.id === id && active.has(v.status))
    )
      throw new Error('That native build is not running.');
    try {
      this.change(id, { status: 'stopping' });
    } finally {
      this.controller.abort();
    }
    return this.list();
  }
  async run(plan, controller) {
    const { id, destination, recipeSha256 } = plan.summary;
    try {
      this.change(id, { status: 'building' });
      await materializeNative(plan.packageFile, destination, {
        ...plan.inputs,
        expectedRecipeSha256: recipeSha256,
        signal: controller.signal,
        protectedRoots: [
          this.root,
          ...(this.options.protectedRoots?.() || []),
          ...this.jobs.filter((v) => v.id !== id).map((v) => v.destination),
        ],
        progress: ({ completed }) =>
          this.change(id, { completed }, completed % 100 === 0),
      });
      this.change(id, {
        status: 'verified',
        completed: plan.summary.outputs,
      });
    } catch {
      try {
        this.change(id, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted
            ? 'Build cancelled. Any partial folder is preserved. Prepare a new build to retry.'
            : 'Build failed. Check the package, local input hashes, destination and free space. Any partial folder is preserved.',
        });
      } catch {
        this.persistenceFailed = true;
        this.change(
          id,
          {
            status: 'failed',
            error:
              'Build stopped because its history could not be saved. Restart Loadstone for recovery; any partial folder is preserved.',
          },
          false,
        );
      }
    } finally {
      this.controller = null;
    }
  }
}
module.exports = { NativeBuilder, validateHistory };
