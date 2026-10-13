const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectNativePackage, ordinaryFile } = require('./native-package.cjs');
const { validateInputs } = require('./native-builder.cjs');
const { candidateMetadata, nativeLaunchPlan } = require('./native-library.cjs');
const {
  reviewBuildRecovery,
  assertBuildRecovery,
  identity,
  expectedOutputs,
} = require('./native-build-recovery.cjs');
const { preserve } = require('./native-maintenance.cjs');
const { materializeNative } = require('./native-materializer.cjs');
const { archiveSource, acquireArchives } = require('./native-downloads.cjs');
const { archiveKind } = require('./archive-kind.cjs');
const { createSevenZip } = require('./sevenzip.cjs');
const { assertGamesClosed } = require('./maintenance.cjs');

function demand(value, message) {
  if (!value) throw new Error(message);
}
async function reviewNativeRepair(inspected, root, options = {}) {
  const review = await reviewBuildRecovery(inspected, root, options);
  demand(
    review.identity,
    'Repair requires the registered installation folder.',
  );
  review.preserved = 0;
  review.preservedPaths = [];
  const outputs = new Map(
    expectedOutputs(inspected.recipe, root).outputs.map((v) => [v.path, v]),
  );
  for (const item of review.files) {
    options.signal?.throwIfAborted();
    if (!item.identity || item.reuse || !preserve(item.path)) continue;
    if (
      options.restoreConfiguration &&
      !/^(downloads|overwrite)($|\/)/i.test(item.path)
    )
      continue;
    const file = path.join(root, item.path),
      before = ordinaryFile(file, 50_000_000_000);
    demand(
      identity(file) === item.identity,
      'A personal file changed during repair review.',
    );
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of fs.createReadStream(file, {
      signal: options.signal,
    })) {
      bytes += chunk.length;
      demand(
        bytes <= before.size,
        'A personal file changed during repair review.',
      );
      hash.update(chunk);
    }
    demand(
      bytes === before.size && identity(file) === item.identity,
      'A personal file changed during repair review.',
    );
    item.preserved = { bytes, sha256: hash.digest('hex') };
    item.reuse = true;
    review.preserved++;
    if (review.preservedPaths.length < 20)
      review.preservedPaths.push(item.path);
    review.conflicts--;
    review.writeBytes -= outputs.get(item.path).bytes;
  }
  assertBuildRecovery(review);
  return review;
}

