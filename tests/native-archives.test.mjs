import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { _electron as electron } from 'playwright';
import {
  createArchiveFixture,
  fingerprint,
} from './native-archive-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { createSevenZip } = require('../electron/sevenzip.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const { NativeBuilder } = require('../electron/native-builder.cjs');
const executable = process.env.LOADSTONE_TEST_7ZIP;
const options = { skip: !executable, timeout: 60000 };

test(
  'native builds review downloads, reuse verified archives and reject package changes before network work',
  options,
  async () => {
    const f = await createArchiveFixture('rar5');
    fs.writeFileSync(
      f.inputsFile,
      JSON.stringify({
        games: { fnv: f.game },
        archives: { 'original-archive': null },
      }),
    );
    let requests = 0;
    const builder = new NativeBuilder(f.state, {
      downloadRequest: async () => {
        requests++;
        const stream = Readable.from([fs.readFileSync(f.archive)]);
        stream.statusCode = 200;
        stream.headers = {};
        return stream;
      },
    });
    const choose = async () => ({
      packageFile: f.packageFile,
      inputsFile: f.inputsFile,
      parent: f.parent,
    });
    for (let i = 0; i < 2; i++) {
      const plan = await builder.prepare(choose, async () => executable);
      assert.equal(plan.downloadCount, 1);
      assert.equal(plan.archiveCount, 0);
      assert.deepEqual(plan.downloadHosts, ['example.org']);
      builder.start(plan.id);
      await builder.done;
      assert.equal(builder.list()[i].status, 'verified');
      for (const output of f.recipe.outputs)
        assert.equal(
          fingerprint(fs.readFileSync(path.join(plan.destination, output.path)))
            .sha256,
          output.sha256,
        );
    }
    assert.equal(requests, 1);
    const plan = await builder.prepare(choose, async () => executable);
    f.recipe.version = 'changed-after-review';
    const changed = path.join(f.packages, 'changed.loadstone');
    await packNativeRecipe(f.recipe, f.payloads, changed);
    fs.copyFileSync(changed, f.packageFile);
    builder.start(plan.id);
    await builder.done;
    assert.equal(builder.list().at(-1).status, 'failed');
    assert.equal(fs.existsSync(plan.destination), false);
    assert.equal(requests, 1);
  },
);

test(
  'real Electron acquires a reviewed archive, displays progress and reconstructs exact outputs through the bridge',
  options,
  async () => {
    const f = await createArchiveFixture('rar5', { timestamps: true });
    fs.writeFileSync(
      f.inputsFile,
      JSON.stringify({
        games: { fnv: f.game },
        archives: { 'original-archive': null },
      }),
    );
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await app.evaluate(
        ({ dialog }, fixture) => {
          const fs = process.getBuiltinModule('fs');
          const https = process.getBuiltinModule('https');
          const { Readable } = process.getBuiltinModule('stream');
          const { EventEmitter } = process.getBuiltinModule('events');
          const files = [
            fixture.packageFile,
            fixture.inputsFile,
            fixture.parent,
            fixture.executable,
          ];
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [files.shift()],
          });
          https.get = (url, options, callback) => {
            if (
              url.href !== 'https://example.org/original' ||
              options.headers.apikey
            )
              throw new Error('Unexpected fixture network request');
            const bytes = fs.readFileSync(fixture.archive);
            const stream = Readable.from(
              (async function* () {
                yield bytes.subarray(0, 64000);
                await new Promise((resolve) => setTimeout(resolve, 1700));
                yield bytes.subarray(64000, 128000);
                await new Promise((resolve) => setTimeout(resolve, 1700));
                yield bytes.subarray(128000);
              })(),
            );
            stream.statusCode = 200;
            stream.headers = {};
            const request = new EventEmitter();
            request.setTimeout = () => {};
            request.destroy = (error) => {
              stream.destroy(error);
              request.emit('error', error);
            };
            options.signal.addEventListener(
              'abort',
              () => request.destroy(new Error('cancelled')),
              { once: true },
            );
            queueMicrotask(() => callback(stream));
            return request;
          };
        },
        { ...f, executable },
      );
      await page
        .getByRole('button', { name: 'Choose local build inputs', exact: true })
        .click();
      const review = page.getByRole('region', { name: 'Review native build' });
      await review.waitFor();
      assert.match(await review.textContent(), /1\s+archive to acquire/);
      assert.match(await review.textContent(), /example.org/);
      await review
        .getByRole('button', { name: 'Build candidate', exact: true })
        .click();
      await page
        .getByText('Acquiring archive files', { exact: true })
        .waitFor();
      fs.mkdirSync('test-results', { recursive: true });
      await page
        .getByRole('region', { name: 'Native candidate builds' })
        .screenshot({ path: 'test-results/native-download-progress.png' });
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
      assert.equal(jobs[0].status, 'verified');
      for (const output of f.recipe.outputs)
        assert.equal(
          Math.round(
            fs.statSync(path.join(jobs[0].destination, output.path)).mtimeMs,
          ),
          output.mtimeMs,
        );
      for (const output of f.recipe.outputs)
        assert.equal(
          fingerprint(
            fs.readFileSync(path.join(jobs[0].destination, output.path)),
          ).sha256,
          output.sha256,
        );
      const history = fs.readFileSync(
        path.join(f.state, 'native-builds.json'),
        'utf8',
      );
      assert.equal(history.includes('example.org'), false);
      assert.equal(history.includes('native-downloads'), false);
      assert.equal(
        await page.evaluate(
          async () => (await window.loadstone.liveJobs()).length,
        ),
        0,
      );
    } finally {
      await app.close();
    }
  },
);

