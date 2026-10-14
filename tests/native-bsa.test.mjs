import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createNativeBsaFixture } from './native-bsa-fixture.mjs';
import { fingerprint } from './native-archive-fixture.mjs';
const require = createRequire(import.meta.url);
const { materializeNative } = require('../electron/native-materializer.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
const { validateRecipe } = require('../electron/native-format.cjs');
const {
  reviewBuildRecovery,
} = require('../electron/native-build-recovery.cjs');
const { reviewNativeRepair } = require('../electron/native-repair.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');
function isolate(t, f) {
  t.mock.method(os, 'tmpdir', () => f.staging);
}
function verify(f) {
  for (const output of f.recipe.outputs) {
    const file = path.join(f.destination, output.path);
    assert.deepEqual(fingerprint(fs.readFileSync(file)), {
      bytes: output.bytes,
      sha256: output.sha256,
    });
    assert.equal(Math.round(fs.statSync(file).mtimeMs), output.mtimeMs);
  }
  assert.deepEqual(fs.readdirSync(f.staging), []);
  assert.equal(
    fs.existsSync(path.join(f.destination, 'Data/Archive A.bsa')),
    false,
  );
}
for (const kind of ['zip-windows', '7z', 'rar5'])
  test(
    `native ${kind} to BSA104 reconstruction verifies exact outputs and timestamps and cleans staging`,
    { skip: kind !== 'zip-windows' && !process.env.LOADSTONE_TEST_7ZIP },
    async (t) => {
      const f = await createNativeBsaFixture(kind);
      isolate(t, f);
      const before = fs.readFileSync(f.archive),
        stat = fs.statSync(f.archive);
      const sevenZip =
        kind === 'zip-windows'
          ? undefined
          : await createSevenZip(process.env.LOADSTONE_TEST_7ZIP);
      const result = await materializeNative(f.packageFile, f.destination, {
        ...f.options,
        sevenZip,
      });
      assert.equal(result.status, 'verified');
      verify(f);
      assert.deepEqual(fs.readFileSync(f.archive), before);
      assert.equal(fs.statSync(f.archive).mtimeMs, stat.mtimeMs);
    },
  );

test('BSA recipes reject implicit containers, unsafe names, unsupported sources, conflicts and staging budgets', async () => {
  const f = await createNativeBsaFixture();
  for (const mutate of [
    (v) => delete v.outputs.at(-1).action.container,
    (v) => (v.outputs.at(-1).action.container.member = '../outside.bsa'),
    (v) => (v.outputs.at(-1).action.member = 'Meshes\\first.nif'),
    (v) => (v.outputs.at(-1).action.source = 'owned-game'),
    (v) => (v.outputs.at(-1).action.type = 'extract-bsa105'),
    (v) => v.outputs.at(-1).action.container.bytes++,
    (v) => (v.outputs.at(-1).action.container.sha256 = '0'.repeat(64)),
    (v) => (v.outputs.at(-1).action.container.member = 'data/archive a.bsa'),
    (v) => (v.outputs.at(-1).bytes = 1_000_000_001),
    (v) => {
      for (const output of v.outputs.filter(
        (o) => o.action.type === 'extract-bsa104',
      ))
        output.action.container.bytes = 0x100000000;
    },
    (v) => {
      for (let i = 0; i < 65; i++)
        v.outputs.push({
          ...structuredClone(v.outputs.at(-1)),
          path: `mods/extra${i}.bin`,
          action: {
            ...structuredClone(v.outputs.at(-1).action),
            container: {
              member: `${i}.bsa`,
              bytes: 36,
              sha256: '1'.repeat(64),
            },
          },
        });
    },
    (v) => {
      for (let i = 0; i < 6; i++)
        v.outputs.push({
          ...structuredClone(v.outputs.at(-1)),
          path: `mods/extra${i}.bin`,
          action: {
            ...structuredClone(v.outputs.at(-1).action),
            container: {
              member: `${i}.bsa`,
              bytes: 4_000_000_000,
              sha256: '1'.repeat(64),
            },
          },
        });
    },
  ]) {
    const recipe = structuredClone(f.recipe);
    mutate(recipe);
    assert.throws(() => validateRecipe(recipe));
  }
});

test('nested BSA preflight rejects bad containers, members and unrelated unsafe entries before destination writes', async (t) => {
  const cases = [
    {
      name: 'wrong container hash',
      mutateRecipe: (r) => {
        for (const o of r.outputs.filter(
          (o) => o.action.type === 'extract-bsa104',
        ))
          o.action.container.sha256 = '0'.repeat(64);
      },
    },
    {
      name: 'missing container',
      mutateRecipe: (r) => {
        for (const o of r.outputs.filter(
          (o) => o.action.type === 'extract-bsa104',
        ))
          o.action.container.member = 'Missing/' + o.action.container.member;
      },
    },
    {
      name: 'wrong inner hash',
      mutateRecipe: (r) => {
        r.outputs.find((o) => o.action.type === 'extract-bsa104').sha256 =
          '0'.repeat(64);
      },
    },
    {
      name: 'missing inner member',
      mutateRecipe: (r) => {
        r.outputs.find(
          (o) => o.action.type === 'extract-bsa104',
        ).action.member = 'missing.nif';
      },
    },
    {
      name: 'unsupported BSA version',
      mutateBsa: (b) => b.bytes.writeUInt32LE(105, 4),
    },
    {
      name: 'overlapping BSA ranges',
      mutateBsa: (b) =>
        b.bytes.writeUInt32LE(b.entries[0].offset + 1, b.records[1] + 12),
    },
    {
      name: 'unsafe outer entry',
      extraFiles: [['../unsafe.bin', Buffer.from('unsafe')]],
    },
    {
      name: 'ambiguous outer entry',
      extraFiles: [['data/archive a.bsa', Buffer.from('collision')]],
    },
  ];
  for (const item of cases)
    await t.test(item.name, async (t) => {
      const f = await createNativeBsaFixture('zip-windows', item);
      isolate(t, f);
      await assert.rejects(
        materializeNative(f.packageFile, f.destination, f.options),
      );
      assert.equal(fs.existsSync(f.destination), false);
      assert.deepEqual(fs.readdirSync(f.staging), []);
    });
});

test('BSA staging cancellation and write failures remove temporary files without creating a candidate', async (t) => {
  await t.test('cancellation', async (t) => {
    const f = await createNativeBsaFixture();
    isolate(t, f);
    const controller = new AbortController();
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, {
        ...f.options,
        signal: controller.signal,
        activity: (v) => {
          if (v.phase === 'archives' && v.totalBytes > 0) controller.abort();
        },
      }),
    );
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(f.staging), []);
  });
  await t.test('failed disk write', async (t) => {
    const f = await createNativeBsaFixture();
    isolate(t, f);
    const open = fs.promises.open;
    t.mock.method(fs.promises, 'open', async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).startsWith(f.staging))
        handle.write = async () => {
          throw Error('simulated staging write failure');
        };
      return handle;
    });
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, f.options),
      /staging write failure/,
    );
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(f.staging), []);
  });
  await t.test('insufficient temporary space', async (t) => {
    const f = await createNativeBsaFixture();
    isolate(t, f);
    const statfs = fs.statfsSync;
    t.mock.method(fs, 'statfsSync', (file, options) =>
      String(file) === f.staging
        ? { bavail: 0n, bsize: 4096n }
        : statfs(file, options),
    );
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, f.options),
      /temporary disk space/,
    );
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(f.staging), []);
  });
});

