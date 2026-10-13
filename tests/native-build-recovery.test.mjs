import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
import { createArchiveFixture } from './native-archive-fixture.mjs';
const require = createRequire(import.meta.url);
const { materializeNative } = require('../electron/native-materializer.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
const {
  reviewBuildRecovery,
  identity,
  expectedOutputs,
} = require('../electron/native-build-recovery.cjs');
const { NativeBuilder } = require('../electron/native-builder.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');

async function fixture() {
  const f = createNativeFixture({ mo2Config: true });
  f.game = path.join(f.root, 'owned');
  f.packages = path.join(f.root, 'packages');
  for (const dir of [f.game, f.packages]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.package = path.join(f.packages, 'fixture.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.package);
  f.destination = path.join(f.root, 'candidate');
  f.options = { games: { fnv: f.game }, archives: {} };
  f.inspected = await inspectNativePackage(f.package);
  return f;
}
async function partial(f) {
  const controller = new AbortController();
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      signal: controller.signal,
      progress: ({ completed }) => {
        if (completed === 2) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
}
function snapshot(root) {
  const result = {};
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, name);
    if (fs.lstatSync(file).isFile())
      result[name] = fs.readFileSync(file).toString('hex');
  }
  return result;
}
test('recovery reuses matching files, preserves conflicts and user data, and verifies the entire resumed candidate', async () => {
  const f = await fixture();
  await partial(f);
  const game = path.join(f.destination, 'Game/FalloutNV.exe'),
    before = identity(game);
  const config = path.join(f.destination, 'ModOrganizer.ini');
  fs.writeFileSync(config, 'user configuration retained');
  fs.writeFileSync(path.join(f.destination, 'ModOrganizer.exe'), 'partial');
  fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(f.destination, 'profiles/Test/saves/user.fos'),
    'saved progress',
  );
  fs.writeFileSync(path.join(f.destination, 'custom.bin'), 'untracked bytes');
  const events = [],
    review = await reviewBuildRecovery(f.inspected, f.destination, {
      activity: (v) => events.push(v),
    });
  assert.equal(review.reused, 1);
  assert.equal(review.conflicts, 2);
  assert.equal(review.missing, 3);
  assert.equal(events.at(-1).completed, 6);
  assert.equal(JSON.stringify(events).includes(f.root), false);
  const receipt = await materializeNative(f.package, f.destination, {
    ...f.options,
    resume: review,
  });
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.completedFiles, 6);
  assert.equal(identity(game), before);
  const retained = path.join(f.destination, receipt.recoveryDirectory);
  assert.equal(
    fs.readFileSync(path.join(retained, 'ModOrganizer.ini'), 'utf8'),
    'user configuration retained',
  );
  assert.equal(
    fs.readFileSync(path.join(retained, 'ModOrganizer.exe'), 'utf8'),
    'partial',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(retained, '.loadstone-native.json')))
      .status,
    'cancelled',
  );
  assert.equal(
    fs.readFileSync(
      path.join(f.destination, 'profiles/Test/saves/user.fos'),
      'utf8',
    ),
    'saved progress',
  );
  assert.equal(
    fs.readFileSync(path.join(f.destination, 'custom.bin'), 'utf8'),
    'untracked bytes',
  );
  for (const output of expectedOutputs(f.recipe, f.destination).outputs) {
    const data = fs.readFileSync(path.join(f.destination, output.path));
    assert.equal(data.length, output.bytes);
    assert.equal(
      require('node:crypto').createHash('sha256').update(data).digest('hex'),
      output.sha256,
    );
  }
});