test(
  'native CLI reconstructs a RAR candidate using an explicit operator-selected archive tool',
  options,
  async () => {
    const f = await createArchiveFixture('rar5');
    const output = execFileSync(
      process.execPath,
      [
        'scripts/materialize-native.mjs',
        f.packageFile,
        f.inputsFile,
        f.destination,
        '--sevenzip',
        executable,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.match(output, /"status": "verified"/);
    assert.equal(
      fs.readFileSync(
        path.join(f.destination, 'mods/Example/Data/@literal.txt'),
        'utf8',
      ),
      'literal member selector',
    );
  },
);

for (const kind of ['7z', 'rar5'])
  test(
    `native ${kind} reconstruction verifies literal, empty, Unicode and repeated members without changing inputs`,
    options,
    async () => {
      const f = await createArchiveFixture(kind, { timestamps: true }),
        sevenZip = await createSevenZip(executable);
      const before = fs.readFileSync(f.archive);
      const archiveMtime = fs.statSync(f.archive).mtimeMs;
      const result = await materializeNative(f.packageFile, f.destination, {
        ...f.options,
        sevenZip,
      });
      assert.equal(result.status, 'verified');
      assert.equal(result.completedFiles, f.recipe.outputs.length);
      assert.equal(result.launchVerified, false);
      for (const output of f.recipe.outputs)
        assert.equal(
          Math.round(
            fs.statSync(path.join(f.destination, output.path)).mtimeMs,
          ),
          output.mtimeMs,
        );
      assert.equal(fs.statSync(f.archive).mtimeMs, archiveMtime);
      for (const output of f.recipe.outputs)
        assert.deepEqual(
          fingerprint(fs.readFileSync(path.join(f.destination, output.path))),
          { bytes: output.bytes, sha256: output.sha256 },
        );
      assert.equal(
        fs.existsSync(path.join(f.destination, 'Data/unused.bin')),
        false,
      );
      assert.deepEqual(fs.readFileSync(f.archive), before);
      assert.equal(
        fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
        'fixture owned game',
      );
    },
  );

test(
  'archive consumers are awaited, their failures stop the child, and cancellation leaves no ongoing writes',
  options,
  async () => {
    const f = await createArchiveFixture(),
      adapter = await createSevenZip(executable);
    const candidate = {
      archive: f.archive,
      ...fingerprint(fs.readFileSync(f.archive)),
    };
    const inspected = await adapter.inspect(candidate);
    const names = new Set(f.files.keys());
    let pending = 0,
      calls = 0;
    const received = new Map();
    await adapter.extractMembers(candidate, inspected, names, {
      async consume(entry, chunk) {
        assert.equal(pending++, 0);
        await delay(1);
        received.set(
          entry.name,
          (received.get(entry.name) || 0) + chunk.length,
        );
        pending--;
      },
      finish(entry) {
        assert.equal(
          received.get(entry.name) || 0,
          f.files.get(entry.name).length,
        );
      },
    });
    assert.equal(pending, 0);
    await assert.rejects(
      adapter.extractMembers(candidate, inspected, names, {
        async consume() {
          calls++;
          await delay(5);
          throw new Error('fixture async write failure');
        },
        finish() {},
      }),
      /async write failure/,
    );
    const afterFailure = calls;
    await delay(20);
    assert.equal(calls, afterFailure);
    const controller = new AbortController();
    await assert.rejects(
      adapter.extractMembers(
        candidate,
        inspected,
        names,
        {
          async consume() {
            calls++;
            controller.abort();
            await delay(5);
          },
          finish() {},
        },
        controller.signal,
      ),
      { name: 'AbortError' },
    );
    const afterAbort = calls;
    await delay(20);
    assert.equal(calls, afterAbort);
  },
);

test(
  'native 7z/RAR preflight rejects missing tool, encrypted and unsafe archives, missing members and changed sources before writing',
  options,
  async () => {
    const f = await createArchiveFixture(),
      sevenZip = await createSevenZip(executable);
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, f.options),
      /trusted 7-Zip/,
    );
    assert.equal(fs.existsSync(f.destination), false);
    for (const bad of [
      await createArchiveFixture('7z', { encrypted: true }),
      await createArchiveFixture('rar5', {
        extraFiles: [['../escape.bin', Buffer.from('unsafe')]],
      }),
    ]) {
      await assert.rejects(
        materializeNative(bad.packageFile, bad.destination, {
          ...bad.options,
          sevenZip,
        }),
        /Unsafe|unsafe|encrypted/,
      );
      assert.equal(fs.existsSync(bad.destination), false);
    }
    f.recipe.outputs.find((v) => v.action.type === 'extract').action.member =
      'Data/missing.txt';
    const changedPackage = path.join(f.packages, 'missing.loadstone');
    await packNativeRecipe(f.recipe, f.payloads, changedPackage);
    await assert.rejects(
      materializeNative(changedPackage, f.destination, {
        ...f.options,
        sevenZip,
      }),
      /missing/,
    );
    assert.equal(fs.existsSync(f.destination), false);
    fs.appendFileSync(f.archive, 'changed');
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, {
        ...f.options,
        sevenZip,
      }),
      /fingerprint/,
    );
    assert.equal(fs.existsSync(f.destination), false);
  },
);

