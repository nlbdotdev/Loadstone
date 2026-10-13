import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
const require = createRequire(import.meta.url);
const { buildSourceLedger } = require('../electron/source-ledger.cjs');
const { mapArchiveSources } = require('../electron/archive-mapping.cjs');
const { readSourceHints } = require('../electron/source-hints.cjs');
const fingerprint = (text) => ({
  bytes: Buffer.byteLength(text),
  sha256: crypto.createHash('sha256').update(text).digest('hex'),
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-ledger-'));
  const inventory = {
    schemaVersion: 1,
    kind: 'loadstone-installed-inventory',
    fileHashing: 'sha256',
    source: { profile: 'Current', gameName: 'New Vegas' },
    mods: [
      {
        name: 'Installed edited mod',
        position: 0,
        enabled: true,
        present: true,
        metadata: {
          installationFile: 'Original.zip',
          modid: '123',
          apiKey: 'synthetic-secret',
        },
        files: [
          { path: 'Example.esp', ...fingerprint('modified installed content') },
        ],
      },
    ],
    overwrite: [{ path: 'generated.txt', ...fingerprint('generated') }],
  };
  fs.writeFileSync(path.join(root, 'Original.zip'), 'original archive bytes');
  fs.writeFileSync(
    path.join(root, 'Original.zip.meta'),
    '[General]\ngameName=FalloutNV\nmodID=123\nfileID=456\napiKey=synthetic-secret\nurl=https://example.org/?token=synthetic-secret\n',
  );
  return { root, inventory };
}
const hintsFor = (f) => ({
  schemaVersion: 1,
  kind: 'loadstone-source-hints',
  mods: [
    {
      name: f.inventory.mods[0].name,
      archives: [path.join(f.root, 'Original.zip')],
    },
  ],
});

test('explicit source hints find unlinked bytes, preserve disabled state and never resolve edits or permissions by declaration', async () => {
  const f = fixture();
  f.inventory.mods[0].metadata = {};
  f.inventory.mods[0].enabled = false;
  f.inventory.mods[0].files.push({
    path: 'Edited.ini',
    ...fingerprint('local edit'),
  });
  const archive = path.join(f.root, 'Original.zip'),
    zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.from('modified installed content'),
    'Nested/Example.esp',
  );
  zip.addBuffer(Buffer.from('unmodified ini'), 'Edited.ini');
  const writing = pipeline(zip.outputStream, fs.createWriteStream(archive));
  zip.end();
  await writing;
  const before = fs.readFileSync(archive);
  const automatic = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(automatic.mods[0].archiveCandidates.length, 0);
  const ledger = await buildSourceLedger(f.inventory, [f.root], {
    hints: hintsFor(f),
  });
  assert.equal(ledger.summary.hintedMods, 1);
  assert.equal(ledger.summary.creatorHintedArchives, 1);
  assert.equal(ledger.mods[0].archiveCandidates[0].matchedBy, 'creator-hint');
  assert.equal(ledger.mods[0].archiveCandidates[0].creatorHint, true);
  assert.equal(ledger.mods[0].permissions, 'unreviewed');
  assert.equal(ledger.summary.resolvedFiles, 0);
  const mapped = await mapArchiveSources(ledger);
  assert.equal(mapped.mapping.matchedInstalledFiles, 1);
  assert.equal(
    mapped.mods[0].installedFiles[0].sourceMatches[0].member,
    'Nested/Example.esp',
  );
  assert.equal(mapped.mods[0].installedFiles[1].sourceMatches.length, 0);
  assert.equal(mapped.mods[0].enabled, false);
  assert.equal(mapped.installable, false);
  assert.equal(mapped.publicationApproved, false);
  assert.deepEqual(fs.readFileSync(archive), before);
  fs.appendFileSync(archive, 'changed');
  const changed = await mapArchiveSources(ledger);
  assert.equal(changed.mapping.matchedInstalledFiles, 0);
  assert.equal(changed.mapping.issues.length, 1);
});

