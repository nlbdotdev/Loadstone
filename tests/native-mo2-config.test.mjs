import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { validateRecipe } = require('../electron/native-format.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const { renderMo2Config } = require('../electron/native-mo2-config.cjs');
const { inspectMo2 } = require('../electron/installed-inventory.cjs');
const { verifyGameLayout } = require('../electron/game-layout.cjs');
const { decodeMo2Value } = require('../electron/mo2-ini-value.cjs');
const fingerprint = (data) => ({
  bytes: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});

async function fixture() {
  const f = createNativeFixture({ mo2Config: true });
  f.config = f.recipe.outputs.find((v) => v.action.type === 'mo2-config');
  f.game = path.join(f.root, 'owned');
  f.packages = path.join(f.root, 'packages');
  fs.mkdirSync(f.game);
  fs.mkdirSync(f.packages);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.package = path.join(f.packages, 'fixture.loadstone');
  f.inspected = await packNativeRecipe(f.recipe, f.payloads, f.package);
  f.options = { games: { fnv: f.game }, archives: {} };
  return f;
}

test('edition declarations match the target storefront, including mixed-store TTW requirements', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  const text = () =>
    renderMo2Config(config, recipe, 'C:/Loadstone/Edition').data.toString();
  for (const [store, edition] of [
    ['steam', 'Steam'],
    ['gog', 'GOG'],
  ]) {
    recipe.requirements[0].store = store;
    config.action.gameEdition = edition;
    assert.match(text(), new RegExp(`^game_edition="${edition}"$`, 'm'));
  }
  recipe.game.variant = 'ttw';
  recipe.requirements.unshift({ id: 'fallout3', store: 'steam', files: [] });
  assert.match(text(), /^game_edition="GOG"$/m);
  for (const invalid of [
    'Steam',
    'Epic Games',
    'gog',
    '',
    null,
    'GOG\n[Settings]',
  ]) {
    config.action.gameEdition = invalid;
    assert.throws(text, /gameEdition must match/);
  }
});

test('recipes without an edition retain their pre-extension configuration fingerprint', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  delete config.action.gameEdition;
  assert.doesNotThrow(() => validateRecipe(recipe));
  const rendered = renderMo2Config(config, recipe, 'C:/Loadstone/Legacy');
  assert.equal(rendered.bytes, 739);
  assert.equal(
    rendered.sha256,
    '64208730d9f197da885102b8c656b97aeac0bdbc803d93cbf2e8f61ab730e2c3',
  );
});

test('executable Steam app IDs are explicit and tied to the target game storefront', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  const entry = config.action.executables[0];
  const render = () => renderMo2Config(config, recipe, 'C:/Loadstone/Steam');
  const legacy = render();
  entry.steamAppId = '22380';
  assert.match(render().data.toString(), /^1\\steamAppID=22380$/m);
  assert.notEqual(render().sha256, legacy.sha256);
  recipe.game.variant = 'ttw';
  recipe.requirements.unshift({ id: 'fallout3', store: 'gog', files: [] });
  assert.doesNotThrow(render);
  for (const invalid of [
    '22490',
    '489830',
    22380,
    '',
    null,
    '22380\n[Settings]',
  ]) {
    entry.steamAppId = invalid;
    assert.throws(render, /steamAppId must match/);
  }
  entry.steamAppId = '22380';
  recipe.requirements.find((v) => v.id === 'fnv').store = 'gog';
  config.action.gameEdition = 'GOG';
  assert.throws(render, /steamAppId must match/);
  delete entry.steamAppId;
  assert.doesNotThrow(render);
  recipe.game.variant = 'base';
  recipe.requirements.shift();
  recipe.requirements[0].store = 'steam';
  config.action.gameEdition = 'Steam';
  assert.deepEqual(render(), legacy);
});