test(
  'native archive cancellation and failed disk writes close outputs and retain a failed or cancelled receipt',
  options,
  async () => {
    for (const mode of ['cancel', 'write-failure', 'wrong-hash']) {
      const f = await createArchiveFixture(),
        adapter = await createSevenZip(executable);
      const controller = new AbortController();
      let wrote = false;
      const originalOpen = fs.promises.open;
      if (mode === 'wrong-hash') {
        f.recipe.outputs.find(
          (v) => v.action.member === 'Data/A[1].esp',
        ).sha256 = '0'.repeat(64);
        const changed = path.join(f.packages, 'wrong-hash.loadstone');
        await packNativeRecipe(f.recipe, f.payloads, changed);
        f.packageFile = changed;
      }
      fs.promises.open = async function (file, ...args) {
        const handle = await originalOpen.call(this, file, ...args);
        if (
          String(file).startsWith(f.destination + path.sep) &&
          String(file).endsWith('A[1].esp')
        ) {
          const write = handle.write.bind(handle);
          handle.write = async (...writeArgs) => {
            if (mode === 'write-failure') throw new Error('fixture disk full');
            const result = await write(...writeArgs);
            wrote = true;
            if (mode === 'cancel') controller.abort();
            return result;
          };
        }
        return handle;
      };
      try {
        await assert.rejects(
          materializeNative(f.packageFile, f.destination, {
            ...f.options,
            sevenZip: adapter,
            signal: controller.signal,
          }),
          mode === 'cancel'
            ? { name: 'AbortError' }
            : mode === 'write-failure'
              ? /disk full/
              : /does not match/,
        );
      } finally {
        fs.promises.open = originalOpen;
      }
      assert.equal(wrote, mode !== 'write-failure');
      const receipt = JSON.parse(
        fs.readFileSync(
          path.join(f.destination, '.loadstone-native.json'),
          'utf8',
        ),
      );
      assert.equal(receipt.status, mode === 'cancel' ? 'cancelled' : 'failed');
      const partial = path.join(f.destination, 'mods/Example/Data/A[1].esp');
      const before = fs.statSync(partial).size;
      await delay(20);
      assert.equal(fs.statSync(partial).size, before);
      fs.renameSync(partial, partial + '.closed');
    }
  },
);

