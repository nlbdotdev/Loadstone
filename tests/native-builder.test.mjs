import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { NativeBuilder } = require('../electron/native-builder.cjs');
const { currentActivity } = require('../electron/close-guard.cjs');
const { identity } = require('../electron/native-build-recovery.cjs');

async function fixture(prerequisite = false, mo2Config = false) {
  const f = createNativeFixture({ prerequisite, mo2Config });
  f.game = path.join(f.root, 'owned');
  f.packages = path.join(f.root, 'packages');
  f.parent = path.join(f.root, 'candidates');
  f.state = path.join(f.root, 'state');
  for (const folder of [f.game, f.packages, f.parent]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.packageFile = path.join(f.packages, 'fixture.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  f.inputsFile = path.join(f.packages, 'inputs.json');
  const local = {};
  if (prerequisite) {
    const folder = path.join(f.root, 'prerequisite');
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, 'support.bin'),
      'user-provided prerequisite bytes',
    );
    local.prerequisites = { 'prepared-support': folder };
  }
  fs.writeFileSync(
    f.inputsFile,
    JSON.stringify({ games: { fnv: f.game }, archives: {}, ...local }),
  );
  f.selected = {
    packageFile: f.packageFile,
    inputsFile: f.inputsFile,
    parent: f.parent,
  };
  return f;
}