test('BSA cleanup preserves unfamiliar files and refuses a replaced staging directory', async (t) => {
  await t.test('unfamiliar file', async (t) => {
    const f = await createNativeBsaFixture();
    isolate(t, f);
    let canary;
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, {
        ...f.options,
        progress: (v) => {
          if (v.completed !== 1) return;
          const root = path.join(f.staging, fs.readdirSync(f.staging)[0]);
          canary = path.join(root, 'unrelated.txt');
          fs.writeFileSync(canary, 'preserve me');
        },
      }),
    );
    assert.equal(fs.readFileSync(canary, 'utf8'), 'preserve me');
    assert.deepEqual(fs.readdirSync(path.dirname(canary)), ['unrelated.txt']);
  });
  await t.test('replaced directory', async (t) => {
    const f = await createNativeBsaFixture();
    isolate(t, f);
    let canary, retained;
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, {
        ...f.options,
        progress: (v) => {
          if (v.completed !== 1) return;
          const root = path.join(f.staging, fs.readdirSync(f.staging)[0]);
          retained = path.join(f.staging, 'retained-staging');
          assert.equal(path.dirname(root), f.staging);
          assert.equal(path.dirname(retained), f.staging);
          fs.renameSync(root, retained);
          fs.mkdirSync(root);
          canary = path.join(root, 'unrelated.txt');
          fs.writeFileSync(canary, 'preserve me');
        },
      }),
      /staging directory changed/,
    );
    assert.equal(fs.readFileSync(canary, 'utf8'), 'preserve me');
    assert.equal(fs.readdirSync(retained).length, 2);
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
      ).status,
      'failed',
    );
  });
});