test('source hints reject unknown mods, private extra fields, duplicate/relative/outside paths and do not override metadata conflicts', async () => {
  const f = fixture(),
    original = hintsFor(f);
  for (const mutate of [
    (h) => {
      h.schemaVersion = 2;
    },
    (h) => {
      h.apiKey = 'synthetic-secret';
    },
    (h) => {
      h.mods[0].name = 'not installed';
    },
    (h) => {
      h.mods[0].archives = ['relative.zip'];
    },
    (h) => {
      h.mods[0].archives = [path.join(path.dirname(f.root), 'outside.zip')];
    },
    (h) => {
      h.mods[0].archives.push(h.mods[0].archives[0]);
    },
    (h) => {
      h.mods.push({ ...h.mods[0], name: h.mods[0].name.toUpperCase() });
    },
    (h) => {
      h.mods[0].nexus = { modId: 123 };
    },
  ]) {
    const hints = structuredClone(original);
    mutate(hints);
    await assert.rejects(
      buildSourceLedger(f.inventory, [f.root], { hints }),
      /Invalid source hints/,
    );
  }
  const found = await buildSourceLedger(f.inventory, [f.root], {
    hints: original,
  });
  assert.equal(found.mods[0].archiveCandidates.length, 1);
  assert.equal(
    found.mods[0].archiveCandidates[0].matchedBy,
    'installation-filename',
  );
  assert.equal(found.mods[0].archiveCandidates[0].creatorHint, true);
  f.inventory.mods[0].metadata = { modid: 999, gameName: 'New Vegas' };
  const conflict = await buildSourceLedger(f.inventory, [f.root], {
    hints: original,
  });
  assert.equal(conflict.mods[0].archiveCandidates[0].metadataConflict, true);
  assert.equal(
    (await mapArchiveSources(conflict)).mapping.matchedInstalledFiles,
    0,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildSourceLedger(f.inventory, [f.root], {
      hints: original,
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('source-hint CLI retains the exact private hint fingerprint and rejects changed hints before mapping output', () => {
  const f = fixture(),
    reports = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-hints-'));
  f.inventory.mods[0].metadata = {};
  const inventory = path.join(reports, 'inventory.json'),
    hints = path.join(reports, 'hints.json'),
    ledger = path.join(reports, 'ledger.json');
  fs.writeFileSync(inventory, JSON.stringify(f.inventory));
  fs.writeFileSync(hints, JSON.stringify(hintsFor(f)));
  const run = (script, args) =>
    spawnSync(process.execPath, [path.resolve('scripts', script), ...args], {
      encoding: 'utf8',
      windowsHide: true,
    });
  const result = run('source-ledger.mjs', [
    inventory,
    ledger,
    f.root,
    '--hints',
    hints,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(fs.readFileSync(ledger));
  assert.deepEqual(saved.sourceHints, readSourceHints(hints).reference);
  assert.equal(saved.mods[0].archiveCandidates[0].matchedBy, 'creator-hint');
  const changed = hintsFor(f);
  changed.mods[0].name = 'Changed after ledger';
  fs.writeFileSync(hints, JSON.stringify(changed));
  const output = path.join(reports, 'mapping.json');
  const mapped = run('map-zip-sources.mjs', [ledger, output]);
  assert.notEqual(mapped.status, 0);
  assert.match(mapped.stderr, /source hints have changed/);
  assert.equal(fs.existsSync(output), false);
  const rejected = path.join(reports, 'invalid.json');
  assert.notEqual(
    run('source-ledger.mjs', [inventory, rejected, f.root, '--hints']).status,
    0,
  );
  assert.equal(fs.existsSync(rejected), false);
});
test('source ledger fingerprints candidate downloads without claiming that installed edits or permissions are resolved', async () => {
  const f = fixture();
  const ledger = await buildSourceLedger(f.inventory, [f.root]);
  const mod = ledger.mods[0],
    candidate = mod.archiveCandidates[0];
  assert.deepEqual(candidate.nexus, {
    game: 'falloutnv',
    modId: 123,
    fileId: 456,
  });
  assert.equal(candidate.sha256, fingerprint('original archive bytes').sha256);
  assert.deepEqual(mod.installedFiles, f.inventory.mods[0].files);
  assert.equal(mod.reconstruction, 'unresolved');
  assert.equal(mod.permissions, 'unreviewed');
  assert.equal(ledger.summary.resolvedFiles, 0);
  assert.equal(ledger.installable, false);
  assert.equal(ledger.publicationApproved, false);
  assert.equal(JSON.stringify(ledger).includes('synthetic-secret'), false);
  assert.equal(ledger.overwrite.length, 1);
});
test('source ledger retains ambiguity, rejects incomplete hashes, and refuses redirected downloads', async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'Another.zip'), 'another archive');
  fs.writeFileSync(
    path.join(f.root, 'Another.zip.meta'),
    '[General]\ngameName=FalloutNV\nmodID=123\nfileID=789\n',
  );
  fs.writeFileSync(
    path.join(f.root, 'WrongGame.zip'),
    'different game archive',
  );
  fs.writeFileSync(
    path.join(f.root, 'WrongGame.zip.meta'),
    '[General]\ngameName=Fallout4\nmodID=123\nfileID=789\n',
  );
  let ledger = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(ledger.mods[0].archiveCandidates.length, 2);
  assert.equal(ledger.summary.resolvedFiles, 0);
  f.inventory.mods[0].metadata.modid = '999';
  ledger = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(ledger.mods[0].archiveCandidates[0].metadataConflict, true);
  delete f.inventory.mods[0].files[0].sha256;
  await assert.rejects(
    buildSourceLedger(f.inventory, [f.root]),
    /complete SHA-256/,
  );
  const outer = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-ledger-link-'),
  );
  fs.symlinkSync(f.root, path.join(outer, 'redirect'), 'junction');
  await assert.rejects(
    buildSourceLedger(f.inventory, [path.join(outer, 'redirect')]),
    /redirected/,
  );
});

test('source ledger retains expanded installation hashes and disabled mod candidates without copying arbitrary fields', async () => {
  const f = fixture();
  f.inventory.mods[0].enabled = false;
  f.inventory.installation = {
    schemaVersion: 1,
    instanceFiles: [
      {
        path: 'ModOrganizer.exe',
        ...fingerprint('tool'),
        privateField: 'synthetic-secret',
      },
    ],
    gameFiles: [{ path: 'FalloutNV.exe', ...fingerprint('game') }],
    profileFiles: [
      { path: 'FalloutCustom.ini', ...fingerprint('custom config') },
    ],
    privateField: 'synthetic-secret',
  };
  f.inventory.exclusions = [
    {
      scope: 'profile',
      path: 'saves',
      reason: 'saved-game-state',
      privateField: 'synthetic-secret',
    },
  ];
  const ledger = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(ledger.mods[0].enabled, false);
  assert.equal(ledger.mods[0].archiveCandidates.length, 1);
  assert.equal(ledger.mods[0].reconstruction, 'unresolved');
  assert.equal(ledger.summary.installedModFiles, 1);
  assert.equal(ledger.summary.inventoriedDisabledModFiles, 1);
  assert.equal(ledger.summary.installationFiles, 3);
  assert.deepEqual(
    ledger.installation.gameFiles,
    f.inventory.installation.gameFiles,
  );
  assert.deepEqual(ledger.exclusions, [
    { scope: 'profile', path: 'saves', reason: 'saved-game-state' },
  ]);
  assert.equal(JSON.stringify(ledger).includes('synthetic-secret'), false);
  f.inventory.installation.profileFiles[0].path = '../outside';
  await assert.rejects(
    buildSourceLedger(f.inventory, [f.root]),
    /complete SHA-256/,
  );
});