test(
  'real Electron selects a local archive tool and reconstructs both 7z and RAR candidates through the bridge',
  options,
  async () => {
    const first = await createArchiveFixture(),
      second = await createArchiveFixture('rar5');
    const env = { ...process.env, LOADSTONE_DATA_DIR: first.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      for (const [index, f] of [first, second].entries()) {
        await app.evaluate(
          ({ dialog }, files) => {
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [files.shift()],
            });
          },
          [f.packageFile, f.inputsFile, f.parent, executable],
        );
        await page
          .getByRole('button', {
            name: 'Choose local build inputs',
            exact: true,
          })
          .click();
        const review = page.getByRole('region', {
          name: 'Review native build',
        });
        await review.waitFor();
        assert.match(
          await review.textContent(),
          /Archive tool: 7-Zip 26\.04 x64/,
        );
        await review
          .getByRole('button', { name: 'Build candidate', exact: true })
          .click();
        await page
          .getByText('Files verified · Launch untested', { exact: true })
          .nth(index)
          .waitFor();
        const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
        assert.equal(jobs[index].status, 'verified');
        for (const output of f.recipe.outputs)
          assert.equal(
            fingerprint(
              fs.readFileSync(path.join(jobs[index].destination, output.path)),
            ).sha256,
            output.sha256,
          );
        assert.equal(
          await page.evaluate(
            async () => (await window.loadstone.liveJobs()).length,
          ),
          0,
        );
      }
      fs.mkdirSync('test-results', { recursive: true });
      await page
        .getByRole('region', { name: 'Native candidate builds' })
        .screenshot({ path: 'test-results/native-archive-build-workflow.png' });
    } finally {
      await app.close();
    }
  },
);

test(
  'native review keeps executable selection outside imported inputs, supports picker cancellation and locks the selected tool',
  options,
  async () => {
    const f = await createArchiveFixture(),
      builder = new NativeBuilder(f.state);
    fs.writeFileSync(
      f.inputsFile,
      JSON.stringify({ ...f.options, sevenZip: executable }),
    );
    await assert.rejects(
      builder.prepare(
        async () => f.selected,
        async () => {
          throw new Error('should not select');
        },
      ),
      /local-inputs/,
    );
    fs.writeFileSync(f.inputsFile, JSON.stringify(f.options));
    assert.equal(
      await builder.prepare(
        async () => f.selected,
        async () => null,
      ),
      null,
    );
    assert.equal(builder.list().length, 0);
    const toolFolder = path.join(f.root, 'tool');
    fs.mkdirSync(toolFolder);
    for (const name of ['7z.exe', '7z.dll'])
      fs.copyFileSync(
        path.join(path.dirname(executable), name),
        path.join(toolFolder, name),
      );
    const tool = path.join(toolFolder, '7z.exe');
    const plan = await builder.prepare(
      async () => f.selected,
      async () => tool,
    );
    assert.match(plan.archiveTool, /^7-Zip 26\.04 x64$/);
    assert.equal('sevenZip' in plan, false);
    assert.equal(JSON.stringify(plan).includes(toolFolder), false);
    fs.appendFileSync(path.join(toolFolder, '7z.dll'), 'changed');
    builder.start(plan.id);
    await builder.done;
    assert.equal(builder.list()[0].status, 'failed');
    assert.equal(fs.existsSync(plan.destination), false);
  },
);