test('recovery rejects changed reviewed files, metadata, roots and redirected trees without changing candidate data', async () => {
  for (const mutation of ['file', 'metadata', 'root', 'junction']) {
    const f = await fixture();
    await partial(f);
    const review = await reviewBuildRecovery(f.inspected, f.destination);
    if (mutation === 'file')
      fs.writeFileSync(
        path.join(f.destination, 'Game/FalloutNV.exe'),
        'edited after review',
      );
    if (mutation === 'metadata')
      fs.appendFileSync(
        path.join(f.destination, '.loadstone-native.json'),
        ' ',
      );
    if (mutation === 'root') {
      const moved = path.join(f.root, 'retained-candidate');
      assert.equal(path.dirname(f.destination), f.root);
      assert.equal(path.dirname(moved), f.root);
      fs.renameSync(f.destination, moved);
      fs.mkdirSync(f.destination);
    }
    if (mutation === 'junction') {
      fs.symlinkSync(
        f.game,
        path.join(f.destination, 'outside-link'),
        'junction',
      );
      await assert.rejects(
        reviewBuildRecovery(f.inspected, f.destination),
        /redirected/,
      );
      // Remove only this fixture junction, not its target directory.
      fs.unlinkSync(path.join(f.destination, 'outside-link'));
      fs.writeFileSync(
        path.join(f.destination, 'Game/FalloutNV.exe'),
        'changed',
      );
    }
    const before = snapshot(f.destination);
    await assert.rejects(
      materializeNative(f.package, f.destination, {
        ...f.options,
        resume: review,
      }),
      /review|replaced|recovery/i,
    );
    assert.deepEqual(snapshot(f.destination), before);
    assert.equal(
      fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
      'fixture owned game',
    );
  }
});

test('cancelled recovery retains backups and can resume again; failed inputs do not mutate the candidate', async () => {
  const f = await fixture();
  await partial(f);
  fs.writeFileSync(path.join(f.destination, 'ModOrganizer.ini'), 'keep config');
  const review = await reviewBuildRecovery(f.inspected, f.destination),
    before = snapshot(f.destination);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'incorrect source');
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      resume: review,
    }),
  );
  assert.deepEqual(snapshot(f.destination), before);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  const controller = new AbortController();
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      resume: review,
      signal: controller.signal,
      progress: ({ completed }) => {
        if (completed === 2) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  const stopped = JSON.parse(
    fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
  );
  const copy = path.join(
    f.destination,
    stopped.recoveryDirectory,
    'ModOrganizer.ini',
  );
  assert.equal(fs.readFileSync(copy, 'utf8'), 'keep config');
  const next = await reviewBuildRecovery(f.inspected, f.destination);
  assert.equal(next.reused, 2);
  await materializeNative(f.package, f.destination, {
    ...f.options,
    resume: next,
  });
  assert.equal(fs.readFileSync(copy, 'utf8'), 'keep config');
});

