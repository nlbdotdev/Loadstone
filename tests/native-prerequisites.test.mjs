import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { validateRecipe } = require('../electron/native-format.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
test('local prerequisites remain unbundled, hash-locked and isolated from outputs', async () => {
  const f = createNativeFixture({ prerequisite: true });
  for (const folder of ['packages', 'owned', 'local', 'candidates'])
    fs.mkdirSync(path.join(f.root, folder));
  const game = path.join(f.root, 'owned'),
    local = path.join(f.root, 'local');
  fs.writeFileSync(path.join(game, 'FalloutNV.exe'), 'fixture owned game');
  fs.writeFileSync(
    path.join(local, 'support.bin'),
    'user-provided prerequisite bytes',
  );
  const file = path.join(f.root, 'packages/fixture.loadstone'),
    target = path.join(f.root, 'candidates/complete');
  await packNativeRecipe(f.recipe, f.payloads, file);
  const inspected = await inspectNativePackage(file);
  assert.equal(inspected.summary.prerequisites[0].name, 'Fixture prerequisite');
  assert.equal(
    fs
      .readFileSync(file)
      .includes(Buffer.from('user-provided prerequisite bytes')),
    false,
  );
  const options = {
    games: { fnv: game },
    prerequisites: { 'prepared-support': local },
  };
  await assert.rejects(
    materializeNative(file, target, { games: options.games }),
    /prerequisite folder/,
  );
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(
    materializeNative(file, path.join(local, 'nested'), options),
    /separate from source/,
  );
  fs.writeFileSync(path.join(local, 'support.bin'), 'wrong');
  await assert.rejects(materializeNative(file, target, options));
  assert.equal(fs.existsSync(target), false);
  fs.writeFileSync(
    path.join(local, 'support.bin'),
    'user-provided prerequisite bytes',
  );
  const result = await materializeNative(file, target, options);
  assert.equal(result.status, 'verified');
  assert.equal(result.launchVerified, false);
  assert.deepEqual(
    fs.readFileSync(path.join(target, 'mods/Support/support.bin')),
    fs.readFileSync(path.join(local, 'support.bin')),
  );
  assert.equal(
    fs.readFileSync(path.join(local, 'support.bin'), 'utf8'),
    'user-provided prerequisite bytes',
  );
});
test('prerequisites cannot replace owned TTW games or introduce undeclared files and executable actions', () => {
  const { recipe } = createNativeFixture({ prerequisite: true });
  const invalid = (change) => {
    const value = structuredClone(recipe);
    change(value);
    assert.throws(() => validateRecipe(value));
  };
  invalid((v) => (v.game.variant = 'ttw'));
  invalid((v) => (v.prerequisites[0].files[0].path = '../escape'));
  invalid((v) => v.prerequisites.push(v.prerequisites[0]));
  invalid((v) => (v.sources.at(-1).sha256 = '0'.repeat(64)));
  invalid((v) => (v.sources.at(-1).path = 'undeclared.bin'));
  invalid((v) => (v.prerequisites[0].command = 'run something'));
  invalid((v) => (v.outputs.at(-1).action.type = 'execute'));
  invalid(
    (v) =>
      (v.prerequisites[0].instructions =
        'https://example.org/prepare?token=private'),
  );
  const plain = createNativeFixture().recipe;
  assert.deepEqual(validateRecipe(plain), plain);
});
