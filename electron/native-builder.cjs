const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectNativePackage, ordinaryFile } = require('./native-package.cjs');
const { materializeNative } = require('./native-materializer.cjs');
const { replaceStateFile } = require('./replace-state-file.cjs');
const { archiveKind } = require('./archive-kind.cjs');
const { createSevenZip } = require('./sevenzip.cjs');
const { acquireArchives, archiveSource } = require('./native-downloads.cjs');
const { DownloadError } = require('./native-network.cjs');
const { reviewBuildRecovery } = require('./native-build-recovery.cjs');
const { assertGamesClosed } = require('./maintenance.cjs');
const resumable = new Set(['failed', 'cancelled', 'interrupted']);
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');

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
        (v) =>
          !(key === 'archives' && v === null) &&
          (!text(v, 32767) || !path.isAbsolute(v)),
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
    this.activities = new Map();
    this.preparing = false;
    this.controller = null;
    this.plan = null;
    this.persistenceFailed = false;
    this.savedHash = null;
    fs.mkdirSync(root, { recursive: true });
    if (fs.existsSync(this.file)) {
      ordinaryFile(this.file, 5_000_000);
      const data = fs.readFileSync(this.file);
      this.savedHash = digest(data);
      this.jobs = validateHistory(JSON.parse(data));
      if (this.jobs.some((v) => active.has(v.status))) {
        this.jobs = this.jobs.map((job) =>
          active.has(job.status)
            ? {
                ...job,
                status: 'interrupted',
                updatedAt: new Date().toISOString(),
                error:
                  'Loadstone closed before this build finished. Review the same recipe and inputs to resume the retained candidate.',
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
    return structuredClone(
      this.jobs.map((job) => ({
        ...job,
        ...(this.activities.has(job.id)
          ? { activity: this.activities.get(job.id) }
          : {}),
      })),
    );
  }
  ensureIdle() {
    return (this.options.idle || assertGamesClosed)();
  }
  recoveryRoots(id) {
    return [
      this.root,
      ...(this.options.protectedRoots?.() || []),
      ...this.jobs.filter((v) => v.id !== id).map((v) => v.destination),
    ];
  }
  save(jobs) {
    validateHistory({
      schemaVersion: 1,
      kind: 'loadstone-native-builds',
      jobs,
    });
    try {
      if (fs.existsSync(this.file)) {
        ordinaryFile(this.file, 5_000_000);
        if (digest(fs.readFileSync(this.file)) !== this.savedHash)
          throw new Error('Build history changed outside this session.');
      } else if (this.savedHash !== null)
        throw new Error('Build history disappeared.');
      const root = fs.lstatSync(this.root);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        fs.realpathSync(this.root).toLowerCase() !==
          path.resolve(this.root).toLowerCase()
      )
        throw new Error('Redirected native history directory.');
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      const data =
        JSON.stringify({
          schemaVersion: 1,
          kind: 'loadstone-native-builds',
          jobs,
        }) + '\n';
      fs.writeFileSync(temporary, data, { flag: 'wx', flush: true });
      replaceStateFile(temporary, this.file);
      this.savedHash = digest(data);
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
  async prepare(choose, chooseArchiveTool, resumeId) {
    if (this.persistenceFailed)
      throw new Error('Restart Loadstone to recover native build history.');
    if (this.busy)
      throw new Error('Wait for the current native build or selection.');
    this.options.assertAvailable?.();
    const resumeJob =
      resumeId === undefined
        ? null
        : this.jobs.find((v) => v.id === resumeId && resumable.has(v.status));
    if (resumeId !== undefined && !resumeJob)
      throw new Error(
        'Choose a failed, cancelled or interrupted build to resume.',
      );
    if (!resumeJob && this.jobs.length >= 100)
      throw new Error(
        'The native build history is full. Preserve it before recovery.',
      );
    this.preparing = true;
    this.plan = null;
    if (resumeJob) {
      this.controller = new AbortController();
      this.reviewId = resumeJob.id;
    }
    try {
      const selected = await choose(resumeJob?.destination);
      if (!selected) return null;
      this.controller?.signal.throwIfAborted();
      if (
        path.extname(selected.packageFile).toLowerCase() !== '.loadstone' ||
        (!resumeJob && !path.isAbsolute(selected.parent))
      )
        throw new Error('Choose a native package and a local parent folder.');
      const inspected = await inspectNativePackage(selected.packageFile);
      this.controller?.signal.throwIfAborted();
      if (resumeJob && inspected.recipeSha256 !== resumeJob.recipeSha256)
        throw new Error('Resume requires the exact recipe from this build.');
      const inputs = readInputs(selected.inputsFile, inspected.recipe);
      const needsTool = Object.values(inputs.archives).some(
        (file) =>
          file === null || ['7z', 'rar', 'rar5'].includes(archiveKind(file)),
      );
      let sevenZip;
      if (needsTool) {
        if (!chooseArchiveTool)
          throw new Error(
            'Select a trusted local 7z.exe to reconstruct this package.',
          );
        const executable = await chooseArchiveTool();
        if (!executable) return null;
        sevenZip = await createSevenZip(executable);
      }
      const id = crypto.randomUUID();
      let resume;
      if (resumeJob) {
        this.controller.signal.throwIfAborted();
        await this.ensureIdle();
        resume = await reviewBuildRecovery(inspected, resumeJob.destination, {
          signal: this.controller.signal,
          activity: (value) => this.activities.set(resumeJob.id, value),
          protectedRoots: this.recoveryRoots(resumeJob.id),
        });
        this.controller.signal.throwIfAborted();
      }
      const downloads = inspected.recipe.sources.filter(
        (source) =>
          archiveSource(source) && inputs.archives[source.id] === null,
      );
      const summary = {
        id,
        name: inspected.recipe.name,
        version: inspected.recipe.version,
        recipeSha256: inspected.recipeSha256,
        destination:
          resumeJob?.destination ??
          path.join(
            selected.parent,
            `${inspected.recipe.id}-${id.slice(0, 8)}`,
          ),
        outputs: inspected.summary.outputs,
        installBytes: inspected.summary.installBytes,
        generatedConfigurations: inspected.summary.generatedConfigurations,
        requiredGames: inspected.summary.requiredGames,
        prerequisites: inspected.summary.prerequisites,
        archiveCount: Object.values(inputs.archives).filter((v) => v !== null)
          .length,
        downloadCount: downloads.length,
        downloadBytes: downloads.reduce((sum, source) => sum + source.bytes, 0),
        downloadHosts: [
          ...new Set(
            downloads.map((source) =>
              source.type === 'nexus-archive'
                ? 'nexusmods.com'
                : new URL(source.url).hostname,
            ),
          ),
        ],
        downloadCache: downloads.length
          ? path.join(this.root, 'native-downloads')
          : null,
        archiveTool: sevenZip ? `7-Zip ${sevenZip.version} x64` : null,
        ...(resume
          ? {
              resume: {
                jobId: resumeJob.id,
                reused: resume.reused,
                conflicts: resume.conflicts,
                missing: resume.missing,
                retained: resume.retained,
                writeBytes: resume.writeBytes,
                recoveryRoot: path.join(
                  resume.root,
                  '.loadstone-build-recovery',
                ),
              },
            }
          : {}),
      };
      this.plan = {
        summary,
        packageFile: selected.packageFile,
        inputs,
        sevenZip,
        resume,
      };
      return structuredClone(summary);
    } finally {
      if (resumeJob) {
        this.activities.delete(resumeJob.id);
        this.reviewId = null;
        this.controller = null;
      }
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
    const previous = summary.resume
      ? this.jobs.find(
          (v) => v.id === summary.resume.jobId && resumable.has(v.status),
        )
      : null;
    if (summary.resume && !previous)
      throw new Error('Review recovery again before resuming.');
    const job = {
      id: previous?.id ?? id,
      name: summary.name,
      version: summary.version,
      recipeSha256: summary.recipeSha256,
      destination: summary.destination,
      status: 'queued',
      completed: 0,
      total: summary.outputs,
      error: null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const jobs = previous
      ? this.jobs.map((v) => (v.id === previous.id ? job : v))
      : [...this.jobs, job];
    this.save(jobs);
    this.jobs = jobs;
    this.plan = null;
    this.controller = new AbortController();
    this.done = this.run(plan, this.controller);
    return this.list();
  }
  cancel(id) {
    if (this.reviewId === id && this.controller) {
      this.controller.abort();
      return this.list();
    }
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
    const { destination, recipeSha256 } = plan.summary;
    const id = plan.summary.resume?.jobId ?? plan.summary.id;
    try {
      this.change(id, { status: 'building' });
      const inspected = await inspectNativePackage(plan.packageFile);
      if (inspected.recipeSha256 !== recipeSha256)
        throw new Error('Native package changed after review.');
      if (plan.resume) await this.ensureIdle();
      const archives = await acquireArchives(
        inspected.recipe,
        plan.inputs.archives,
        path.join(this.root, 'native-downloads'),
        {
          signal: controller.signal,
          activity: (value) => this.activities.set(id, value),
          nexus: this.options.nexus,
          request: this.options.downloadRequest,
        },
      );
      if (plan.resume) await this.ensureIdle();
      await materializeNative(plan.packageFile, destination, {
        ...plan.inputs,
        archives,
        sevenZip: plan.sevenZip,
        expectedRecipeSha256: recipeSha256,
        signal: controller.signal,
        resume: plan.resume,
        protectedRoots: this.recoveryRoots(id),
        progress: ({ completed }) =>
          this.change(id, { completed }, completed % 100 === 0),
        activity: (value) => this.activities.set(id, value),
      });
      this.change(id, {
        status: 'verified',
        completed: plan.summary.outputs,
      });
    } catch (error) {
      try {
        this.change(id, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted
            ? 'Build cancelled. The partial candidate and recovery copies are retained. Review the same recipe and inputs to resume.'
            : error instanceof DownloadError
              ? error.message
              : 'Build failed. Check the package, input hashes, destination and free space. The partial candidate and recovery copies are retained; review again to resume.',
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
      this.activities.delete(id);
      this.controller = null;
    }
  }
}
module.exports = { NativeBuilder, validateHistory };