test(
  'real Electron reviews and resumes a retained candidate without duplicating history or losing user files',
  { timeout: 60000 },
  async () => {
    const f = await fixture(true, true),
      builder = new NativeBuilder(f.state);
    const original = await builder.prepare(async () => f.selected);
    const change = builder.change.bind(builder);
    builder.change = (id, patch, persist) => {
      change(id, patch, persist);
      if (patch.completed === 2 && !patch.status) builder.cancel(id);
    };
    builder.start(original.id);
    await builder.done;
    assert.equal(builder.list()[0].status, 'cancelled');
    const game = path.join(original.destination, 'Game/FalloutNV.exe'),
      gameIdentity = identity(game);
    fs.writeFileSync(
      path.join(original.destination, 'ModOrganizer.ini'),
      'preserve custom configuration',
    );
    fs.mkdirSync(path.join(original.destination, 'profiles/Test/saves'), {
      recursive: true,
    });
    const save = path.join(
      original.destination,
      'profiles/Test/saves/session.fos',
    );
    fs.writeFileSync(save, 'synthetic saved progress');
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const launchOptions = {
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    };
    let instance = await electron.launch(launchOptions);
    try {
      let page = await instance.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await instance.evaluate(
        ({ app, dialog }, files) => {
          let next = 0;
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [files[next++ % files.length]],
          });
          const { NativeBuilder } = process.mainModule.require(
            app.getAppPath() + '/electron/native-builder.cjs',
          );
          NativeBuilder.prototype.ensureIdle = async () => {};
        },
        [f.packageFile, f.inputsFile],
      );
      const resume = page.getByRole('button', {
        name: 'Review resume',
        exact: true,
      });
      await resume.click();
      const review = page.getByRole('region', { name: 'Review native build' });
      await review.waitFor();
      assert.match(
        await review.textContent(),
        /1 matching files can be reused/,
      );
      assert.match(await review.textContent(), /1 changed or incomplete files/);
      assert.match(await review.textContent(), /\.loadstone-build-recovery/);
      await review
        .getByRole('button', { name: 'Dismiss', exact: true })
        .click();
      assert.equal(
        fs.readFileSync(
          path.join(original.destination, 'ModOrganizer.ini'),
          'utf8',
        ),
        'preserve custom configuration',
      );
      await resume.click();
      await review.waitFor();
      fs.mkdirSync('test-results', { recursive: true });
      await review.screenshot({
        path: 'test-results/native-resume-review.png',
      });
      await review
        .getByRole('button', { name: 'Resume candidate', exact: true })
        .click();
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].id, original.id);
      assert.equal(jobs[0].destination, original.destination);
      assert.equal(identity(game), gameIdentity);
      const receipt = JSON.parse(
        fs.readFileSync(
          path.join(original.destination, '.loadstone-native.json'),
        ),
      );
      assert.equal(
        fs.readFileSync(
          path.join(
            original.destination,
            receipt.recoveryDirectory,
            'ModOrganizer.ini',
          ),
          'utf8',
        ),
        'preserve custom configuration',
      );
      assert.equal(fs.readFileSync(save, 'utf8'), 'synthetic saved progress');
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries
          .length,
        0,
      );
      await instance.close();
      instance = await electron.launch(launchOptions);
      page = await instance.firstWindow();
      assert.deepEqual(
        await page.evaluate(() => window.loadstone.nativeBuilds()),
        jobs,
      );
    } finally {
      await instance.close();
    }
  },
);
test('native build review is serialized and binds one start to a recipe; completed history survives restart', async () => {
  const f = await fixture(),
    builder = new NativeBuilder(f.state);
  let release;
  const preparing = builder.prepare(
    () => new Promise((resolve) => (release = resolve)),
  );
  assert.match(currentActivity(null, null, builder).message, /native/);
  await assert.rejects(
    builder.prepare(async () => f.selected),
    /Wait/,
  );
  release(null);
  assert.equal(await preparing, null);
  const plan = await builder.prepare(async () => f.selected);
  assert.equal('inputs' in plan, false);
  assert.equal('packageFile' in plan, false);
  assert.throws(() => builder.start('unreviewed'), /Review/);
  const source = fs.readFileSync(f.packageFile);
  builder.start(plan.id);
  await builder.done;
  assert.equal(builder.list()[0].status, 'verified');
  assert.equal(builder.list()[0].completed, 5);
  assert.equal(builder.busy, false);
  assert.throws(() => builder.start(plan.id), /Review/);
  assert.deepEqual(new NativeBuilder(f.state).list(), builder.list());
  assert.deepEqual(fs.readFileSync(f.packageFile), source);
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
});
test('native cancellation retains partial files and interrupted/corrupt history never silently restarts or resets', async () => {
  const f = await fixture(),
    builder = new NativeBuilder(f.state);
  const plan = await builder.prepare(async () => f.selected);
  const change = builder.change.bind(builder);
  builder.change = (id, patch, persist) => {
    change(id, patch, persist);
    if (patch.completed === 1 && !patch.status) builder.cancel(id);
  };
  builder.start(plan.id);
  await builder.done;
  assert.equal(builder.list()[0].status, 'cancelled');
  assert.equal(
    fs.readFileSync(path.join(plan.destination, 'Game/FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
  const saved = JSON.parse(fs.readFileSync(builder.file, 'utf8'));
  saved.jobs[0].status = 'building';
  fs.writeFileSync(builder.file, JSON.stringify(saved));
  const recovered = new NativeBuilder(f.state);
  assert.equal(recovered.list()[0].status, 'interrupted');
  assert.equal(recovered.busy, false);
  assert.equal(fs.existsSync(plan.destination), true);
  for (const text of [
    'broken json',
    JSON.stringify({ ...saved, schemaVersion: 900 }),
  ]) {
    fs.writeFileSync(builder.file, text);
    assert.throws(() => new NativeBuilder(f.state));
    assert.equal(fs.readFileSync(builder.file, 'utf8'), text);
  }
});
test('native review rejects incomplete inputs and a package changed after review before output creation', async () => {
  const f = await fixture(),
    builder = new NativeBuilder(f.state);
  fs.writeFileSync(f.inputsFile, JSON.stringify({ games: {}, archives: {} }));
  await assert.rejects(
    builder.prepare(async () => f.selected),
    /every required/,
  );
  assert.equal(builder.list().length, 0);
  fs.writeFileSync(
    f.inputsFile,
    JSON.stringify({ games: { fnv: f.game }, archives: {} }),
  );
  const plan = await builder.prepare(async () => f.selected);
  f.recipe.version = 'different-after-review';
  const changed = path.join(f.packages, 'changed.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, changed);
  fs.copyFileSync(changed, f.packageFile);
  builder.start(plan.id);
  await builder.done;
  assert.equal(builder.list()[0].status, 'failed');
  assert.equal(fs.existsSync(plan.destination), false);
});
test('native cancellation still stops work when history persistence fails and blocks another build until restart', async () => {
  const f = await fixture(),
    builder = new NativeBuilder(f.state);
  const plan = await builder.prepare(async () => f.selected);
  builder.start(plan.id);
  builder.save = () => {
    throw new Error('fixture persistence failure');
  };
  assert.throws(() => builder.cancel(plan.id), /persistence failure/);
  await builder.done;
  assert.equal(builder.busy, false);
  assert.equal(builder.list()[0].status, 'failed');
  await assert.rejects(
    builder.prepare(async () => f.selected),
    /Restart/,
  );
  assert.equal(new NativeBuilder(f.state).list()[0].status, 'interrupted');
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
});
test(
  'real Electron reviews and reconstructs a local candidate with durable status and no playable library entry',
  { timeout: 60000 },
  async () => {
    const f = await fixture(true, true);
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const options = {
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    };
    let app = await electron.launch(options);
    try {
      let page = await app.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const choose = page.getByRole('button', {
        name: 'Choose local build inputs',
        exact: true,
      });
      assert.equal(await choose.isDisabled(), true);
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await app.evaluate(
        ({ dialog }, files) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [files.shift()],
          });
        },
        [f.packageFile, f.inputsFile, f.parent],
      );
      await choose.click();
      const review = page.getByRole('region', { name: 'Review native build' });
      await review.waitFor();
      assert.match(await review.textContent(), /Fixture prerequisite 1/);
      assert.match(
        await review.textContent(),
        /MO2 configuration will be generated/,
      );
      // Slow only synthetic executable reads so the real bridge/UI can expose
      // all three long-running file phases, including verification at 100% written.
      await app.evaluate(async (_electron, root) => {
        const fs = process.getBuiltinModule('fs');
        const { Readable } = process.getBuiltinModule('stream');
        const original = fs.createReadStream;
        fs.createReadStream = function (file, options) {
          if (
            typeof file === 'string' &&
            file.startsWith(root) &&
            /[\\/]FalloutNV[.]exe$/.test(file)
          ) {
            const data = fs.readFileSync(file);
            return Readable.from(
              (async function* () {
                yield data.subarray(0, 6);
                await new Promise((resolve) => setTimeout(resolve, 350));
                yield data.subarray(6, 12);
                await new Promise((resolve) => setTimeout(resolve, 1700));
                yield data.subarray(12);
              })(),
            );
          }
          return original.call(this, file, options);
        };
      }, f.root);
      await review
        .getByRole('button', { name: 'Build candidate', exact: true })
        .click();
      for (const phase of [
        'Checking source files',
        'Writing candidate files',
        'Verifying finished files',
      ]) {
        await page.getByText(phase, { exact: true }).waitFor();
        const active = (
          await page.evaluate(() => window.loadstone.nativeBuilds())
        )[0];
        assert.equal(active.status, 'building');
        assert.ok(active.activity);
        assert.equal(
          active.activity.totalBytes,
          Buffer.byteLength('fixture owned game'),
        );
        const history = JSON.parse(
          fs.readFileSync(path.join(f.state, 'native-builds.json')),
        );
        assert.equal(history.jobs[0].activity, undefined);
        if (phase === 'Verifying finished files') {
          assert.equal(active.completed, active.total);
          fs.mkdirSync('test-results', { recursive: true });
          await page
            .getByRole('region', { name: 'Native candidate builds' })
            .screenshot({
              path: 'test-results/native-verification-progress.png',
            });
        }
      }
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, 'verified');
      const config = fs.readFileSync(
        path.join(jobs[0].destination, 'ModOrganizer.ini'),
        'utf8',
      );
      assert.ok(
        config.includes(
          jobs[0].destination.replaceAll('\\', '/') + '/Game/FalloutNV.exe',
        ),
      );
      const receipt = JSON.parse(
        fs.readFileSync(
          path.join(jobs[0].destination, '.loadstone-native.json'),
        ),
      );
      assert.equal(receipt.generatedConfigurations[0].path, 'ModOrganizer.ini');
      assert.equal(
        fs.readFileSync(
          path.join(jobs[0].destination, 'mods/Support/support.bin'),
          'utf8',
        ),
        'user-provided prerequisite bytes',
      );
      assert.equal(
        await page.evaluate(
          async () => (await window.loadstone.liveJobs()).length,
        ),
        0,
      );
      assert.equal(
        fs.readFileSync(
          path.join(jobs[0].destination, 'Game/FalloutNV.exe'),
          'utf8',
        ),
        'fixture owned game',
      );
      fs.mkdirSync('test-results', { recursive: true });
      await page
        .getByRole('region', { name: 'Native candidate builds' })
        .screenshot({ path: 'test-results/native-build-workflow.png' });
      await app.close();
      app = await electron.launch(options);
      page = await app.firstWindow();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() => window.loadstone.nativeBuilds()),
        jobs,
      );
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await page
        .getByRole('button', { name: 'Choose local build inputs', exact: true })
        .click();
      assert.deepEqual(
        await page.evaluate(() => window.loadstone.nativeBuilds()),
        jobs,
      );
    } finally {
      await app.close();
    }
  },
);
