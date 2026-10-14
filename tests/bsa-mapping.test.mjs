import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bsaFixture } from './bsa-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
import {
  createArchiveFixture,
  fingerprint,
} from './native-archive-fixture.mjs';
const require = createRequire(import.meta.url);
const { mapBsaSources } = require('../electron/bsa-mapping.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');
const { mapArchiveSources } = require('../electron/archive-mapping.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

async function fixture(kind = 'zip-windows', mutate, extraFiles = []) {
  const encoded = bsaFixture(
    [
      { path: 'Meshes/z.nif', data: 'same content', compressed: false },
      {
        path: 'Meshes/a.nif',
        data: 'same content',
        alias: 0,
        compressed: false,
      },
      {
        path: 'Textures/test.dds',
        data: 'compressed content',
        compressed: true,
      },
      { path: 'empty.bin', data: '' },
    ],
    0x107,
  );
  mutate?.(encoded);
  const f = await createArchiveFixture(kind, {
    extraFiles: [['Data/Example.bsa', encoded.bytes], ...extraFiles],
  });
  f.modsFolder = path.join(f.root, 'installed-mods');
  fs.mkdirSync(path.join(f.modsFolder, 'Container'), { recursive: true });
  f.container = path.join(f.modsFolder, 'Container', 'Example.bsa');
  fs.writeFileSync(f.container, encoded.bytes);
  const file = (name, data) => ({
    path: name,
    ...fingerprint(Buffer.from(data)),
    sourceMatches: [],
  });
  const candidate = {
    archive: f.archive,
    ...fingerprint(fs.readFileSync(f.archive)),
  };
  f.ledger = {
    kind: 'loadstone-source-ledger',
    schemaVersion: 1,
    mapping: { kind: 'archive-member-sha256', matchedInstalledFiles: 2 },
    mods: [
      {
        name: 'Container',
        enabled: false,
        installedFiles: [
          {
            path: 'Example.bsa',
            ...fingerprint(encoded.bytes),
            sourceMatches: [
              {
                archiveSha256: candidate.sha256,
                member: 'Data/Example.bsa',
                equivalentMembers: 1,
              },
            ],
          },
        ],
        archiveCandidates: [candidate],
      },
      {
        name: 'Generated',
        enabled: true,
        installedFiles: [
          file('renamed.nif', 'same content'),
          file('another.nif', 'same content'),
          file('test.dds', 'compressed content'),
          file('empty.bin', ''),
          file('changed.nif', 'locally changed'),
          file('meta.ini', 'same content'),
        ],
        archiveCandidates: [],
      },
    ],
    overwrite: [file('unmapped.nif', 'same content')],
    installation: { gameFiles: [file('untouched.nif', 'same content')] },
    blockers: ['Source permissions remain unreviewed.'],
    installable: false,
    publicationApproved: false,
  };
  f.ledger.mods[1].installedFiles[0].sourceMatches = [
    {
      archiveSha256: 'a'.repeat(64),
      member: 'prior.nif',
      equivalentMembers: 1,
    },
  ];
  f.nativeOptions = f.options;
  f.options = {
    modsFolder: f.modsFolder,
    containerMods: ['Container'],
    sevenZip:
      kind === 'zip-windows'
        ? undefined
        : await createSevenZip(process.env.LOADSTONE_TEST_7ZIP),
  };
  return f;
}

for (const kind of ['zip-windows', '7z', 'rar'])
  test(
    `BSA mapping verifies the full ${kind} chain and preserves prior evidence and disabled state`,
    {
      skip: kind !== 'zip-windows' && !process.env.LOADSTONE_TEST_7ZIP,
    },
    async () => {
      const f = await fixture(kind),
        original = structuredClone(f.ledger),
        archiveBefore = fs.readFileSync(f.archive),
        containerBefore = fs.readFileSync(f.container);
      const mapped = await mapBsaSources(f.ledger, f.options);
      assert.deepEqual(f.ledger, original);
      assert.deepEqual(mapped.mapping, original.mapping);
      assert.deepEqual(mapped.overwrite, original.overwrite);
      assert.deepEqual(mapped.installation, original.installation);
      assert.equal(mapped.mods[0].enabled, false);
      for (let i = 0; i < 6; i++)
        assert.deepEqual(
          mapped.mods[1].installedFiles[i].sourceMatches,
          original.mods[1].installedFiles[i].sourceMatches,
        );
      assert.equal(mapped.bsaMapping.inspectedArchives.length, 1);
      assert.equal(mapped.bsaMapping.inspectedContainers.length, 1);
      assert.equal(mapped.bsaMapping.issues.length, 0);
      assert.equal(mapped.bsaMapping.existingArchiveMatchedInstalledFiles, 2);
      assert.equal(mapped.bsaMapping.nestedMatchedInstalledFiles, 4);
      assert.equal(mapped.bsaMapping.newlyMatchedInstalledFiles, 3);
      assert.equal(mapped.bsaMapping.combinedMatchedInstalledFiles, 5);
      assert.equal(mapped.bsaMapping.combinedUnmatchedInstalledFiles, 2);
      assert.deepEqual(mapped.mods[1].installedFiles[0].bsaSourceMatches, [
        {
          archiveSha256: f.ledger.mods[0].archiveCandidates[0].sha256,
          container: {
            member: 'Data/Example.bsa',
            ...fingerprint(containerBefore),
          },
          member: 'Meshes/a.nif',
          equivalentMembers: 2,
        },
      ]);
      assert.equal(mapped.mods[1].installedFiles[4].bsaSourceMatches.length, 0);
      assert.equal(mapped.mods[1].installedFiles[5].bsaSourceMatches.length, 0);
      assert.equal(mapped.installable, false);
      assert.equal(mapped.publicationApproved, false);
      assert.deepEqual(fs.readFileSync(f.archive), archiveBefore);
      assert.deepEqual(fs.readFileSync(f.container), containerBefore);
      // Recompute the nested extension without multiplying old references.
      const rerun = await mapBsaSources(mapped, f.options);
      assert.deepEqual(rerun, mapped);
    },
  );

test('BSA mapping rejects changed originals, changed local witnesses and unsupported containers without partial matches', async (t) => {
  for (const change of [
    'archive',
    'container',
    'unsupported',
    'unsafe-outer',
    'metadata-conflict',
    'missing',
  ])
    await t.test(change, async () => {
      const f = await fixture(
        'zip-windows',
        change === 'unsupported'
          ? (v) => v.bytes.writeUInt32LE(105, 4)
          : undefined,
        change === 'unsafe-outer'
          ? [['redirect', Buffer.from('elsewhere'), 0o120777]]
          : [],
      );
      // The reusable archive fixture keeps only pair values; add an unsafe ZIP directly.
      if (change === 'unsafe-outer') {
        const { storedZip } = await import('./native-archive-fixture.mjs');
        fs.writeFileSync(
          f.archive,
          storedZip([
            ['Data/Example.bsa', fs.readFileSync(f.container)],
            ['redirect', 'elsewhere', 0o120777],
          ]),
        );
        Object.assign(
          f.ledger.mods[0].archiveCandidates[0],
          fingerprint(fs.readFileSync(f.archive)),
        );
      }
      if (change === 'archive') fs.appendFileSync(f.archive, 'changed');
      if (change === 'container') fs.appendFileSync(f.container, 'changed');
      if (change === 'metadata-conflict')
        f.ledger.mods[0].archiveCandidates[0].metadataConflict = true;
      if (change === 'missing') fs.unlinkSync(f.container);
      const mapped = await mapBsaSources(f.ledger, f.options);
      assert.equal(mapped.bsaMapping.nestedMatchedInstalledFiles, 0);
      assert.equal(mapped.bsaMapping.inspectedContainers.length, 0);
      assert.ok(mapped.bsaMapping.issues.length > 0);
      assert.equal(mapped.bsaMapping.existingArchiveMatchedInstalledFiles, 2);
    });
});

test('BSA mapper bounds selections, rejects invalid ledger paths and fingerprints, and propagates cancellation', async () => {
  const f = await fixture();
  for (const containerMods of [
    [],
    ['container'],
    ['Container', 'Container'],
    ['../Container'],
    Array(65).fill('Container'),
  ])
    await assert.rejects(
      mapBsaSources(f.ledger, { ...f.options, containerMods }),
      /BSA mapping/,
    );
  for (const mutate of [
    (v) => {
      v.mods[0].name = '../Container';
    },
    (v) => {
      v.mods[0].installedFiles[0].path = '../escape.bsa';
    },
    (v) => {
      v.mods[0].installedFiles[0].bytes = 0xffffffff + 1;
    },
    (v) => {
      v.mods[0].installedFiles[0].sha256 = 'bad';
    },
    (v) => {
      v.mods[0].archiveCandidates[0].archive = 'relative.zip';
    },
    (v) => {
      v.mods.push(structuredClone(v.mods[0]));
    },
  ]) {
    const changed = structuredClone(f.ledger);
    mutate(changed);
    await assert.rejects(mapBsaSources(changed, f.options), /BSA mapping/);
  }
  const controller = new AbortController();
  await assert.rejects(
    mapBsaSources(f.ledger, {
      ...f.options,
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(f.ledger.mods[1].installedFiles[0].bsaSourceMatches, undefined);
});

test('mapped nested references reconstruct exact outputs through the native recipe engine', async () => {
  const f = await fixture(),
    mapped = await mapBsaSources(f.ledger, f.options);
  const selected = mapped.mods[1].installedFiles.filter(
    (v) => v.bsaSourceMatches.length,
  );
  for (const file of selected) {
    const match = file.bsaSourceMatches[0];
    assert.equal(
      match.archiveSha256,
      f.recipe.sources.find((v) => v.id === 'original-archive').sha256,
    );
    f.recipe.outputs.push({
      path: `mods/Generated/${file.path}`,
      bytes: file.bytes,
      sha256: file.sha256,
      action: {
        type: 'extract-bsa104',
        source: 'original-archive',
        container: match.container,
        member: match.member,
      },
    });
  }
  const packageFile = path.join(f.packages, 'mapped.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, packageFile);
  const result = await materializeNative(
    packageFile,
    f.destination,
    f.nativeOptions,
  );
  assert.equal(result.status, 'verified');
  for (const file of selected)
    assert.deepEqual(
      fingerprint(
        fs.readFileSync(path.join(f.destination, 'mods/Generated', file.path)),
      ),
      { bytes: file.bytes, sha256: file.sha256 },
    );
  const direct = await mapArchiveSources(mapped);
  assert.equal(direct.bsaMapping, undefined);
  assert.ok(
    direct.mods.every((mod) =>
      mod.installedFiles.every((file) => file.bsaSourceMatches === undefined),
    ),
  );
  assert.equal(mapped.bsaMapping.nestedMatchedInstalledFiles, 4);
});

test('BSA mapping CLI fingerprints its input and preserves reports and source directories', async () => {
  const f = await fixture(),
    inventory = path.join(f.root, 'inventory.json'),
    input = path.join(f.root, 'ledger.json'),
    output = path.join(f.root, 'reports', 'mapping.json');
  fs.writeFileSync(
    inventory,
    JSON.stringify({ source: { modsFolder: f.modsFolder } }),
  );
  f.ledger.inventory = {
    file: inventory,
    sha256: fingerprint(fs.readFileSync(inventory)).sha256,
  };
  fs.writeFileSync(input, JSON.stringify(f.ledger));
  const run = (target) =>
    spawnSync(
      process.execPath,
      ['scripts/map-bsa-sources.mjs', input, target, '--mod', 'Container'],
      { cwd: sourceRoot, encoding: 'utf8', timeout: 60000, windowsHide: true },
    );
  const result = run(output);
  assert.equal(result.status, 0, result.stderr);
  const before = fs.readFileSync(output),
    mapped = JSON.parse(before);
  assert.equal(
    mapped.bsaMapping.inputLedger.sha256,
    fingerprint(fs.readFileSync(input)).sha256,
  );
  assert.equal(mapped.bsaMapping.nestedMatchedInstalledFiles, 4);
  assert.notEqual(run(output).status, 0);
  assert.deepEqual(fs.readFileSync(output), before);
  const protectedOutput = path.join(f.modsFolder, 'forbidden.json');
  assert.notEqual(run(protectedOutput).status, 0);
  assert.equal(fs.existsSync(protectedOutput), false);
  const changed = path.join(f.root, 'changed.json');
  fs.appendFileSync(inventory, '\n');
  assert.notEqual(run(changed).status, 0);
  assert.equal(fs.existsSync(changed), false);
});