test('builder resumes one interrupted history record and refuses wrong recipes, external state changes and protected roots', async () => {
  const f = await fixture(),
    state = path.join(f.root, 'state');
  const inputsFile = path.join(f.packages, 'inputs.json');
  fs.writeFileSync(inputsFile, JSON.stringify(f.options));
  const choose = async () => ({
    packageFile: f.package,
    inputsFile,
    parent: f.root,
  });
  const first = new NativeBuilder(state, { idle: async () => {} });
  const plan = await first.prepare(choose);
  first.start(plan.id);
  first.cancel(plan.id);
  await first.done;
  const second = new NativeBuilder(state, { idle: async () => {} });
  const resumed = await second.prepare(choose, null, plan.id);
  assert.equal(resumed.destination, plan.destination);
  assert.notEqual(resumed.id, plan.id);
  assert.equal(resumed.resume.jobId, plan.id);
  second.start(resumed.id);
  await second.done;
  assert.equal(second.list().length, 1);
  assert.equal(second.list()[0].status, 'verified');
  await assert.rejects(
    second.prepare(choose, null, plan.id),
    /failed, cancelled/,
  );
  assert.deepEqual(new NativeBuilder(state).list(), second.list());
  const third = new NativeBuilder(path.join(f.root, 'state-two'), {
    idle: async () => {},
  });
  const initial = await third.prepare(choose);
  third.start(initial.id);
  third.cancel(initial.id);
  await third.done;
  f.recipe.version = 'not-the-reviewed-version';
  const changed = path.join(f.packages, 'changed.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, changed);
  await assert.rejects(
    third.prepare(
      async () => ({ packageFile: changed, inputsFile }),
      null,
      initial.id,
    ),
    /exact recipe/,
  );
  third.options.protectedRoots = () => [initial.destination];
  await assert.rejects(third.prepare(choose, null, initial.id), /protected/);
  third.options.protectedRoots = () => [];
  const retry = await third.prepare(choose, null, initial.id);
  const external = fs.readFileSync(third.file, 'utf8') + ' ';
  fs.writeFileSync(third.file, external);
  assert.throws(() => third.start(retry.id), /history could not be saved/);
  assert.equal(fs.readFileSync(third.file, 'utf8'), external);
  assert.equal(fs.existsSync(initial.destination), false);
});

test('recovery can cancel its read-only scan and refuses a destination created after an absent-folder review', async () => {
  const f = await fixture();
  const absent = await reviewBuildRecovery(f.inspected, f.destination);
  fs.mkdirSync(f.destination);
  fs.writeFileSync(path.join(f.destination, 'user.bin'), 'retained');
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      resume: absent,
    }),
    /ordinary destination|appeared/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.destination, 'user.bin'), 'utf8'),
    'retained',
  );
  const g = await fixture();
  await partial(g);
  const before = snapshot(g.destination),
    controller = new AbortController();
  await assert.rejects(
    reviewBuildRecovery(g.inspected, g.destination, {
      signal: controller.signal,
      activity: (v) => {
        if (v.bytes) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(snapshot(g.destination), before);
});

test(
  'resumed 7z and RAR extraction reuses matching members and preserves a conflicting output',
  { skip: !process.env.LOADSTONE_TEST_7ZIP, timeout: 60000 },
  async () => {
    const tool = await createSevenZip(process.env.LOADSTONE_TEST_7ZIP);
    for (const kind of ['7z', 'rar5']) {
      const f = await createArchiveFixture(kind);
      const inputs = {
        games: { fnv: f.game },
        archives: { 'original-archive': f.archive },
        sevenZip: tool,
      };
      const target = path.join(f.parent, 'resume');
      await materializeNative(f.packageFile, target, inputs);
      const outputs = f.recipe.outputs.filter(
        (v) => v.action.type === 'extract',
      );
      assert.ok(outputs.length >= 2);
      const retained = path.join(target, outputs[0].path),
        before = identity(retained);
      fs.writeFileSync(
        path.join(target, outputs[1].path),
        'keep this modification',
      );
      const review = await reviewBuildRecovery(
        await inspectNativePackage(f.packageFile),
        target,
      );
      const receipt = await materializeNative(f.packageFile, target, {
        ...inputs,
        resume: review,
      });
      assert.equal(identity(retained), before);
      assert.equal(
        fs.readFileSync(
          path.join(target, receipt.recoveryDirectory, outputs[1].path),
          'utf8',
        ),
        'keep this modification',
      );
      assert.equal(receipt.status, 'verified');
    }
  },
);

test('a write failure after retaining a conflict preserves that copy for the next resume', async () => {
  const f = await fixture();
  await partial(f);
  const config = path.join(f.destination, 'ModOrganizer.ini');
  fs.writeFileSync(config, 'must survive write failure');
  const review = await reviewBuildRecovery(f.inspected, f.destination);
  const original = fs.createWriteStream;
  fs.createWriteStream = (file, options) => {
    if (file === config) throw new Error('fixture output failure');
    return original(file, options);
  };
  try {
    await assert.rejects(
      materializeNative(f.package, f.destination, {
        ...f.options,
        resume: review,
      }),
      /fixture output failure/,
    );
  } finally {
    fs.createWriteStream = original;
  }
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
  );
  const retained = path.join(
    f.destination,
    receipt.recoveryDirectory,
    'ModOrganizer.ini',
  );
  assert.equal(fs.readFileSync(retained, 'utf8'), 'must survive write failure');
  assert.equal(fs.existsSync(config), false);
  await materializeNative(f.package, f.destination, {
    ...f.options,
    resume: await reviewBuildRecovery(f.inspected, f.destination),
  });
  assert.equal(fs.readFileSync(retained, 'utf8'), 'must survive write failure');
});

test('cancelling an all-matching recovery stops verification and retains every existing output', async () => {
  const f = await fixture();
  await materializeNative(f.package, f.destination, f.options);
  const before = f.recipe.outputs.map((v) =>
    identity(path.join(f.destination, v.path)),
  );
  const review = await reviewBuildRecovery(f.inspected, f.destination),
    controller = new AbortController();
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      resume: review,
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(
    f.recipe.outputs.map((v) => identity(path.join(f.destination, v.path))),
    before,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
    ).status,
    'cancelled',
  );
});