test('BSA cancellation resumes exact files and repair retains conflicting files and personal data', async (t) => {
  const f = await createNativeBsaFixture();
  isolate(t, f);
  const controller = new AbortController();
  await assert.rejects(
    materializeNative(f.packageFile, f.destination, {
      ...f.options,
      signal: controller.signal,
      progress: (v) => {
        if (v.completed === 3) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(fs.readdirSync(f.staging), []);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
    ).status,
    'cancelled',
  );
  const inspected = await inspectNativePackage(f.packageFile);
  const reviewed = await reviewBuildRecovery(inspected, f.destination);
  assert.ok(reviewed.reused > 0);
  await materializeNative(f.packageFile, f.destination, {
    ...f.options,
    resume: reviewed,
  });
  verify(f);
  const changed = f.bsaOutputs[0],
    missing = f.bsaOutputs[2];
  const kept = fs.statSync(path.join(f.destination, f.bsaOutputs[1].path));
  fs.writeFileSync(path.join(f.destination, changed.path), 'personal mesh');
  fs.unlinkSync(path.join(f.destination, missing.path));
  fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'));
  fs.writeFileSync(
    path.join(f.destination, 'profiles/Test/saves/test.fos'),
    'save canary',
  );
  fs.writeFileSync(
    path.join(f.destination, 'untracked.bin'),
    'untracked canary',
  );
  const repair = await reviewNativeRepair(inspected, f.destination),
    directory = `.loadstone-repair-recovery/${crypto.randomUUID()}`;
  assert.equal(repair.conflicts, 1);
  assert.equal(repair.missing, 1);
  const result = await materializeNative(f.packageFile, f.destination, {
    ...f.options,
    resume: repair,
    repair: { directory },
  });
  assert.equal(result.status, 'repaired');
  verify(f);
  assert.equal(
    fs.readFileSync(path.join(f.destination, directory, changed.path), 'utf8'),
    'personal mesh',
  );
  assert.equal(
    fs.readFileSync(
      path.join(f.destination, 'profiles/Test/saves/test.fos'),
      'utf8',
    ),
    'save canary',
  );
  assert.equal(
    fs.readFileSync(path.join(f.destination, 'untracked.bin'), 'utf8'),
    'untracked canary',
  );
  assert.equal(
    fs.statSync(path.join(f.destination, f.bsaOutputs[1].path)).ino,
    kept.ino,
  );
});