// The guide owns source selection; this adapter owns one registered target.
// No target path, recipe or filesystem operation is accepted from the renderer.
class NativeRepair {
  constructor(library, entryId, options = {}) {
    this.library = library;
    this.entryId = entryId;
    this.options = options;
    this.plan = null;
    this.jobs = [];
    this.restoreConfiguration = false;
  }
  record() {
    const entry = this.library.record(this.entryId);
    demand(
      ['installed', 'repair-failed'].includes(entry.status),
      'Choose an installed setup or interrupted repair.',
    );
    demand(
      !this.library.launcher.sessions.get(entry.id)?.child,
      'Close the launched mod manager before repair.',
    );
    candidateMetadata(entry.root, entry);
    return entry;
  }
  context() {
    const entry = this.record();
    return {
      entryId: entry.id,
      destination: entry.root,
      recipeSha256: entry.recipeSha256,
      restoreConfiguration: this.restoreConfiguration,
    };
  }
  roots() {
    return [
      path.dirname(this.library.file),
      ...(this.options.protectedRoots?.(this.entryId) || []),
    ];
  }
  ensureIdle() {
    return (this.options.idle || assertGamesClosed)();
  }
  begin() {
    this.library.available();
    this.record();
    this.library.busy = true;
    this.library.controller = new AbortController();
  }
  end() {
    this.library.busy = false;
    this.library.controller = null;
    this.library.progress = null;
  }
  async select(operation) {
    this.begin();
    this.plan = null;
    try {
      return await operation(this.library.controller.signal);
    } finally {
      this.end();
    }
  }
  async prepare(choose, chooseTool) {
    this.begin();
    this.plan = null;
    try {
      await this.ensureIdle();
      const entry = this.record(),
        selected = await choose();
      if (!selected) return null;
      const inspected = await inspectNativePackage(selected.packageFile);
      demand(
        inspected.recipeSha256 === entry.recipeSha256 &&
          selected.recipeSha256 === entry.recipeSha256,
        'Repair requires the exact registered recipe. Import that package again.',
      );
      const inputs = validateInputs(
        structuredClone(selected.inputs),
        inspected.recipe,
      );
      let sevenZip;
      if (
        Object.values(inputs.archives).some(
          (v) => v === null || ['7z', 'rar', 'rar5'].includes(archiveKind(v)),
        )
      ) {
        const tool = await chooseTool?.();
        if (!tool) return null;
        sevenZip = await createSevenZip(tool);
      }
      const review = await reviewNativeRepair(inspected, entry.root, {
        protectedRoots: this.roots(),
        restoreConfiguration: this.restoreConfiguration,
        signal: this.library.controller.signal,
        activity: (value) => {
          this.library.progress = {
            phase: 'repair-review',
            completed: value.completed,
            total: value.total,
          };
        },
      });
      this.record();
      this.library.controller.signal.throwIfAborted();
      const downloads = inspected.recipe.sources.filter(
        (v) => archiveSource(v) && inputs.archives[v.id] === null,
      );
      const directory = `.loadstone-repair-recovery/${crypto.randomUUID()}`;
      const summary = {
        id: crypto.randomUUID(),
        name: inspected.recipe.name,
        version: inspected.recipe.version,
        recipeSha256: inspected.recipeSha256,
        destination: entry.root,
        outputs: inspected.summary.outputs,
        installBytes: review.writeBytes,
        generatedConfigurations: inspected.summary.generatedConfigurations,
        requiredGames: inspected.summary.requiredGames,
        prerequisites: inspected.summary.prerequisites,
        archiveCount: Object.values(inputs.archives).filter((v) => v !== null)
          .length,
        downloadCount: downloads.length,
        downloadBytes: downloads.reduce((sum, v) => sum + v.bytes, 0),
        downloadHosts: [
          ...new Set(
            downloads.map((v) =>
              v.type === 'nexus-archive'
                ? 'nexusmods.com'
                : new URL(v.url).hostname,
            ),
          ),
        ],
        downloadCache: downloads.length
          ? path.join(path.dirname(this.library.file), 'native-downloads')
          : null,
        archiveTool: sevenZip ? `7-Zip ${sevenZip.version} x64` : null,
        repair: {
          reused: review.reused,
          missing: review.missing,
          conflicts: review.conflicts,
          preserved: review.preserved,
          preservedPaths: review.preservedPaths,
          retained: review.retained,
          recoveryRoot: path.join(entry.root, directory),
          restoreConfiguration: this.restoreConfiguration,
        },
      };
      this.plan = {
        summary,
        review,
        directory,
        packageFile: selected.packageFile,
        inputs,
        sevenZip,
      };
      return structuredClone(summary);
    } finally {
      this.end();
    }
  }
  start(id) {
    this.begin();
    try {
      demand(
        this.plan?.summary.id === id,
        'Review repair before confirming it.',
      );
      const plan = this.plan;
      assertBuildRecovery(plan.review);
      this.library.change(this.entryId, {
        status: 'repairing',
        maintenanceError: null,
        repair: {
          directory: plan.directory,
          startedAt: new Date().toISOString(),
          completedAt: null,
          preserved: plan.review.preserved,
        },
      });
      this.plan = null;
      this.done = this.run(plan, this.library.controller);
      return [];
    } catch (error) {
      this.end();
      throw error;
    }
  }
  async run(plan, controller) {
    try {
      await this.ensureIdle();
      const inspected = await inspectNativePackage(plan.packageFile);
      demand(
        inspected.recipeSha256 === plan.summary.recipeSha256,
        'The repair package changed after review.',
      );
      assertBuildRecovery(plan.review);
      const archives = await acquireArchives(
        inspected.recipe,
        plan.inputs.archives,
        path.join(path.dirname(this.library.file), 'native-downloads'),
        {
          nexus: this.options.nexus,
          request: this.options.downloadRequest,
          signal: controller.signal,
          activity: (value) => {
            this.library.progress = {
              phase: 'repair-downloads',
              completed: value.completed,
              total: value.total,
            };
          },
        },
      );
      await this.ensureIdle();
      controller.signal.throwIfAborted();
      await materializeNative(plan.packageFile, plan.summary.destination, {
        ...plan.inputs,
        archives,
        sevenZip: plan.sevenZip,
        signal: controller.signal,
        expectedRecipeSha256: plan.summary.recipeSha256,
        resume: plan.review,
        repair: { directory: plan.directory },
        protectedRoots: this.roots(),
        activity: (value) => {
          this.library.progress = {
            phase: 'repair',
            completed: value.completed,
            total: value.total,
          };
        },
      });
      controller.signal.throwIfAborted();
      const entry = this.library.record(this.entryId);
      nativeLaunchPlan({ ...entry, status: 'installed' });
      this.library.change(this.entryId, {
        status: 'installed',
        maintenanceError: null,
        repair: { ...entry.repair, completedAt: new Date().toISOString() },
      });
    } catch {
      try {
        this.library.change(this.entryId, {
          status: 'repair-failed',
          maintenanceError: controller.signal.aborted
            ? 'Repair stopped. Existing files and recovery copies are retained. Review repair again to continue.'
            : 'Repair did not complete. Check original sources, space and the isolated profile. Files and recovery copies are retained; review again to retry.',
        });
      } catch {
        this.library.error =
          'Repair state could not be saved. Restart Loadstone before further work; the durable repair record preserves recovery.';
      }
    } finally {
      this.end();
    }
  }
}
module.exports = { NativeRepair, reviewNativeRepair };
