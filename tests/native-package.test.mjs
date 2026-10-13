import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import yazl from 'yazl';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const {
  validateRecipe,
  canonicalJson,
} = require('../electron/native-format.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
const fingerprint = (data) => ({
  bytes: Buffer.byteLength(data),
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-native-'));
  const payloads = path.join(root, 'payloads');
  fs.mkdirSync(payloads);
  const game = fingerprint('fixture owned game');
  const recipe = {
    format: 'loadstone',
    formatVersion: 1,
    id: 'native-fixture',
    name: 'Native fixture',
    version: '0.1.0',
    author: 'Loadstone tests',
    description: 'Synthetic format verification.',
    website: 'https://example.org/loadstone',
    game: { id: 'fnv', variant: 'base' },
    requirements: [
      {
        id: 'fnv',
        store: 'steam',
        files: [{ path: 'FalloutNV.exe', ...game }],
      },
    ],
    launch: { profile: 'Test', executable: 'New Vegas', gameRoot: 'Game' },
    sources: [
      {
        id: 'owned-game',
        type: 'game-file',
        game: 'fnv',
        path: 'FalloutNV.exe',
        ...game,
      },
    ],
    outputs: [
      {
        path: 'Game/FalloutNV.exe',
        ...game,
        action: { type: 'copy', source: 'owned-game' },
      },
    ],
    saveCompatibility: {
      status: 'new-save-required',
      notes: 'Synthetic fixture; no actual game is launched.',
    },
  };
  for (const [index, [name, content]] of [
    ['ModOrganizer.exe', 'fixture manager'],
    ['ModOrganizer.ini', '[General]\ngamePath=Game\n'],
    ['profiles/Test/modlist.txt', '# Empty synthetic fixture\n'],
    ['profiles/Test/plugins.txt', 'FalloutNV.esm\n'],
  ].entries()) {
    const locked = fingerprint(content),
      id = `payload-${index}`;
    fs.writeFileSync(path.join(payloads, locked.sha256), content);
    recipe.sources.push({
      id,
      type: 'payload',
      ...locked,
      credit: { name: 'Fixture author', url: 'https://example.org/credits' },
      permission: {
        license: 'CC0-1.0',
        evidence: 'https://example.org/permission',
      },
    });
    recipe.outputs.push({
      path: name,
      ...locked,
      action: { type: 'copy', source: id },
    });
  }
  return { root, payloads, recipe };
}
async function rawPackage(root, entries) {
  const file = path.join(root, `${crypto.randomUUID()}.loadstone`),
    zip = new yazl.ZipFile();
  for (const entry of entries)
    zip.addBuffer(Buffer.from(entry.data), entry.name, {
      mode: entry.mode ?? 0o100644,
    });
  const writing = pipeline(
    zip.outputStream,
    fs.createWriteStream(file, { flags: 'wx' }),
  );
  zip.end();
  await writing;
  return file;
}
function entriesFor(f) {
  return [
    { name: 'recipe.json', data: canonicalJson(f.recipe) },
    ...f.recipe.sources
      .filter((v) => v.type === 'payload')
      .map((v) => ({
        name: `payload/${v.sha256}`,
        data: fs.readFileSync(path.join(f.payloads, v.sha256)),
      })),
  ];
}

test('native packages round trip deterministically and never replace a package or include machine paths', async () => {
  const f = fixture(),
    first = path.join(f.root, 'one.loadstone'),
    second = path.join(f.root, 'two.loadstone');
  const built = await packNativeRecipe(f.recipe, f.payloads, first);
  await packNativeRecipe(f.recipe, f.payloads, second);
  const original = fs.readFileSync(first);
  assert.deepEqual(original, fs.readFileSync(second));
  assert.deepEqual(built.recipe, f.recipe);
  assert.equal(built.summary.outputs, 5);
  assert.equal(built.publicationApproved, false);
  assert.equal(original.includes(Buffer.from(f.root)), false);
  await assert.rejects(
    packNativeRecipe(f.recipe, f.payloads, first),
    /replace an existing/,
  );
  assert.deepEqual(fs.readFileSync(first), original);
  const payload = f.recipe.sources.find((v) => v.type === 'payload');
  fs.writeFileSync(path.join(f.payloads, payload.sha256), 'changed');
  const rejected = path.join(f.root, 'rejected.loadstone');
  await assert.rejects(
    packNativeRecipe(f.recipe, f.payloads, rejected),
    /locked input/,
  );
  assert.equal(fs.existsSync(rejected), false);
});

test('native recipe rejects unsafe paths, scripts, unlocked sources, absent TTW ownership and unsupported versions', () => {
  const { recipe } = fixture();
  for (const unsafe of [
    '../outside',
    'C:/absolute',
    'mods/a:stream',
    'mods/CON.txt',
    'mods/ending.',
    'mods\\windows',
    'saves/save.fos',
    '.loadstone-owner.json',
  ]) {
    const candidate = structuredClone(recipe);
    candidate.outputs[1].path = unsafe;
    assert.throws(() => validateRecipe(candidate), /Invalid .loadstone/);
  }
  for (const mutate of [
    (v) => {
      v.formatVersion = 2;
    },
    (v) => {
      v.outputs.push({ ...v.outputs[0], path: 'game/falloutnv.EXE' });
    },
    (v) => {
      v.outputs[1].path = 'Game';
    },
    (v) => {
      v.outputs[0].action = {
        type: 'shell',
        command: 'anything',
        source: 'owned-game',
      };
    },
    (v) => {
      v.sources[0].path = 'unlocked.exe';
    },
    (v) => {
      v.sources[1].permission = { license: 'unknown' };
    },
    (v) => {
      v.sources[1].credit.url = 'https://example.org/?apikey=secret';
    },
    (v) => {
      v.game.variant = 'ttw';
    },
    (v) => {
      v.sources[0].apiKey = 'secret';
    },
    (v) => {
      v.outputs[0].sha256 = '0'.repeat(64);
    },
    (v) => {
      v.sources.push({ ...v.sources[1], id: 'unused' });
    },
  ]) {
    const candidate = structuredClone(recipe);
    mutate(candidate);
    assert.throws(() => validateRecipe(candidate), /Invalid .loadstone/);
  }
});

test('native package inspection rejects tampering, extra payloads, duplicates, redirects and ambiguous JSON', async () => {
  const f = fixture();
  const malformed = [
    (entries) => {
      entries[1].data = Buffer.from('corrupt');
    },
    (entries) => {
      entries.push({ name: 'undeclared.bin', data: 'unexpected' });
    },
    (entries) => {
      entries.push(entries[1]);
    },
    (entries) => {
      entries.splice(1, 1);
    },
    (entries) => {
      entries[1].mode = 0o120777;
    },
    (entries) => {
      entries[0].data = JSON.stringify(f.recipe, null, 2);
    },
    (entries) => {
      entries[0].data = canonicalJson(f.recipe).replace(
        '"formatVersion":1',
        '"formatVersion":999,"formatVersion":1',
      );
    },
    (entries) => {
      entries.reverse();
    },
  ];
  for (const mutate of malformed) {
    const entries = entriesFor(f);
    mutate(entries);
    await assert.rejects(
      inspectNativePackage(await rawPackage(f.root, entries)),
    );
  }
});

test('native recipe locks exact Nexus archive identity and safely addresses a member', () => {
  const f = fixture(),
    game = f.recipe.requirements[0].files[0];
  f.recipe.sources.push({
    id: 'upstream',
    type: 'nexus-archive',
    game: 'falloutnv',
    modId: 123,
    fileId: 456,
    ...fingerprint('locked fixture archive'),
    credit: {
      name: 'Upstream author',
      url: 'https://www.nexusmods.com/newvegas/mods/123',
    },
  });
  f.recipe.outputs.push({
    path: 'mods/Example/Example.esp',
    bytes: game.bytes,
    sha256: game.sha256,
    action: { type: 'extract', source: 'upstream', member: 'Data/Example.esp' },
  });
  assert.doesNotThrow(() => validateRecipe(f.recipe));
  delete f.recipe.sources.at(-1).fileId;
  assert.throws(() => validateRecipe(f.recipe), /exact mod and file IDs/);
  f.recipe.sources.at(-1).fileId = 456;
  f.recipe.outputs.at(-1).action.member = '../../outside';
  assert.throws(() => validateRecipe(f.recipe), /safe member path/);
});
