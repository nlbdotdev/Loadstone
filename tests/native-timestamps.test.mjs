import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { libraryFixture } from './native-library-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const {
  validateRecipe,
  canonicalJson,
} = require('../electron/native-format.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const {
  reviewBuildRecovery,
} = require('../electron/native-build-recovery.cjs');
const { NativeLibrary } = require('../electron/native-library.cjs');
const { NativeRepair } = require('../electron/native-repair.cjs');
const { NativeMaintenance } = require('../electron/native-maintenance.cjs');
const plugin = 'mods/Test/Test.esp',
  timestamp = 946684800123;
const mtime = (file) => Math.round(fs.statSync(file).mtimeMs);
const retime = (file, value) =>
  fs.utimesSync(file, new Date(value), new Date(value));
const fixture = () =>
  libraryFixture({
    extraFiles: [[plugin, 'synthetic plugin']],
    mtimes: { [plugin]: timestamp },
  });

test('optional timestamps round trip, change recipe identity and reject unsupported metadata without changing legacy recipes', async () => {
  const f = createNativeFixture({ mo2Config: true }),
    legacy = canonicalJson(f.recipe);
  assert.equal(canonicalJson(validateRecipe(f.recipe)), legacy);
  for (const value of [
    undefined,
    null,
    '946684800000',
    -1,
    1.5,
    Infinity,
    4102444800001,
  ]) {
    const recipe = structuredClone(f.recipe);
    recipe.outputs[0].mtimeMs = value;
    assert.throws(() => validateRecipe(recipe), /mtimeMs/);
  }
  for (const value of [0, timestamp, 4102444800000]) {
    const recipe = structuredClone(f.recipe);
    recipe.outputs[0].mtimeMs = value;
    const file = path.join(f.root, `timestamp-${value}.loadstone`);
    await packNativeRecipe(recipe, f.payloads, file);
    assert.equal(
      (await inspectNativePackage(file)).recipe.outputs[0].mtimeMs,
      value,
    );
    assert.notEqual(canonicalJson(recipe), legacy);
  }
  const generated = structuredClone(f.recipe);
  generated.outputs.find((v) => v.action.type === 'mo2-config').mtimeMs =
    timestamp;
  assert.throws(() => validateRecipe(generated), /unsupported/i);
  const source = structuredClone(f.recipe);
  source.sources[0].mtimeMs = timestamp;
  assert.throws(() => validateRecipe(source), /unknown/i);
  assert.equal(canonicalJson(f.recipe), legacy);
});

test('timestamp-only drift fails library verification and recovery retains the prior file before reconstructing it', async () => {
  const f = await fixture(),
    file = path.join(f.destination, plugin);
  const library = new NativeLibrary(f.state),
    id = (await library.prepare(async () => f.destination)).id;
  library.register(id);
  const verifiedAt = library.record(id).verifiedAt;
  const bytes = fs.readFileSync(file),
    changed = timestamp + 86400000;
  retime(file, changed);
  await assert.rejects(
    library.verify(id),
    /Recipe file modification time differs: mods\/Test\/Test.esp/,
  );
  assert.equal(library.record(id).verifiedAt, verifiedAt);
  const inspected = await inspectNativePackage(f.packageFile);
  const review = await reviewBuildRecovery(inspected, f.destination);
  assert.equal(review.conflicts, 1);
  assert.equal(review.reused, f.recipe.outputs.length - 1);
  const receipt = await materializeNative(f.packageFile, f.destination, {
    games: { fnv: f.owned },
    archives: {},
    resume: review,
  });
  assert.equal(receipt.status, 'verified');
  const retained = path.join(f.destination, receipt.recoveryDirectory, plugin);
  assert.equal(mtime(retained), changed);
  assert.deepEqual(fs.readFileSync(retained), bytes);
  assert.equal(mtime(file), timestamp);
  assert.deepEqual(fs.readFileSync(file), bytes);
  await library.verify(id);
});

test('installed repair restores declared timestamps and retains metadata-only user changes', async () => {
  const f = await fixture(),
    file = path.join(f.destination, plugin);
  const library = new NativeLibrary(f.state),
    id = (await library.prepare(async () => f.destination)).id;
  library.register(id);
  const changed = timestamp + 172800000;
  retime(file, changed);
  const repair = new NativeRepair(library, id, { idle: async () => {} });
  const plan = await repair.prepare(async () => ({
    packageFile: f.packageFile,
    recipeSha256: library.record(id).recipeSha256,
    inputs: { games: { fnv: f.owned }, archives: {} },
  }));
  assert.equal(plan.repair.conflicts, 1);
  repair.start(plan.id);
  await repair.done;
  assert.equal(
    library.record(id).status,
    'installed',
    library.record(id).maintenanceError,
  );
  assert.equal(mtime(file), timestamp);
  assert.equal(mtime(path.join(plan.repair.recoveryRoot, plugin)), changed);
  await library.verify(id);
});

test('removal preserves timestamp changes made before or after review', async () => {
  for (const afterReview of [false, true]) {
    const f = await fixture(),
      file = path.join(f.destination, plugin);
    const library = new NativeLibrary(f.state),
      id = (await library.prepare(async () => f.destination)).id;
    library.register(id);
    const service = new NativeMaintenance(library, { idle: async () => {} });
    if (!afterReview) retime(file, timestamp + 10000);
    const plan = await service.preview(id);
    assert.equal(plan.files, afterReview ? 4 : 3);
    if (afterReview) retime(file, timestamp + 10000);
    await service.remove(plan.id);
    const retained = path.join(plan.recovery, plugin);
    assert.equal(fs.readFileSync(retained, 'utf8'), 'synthetic plugin');
    assert.equal(mtime(retained), timestamp + 10000);
  }
});