test('one recipe generates isolated MO2 paths at two destinations with exact derived fingerprints', async () => {
  const f = await fixture();
  assert.equal(f.inspected.summary.generatedConfigurations, 1);
  assert.equal(
    f.inspected.summary.installBytes,
    f.recipe.outputs.reduce((n, v) => n + (v.bytes ?? 1_000_000), 0),
  );
  const source = fs.readFileSync(f.package);
  const hashes = [];
  for (const name of ['First candidate', 'Deuxième 候補,;=@']) {
    const destination = path.join(f.root, name);
    const receipt = await materializeNative(f.package, destination, f.options);
    const data = fs.readFileSync(path.join(destination, 'ModOrganizer.ini'));
    const text = data.toString('utf8'),
      root = destination.replaceAll('\\', '/');
    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.launchVerified, false);
    assert.deepEqual(receipt.generatedConfigurations, [
      {
        path: 'ModOrganizer.ini',
        generator: 'mo2-config',
        ...fingerprint(data),
      },
    ]);
    assert.ok(text.includes(`mod_directory="${root}/mods"`));
    assert.ok(text.includes(`1\\binary="${root}/Game/FalloutNV.exe"`));
    assert.ok(!text.includes(f.game));
    assert.ok(!text.includes('nexus_api_key'));
    for (const folder of [
      'downloads',
      'mods',
      'profiles',
      'overwrite',
      'webcache',
    ])
      assert.ok(fs.statSync(path.join(destination, folder)).isDirectory());
    hashes.push(receipt.generatedConfigurations[0].sha256);
    assert.equal(JSON.stringify(receipt).includes(destination), false);
    const inventory = await inspectMo2(destination);
    assert.equal(inventory.source.gameFolder, path.join(destination, 'Game'));
    assert.equal(inventory.source.profile, 'Test');
    assert.doesNotThrow(() =>
      verifyGameLayout(
        { manifest: f.recipe },
        destination,
        text,
        path.join(destination, 'Game/FalloutNV.exe'),
      ),
    );
  }
  assert.notEqual(hashes[0], hashes[1]);
  assert.deepEqual(fs.readFileSync(f.package), source);
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
});

test('typed configuration rejects arbitrary fields, external binaries, scripts, ambiguous launch entries and missing portable marker', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  for (const mutate of [
    (v, c) => {
      c.bytes = 0;
      c.sha256 = '0'.repeat(64);
    },
    (v, c) => {
      c.action.source = 'owned-game';
    },
    (v, c) => {
      c.action.nexus_api_key = 'secret';
    },
    (v, c) => {
      c.action.gameEdition = 'GOG';
    },
    (v, c) => {
      c.path = 'other.ini';
    },
    (v, c) => {
      c.action.executables[0].binary = 'C:/old/Game.exe';
    },
    (v, c) => {
      c.action.executables[0].binary = '../Game.exe';
    },
    (v, c) => {
      c.action.executables[0].binary = 'Game/missing.exe';
    },
    (v, c) => {
      c.action.executables[0].binary = 'Game/launch.cmd';
    },
    (v, c) => {
      c.action.executables[0].workingDirectory = '..';
    },
    (v, c) => {
      c.action.executables[0].arguments = '--anything';
    },
    (v, c) => {
      c.action.executables[0].title = 'New Vegas\n[Settings]';
    },
    (v, c) => {
      c.action.executables.push({
        ...c.action.executables[0],
        title: 'new vegas',
      });
    },
    (v, c) => {
      c.action.executables[0].title = 'Different launch';
    },
    (v) => {
      v.outputs = v.outputs.filter((o) => o.path !== 'portable.txt');
    },
    (v) => {
      v.outputs.find((o) => o.path === 'portable.txt').bytes = 1;
    },
    (v) => {
      v.outputs.push({ ...v.outputs[0], path: 'overwrite' });
    },
  ]) {
    const value = structuredClone(recipe);
    mutate(
      value,
      value.outputs.find((v) => v.action.type === 'mo2-config'),
    );
    assert.throws(() => validateRecipe(value), /Invalid/);
  }
});

test('configuration generation bounds Windows destination and encodes Qt bytes/quoted strings without INI injection', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  for (const root of [
    'relative',
    '\\\\server\\share',
    'C:/x\n[Settings]',
    'C:/%BASE_DIR%/candidate',
    'C:/' + 'x'.repeat(2048),
  ])
    assert.throws(
      () => renderMo2Config(config, recipe, root),
      /Windows drive path/,
    );
  config.action.executables[0].title = '@run,;="测试"';
  recipe.launch.executable = config.action.executables[0].title;
  // Verify lexical serialization separately from materializer fingerprints.
  const text = renderMo2Config(config, recipe, 'C:/候補,;=Set').data.toString(
    'utf8',
  );
  assert.ok(text.includes('1\\title="@@run,;=\\"测试\\""'));
  assert.match(text, /gamePath=@ByteArray\((?:\\x[0-9a-f]{2})+\)/);
  assert.ok(text.includes('1\\workingDirectory="C:/候補,;=Set/Game"'));
  const values = new Map(
    text
      .split('\n')
      .filter((v) => v.includes('='))
      .map((v) => [
        v.slice(0, v.indexOf('=')),
        decodeMo2Value(v.slice(v.indexOf('=') + 1)),
      ]),
  );
  assert.equal(values.get('gamePath'), 'C:/候補,;=Set/Game');
  assert.equal(values.get('1\\title'), '@run,;="测试"');
  assert.equal(values.get('1\\arguments'), '"C:/候補,;=Set/Game"');
  assert.equal(
    decodeMo2Value('@ByteArray(C:\\\\Original\\\\Game)'),
    'C:\\Original\\Game',
  );
  assert.throws(() => decodeMo2Value('@ByteArray(\\xff)'), /UTF-8/);
});

test('typed MO2 arguments accept only bounded local references and preserve argument boundaries', () => {
  const { recipe } = createNativeFixture({ mo2Config: true });
  const config = recipe.outputs.find((v) => v.action.type === 'mo2-config');
  const entry = config.action.executables[0];
  for (const args of [
    [],
    'command',
    Array(17).fill({ type: 'path', path: 'Game' }),
    [{ type: 'literal', path: '/c command' }],
    [{ type: 'path', path: '../outside' }],
    [{ type: 'path', path: 'C:/old/Game' }],
    [{ type: 'path', path: 'Game/missing' }],
    [{ type: 'path', path: 'Game', value: 'extra' }],
    [{ type: 'path', path: 'saves' }],
  ]) {
    entry.arguments = args;
    assert.throws(() => validateRecipe(recipe), /Invalid/);
  }
  entry.arguments = [
    { type: 'path', path: 'Game/FalloutNV.exe' },
    { type: 'path', path: '.' },
  ];
  const root = 'C:/候補 with spaces,;=&';
  const text = renderMo2Config(config, recipe, root).data.toString('utf8');
  const argumentsLine = text
    .split('\n')
    .find((v) => v.startsWith('1\\arguments='));
  assert.equal(
    decodeMo2Value(argumentsLine.slice('1\\arguments='.length)),
    '"C:/候補 with spaces,;=&/Game/FalloutNV.exe" "C:/候補 with spaces,;=&"',
  );
  delete entry.arguments;
  assert.doesNotThrow(() => validateRecipe(recipe));
});

test('generated configuration tampering is caught by final verification and a rejected destination creates no files', async () => {
  const f = await fixture(),
    bad = path.join(f.root, '%BASE_DIR%');
  await assert.rejects(
    materializeNative(f.package, bad, f.options),
    /Windows drive path/,
  );
  assert.equal(fs.existsSync(bad), false);
  const destination = path.join(f.root, 'tampered');
  await assert.rejects(
    materializeNative(f.package, destination, {
      ...f.options,
      progress: ({ completed, total }) => {
        if (completed === total) {
          const file = path.join(destination, 'ModOrganizer.ini');
          const bytes = fs.statSync(file).size;
          fs.writeFileSync(file, Buffer.alloc(bytes, 'x'));
        }
      },
    }),
    /recipe hash/,
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(destination, '.loadstone-native.json')),
  );
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.generatedConfigurations.length, 1);
});
