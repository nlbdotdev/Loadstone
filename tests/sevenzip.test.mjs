import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  createSevenZip,
  parseListing,
  parseArchiveListing,
} = require('../electron/sevenzip.cjs');
const { mapArchiveSources } = require('../electron/archive-mapping.cjs');
const executable = process.env.LOADSTONE_TEST_7ZIP;
const fingerprint = (data) => ({
  bytes: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});

test(
  'single-pass solid 7z hashing preserves file boundaries and rejects mismatched framing',
  { skip: !executable || typeof zlib.crc32 !== 'function' },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-solid-'));
    const input = path.join(root, 'input');
    fs.mkdirSync(input);
    const files = new Map();
    for (let i = 0; i < 180; i++) {
      const name = `${String(i).padStart(3, '0')}-${i % 2 ? 'ü' : 'sample'}.bin`;
      const data = Buffer.alloc(i % 17 === 0 ? 0 : 32000 + i * 257, i);
      files.set(name, data);
      fs.writeFileSync(path.join(input, name), data);
    }
    const archive = path.join(root, 'solid.7z');
    execFileSync(executable, ['a', '-t7z', '-ms=on', '--', archive, '.'], {
      cwd: input,
      windowsHide: true,
      stdio: 'ignore',
    });
    const adapter = await createSevenZip(executable),
      candidate = { archive, ...fingerprint(fs.readFileSync(archive)) };
    assert.equal(adapter.batch7z, true);
    const inspected = await adapter.inspect(candidate);
    const wanted = new Set(
      [...files.values()].map((data) => {
        const f = fingerprint(data);
        return `${f.bytes}:${f.sha256}`;
      }),
    );
    const mapped = await adapter.hashArchive(candidate, inspected, wanted);
    for (const [name, data] of files) {
      const f = fingerprint(data);
      assert.ok(mapped.get(`${f.bytes}:${f.sha256}`).includes(name));
    }
    const sample = inspected.entries.find((v) => v.bytes > 0);
    const single = await adapter.hashMember(candidate, inspected, sample);
    assert.ok(mapped.get(single).includes(sample.name));
    const mislabeled = path.join(root, 'solid.zip');
    fs.copyFileSync(archive, mislabeled);
    const mislabeledCandidate = { ...candidate, archive: mislabeled };
    const mislabeledInspection = await adapter.inspect(mislabeledCandidate);
    assert.equal(mislabeledInspection.kind, '7z');
    assert.deepEqual(
      await adapter.hashArchive(
        mislabeledCandidate,
        mislabeledInspection,
        wanted,
      ),
      mapped,
    );
    const bad = structuredClone(inspected);
    bad.entries.find((v) => v.bytes > 0).crc32 = '00000000';
    await assert.rejects(
      adapter.hashArchive(candidate, bad, wanted),
      /boundary checksum/,
    );
    const controller = new AbortController();
    const pending = adapter.hashArchive(
      candidate,
      inspected,
      wanted,
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(fs.readdirSync(root).sort(), [
      'input',
      'solid.7z',
      'solid.zip',
    ]);
  },
);

test('archive listing rejects unsafe names, links, collisions, encryption and ambiguous metadata', () => {
  const record = (name, extra = '') =>
    `Path = ${name}\nSize = 4\nAttributes = A\nEncrypted = -\n${extra}`;
  for (const text of [
    record('../escape'),
    record('C:\\escape'),
    record('Data\\CON.txt'),
    record('Data\\name:stream'),
    record('same') + '\n' + record('SAME'),
    record('Data') + '\n' + record('Data/file'),
    record('safe', 'Symbolic Link = outside\n'),
    record('safe', 'Hard Link = outside\n'),
    record('safe', 'Alternate Stream = +\n'),
    record('safe', 'Size = 3\n'),
    record('safe').replace('Encrypted = -', 'Encrypted = +'),
    record('safe').replace('Attributes = A', 'Attributes = A lrwxrwxrwx'),
    record('unsafe\nname'),
    record('safe').replace('Size = 4', 'Size = 99999999999999999999'),
  ])
    assert.throws(() => parseListing(text));
  assert.deepEqual(parseListing(record('Data\\Safe.esp')), [
    {
      name: 'Data/Safe.esp',
      selector: 'Data\\Safe.esp',
      bytes: 4,
      directory: false,
    },
  ]);
  const rar = `7-Zip 26.04\n\n--\nPath = fixture.rar\nType = Rar5\nMultivolume = -\nVolumes = 1\n\n----------\n${record('Data\\Safe.esp', 'Symbolic Link = \nHard Link = \nCopy Link = \nSplit Before = -\nSplit After = -\n')}`;
  assert.equal(parseArchiveListing(rar, '.rar')[0].name, 'Data/Safe.esp');
  assert.equal(
    parseArchiveListing(rar + 'NT Security = \n', '.rar')[0].name,
    'Data/Safe.esp',
  );
  for (const unsafe of [
    rar.replace('Volumes = 1', 'Volumes = 2'),
    rar.replace('Multivolume = -', 'Multivolume = +'),
    rar.replace('Split After = -', 'Split After = +'),
    rar.replace('Type = Rar5', 'Type = zip'),
  ])
    assert.throws(() => parseArchiveListing(unsafe, '.rar'));
});

test(
  'real 7-Zip maps exact solid archive members without extracting files and rejects changed/encrypted inputs',
  { skip: !executable },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-sevenzip-'));
    const source = path.join(root, 'input'),
      archive = path.join(root, 'fixture.7z');
    fs.mkdirSync(path.join(source, 'Data'), { recursive: true });
    const files = [
      ['Data/Example.esp', Buffer.from('unchanged')],
      ['Data/Name[1].esp', Buffer.from('brackets')],
      ['Data/@literal.esp', Buffer.from('literal')],
    ];
    for (const [name, data] of files)
      fs.writeFileSync(path.join(source, name), data);
    execFileSync(executable, ['a', '-t7z', '-ms=on', '--', archive, 'Data'], {
      cwd: source,
      windowsHide: true,
      stdio: 'ignore',
    });
    const original = fs.readFileSync(archive),
      sevenZip = await createSevenZip(executable);
    const ledger = {
      kind: 'loadstone-source-ledger',
      schemaVersion: 1,
      mods: [
        {
          enabled: true,
          installedFiles: files.map(([name, data]) => ({
            path: name,
            ...fingerprint(data),
          })),
          archiveCandidates: [{ archive, ...fingerprint(original) }],
        },
      ],
    };
    const mapped = await mapArchiveSources(ledger, { sevenZip });
    assert.equal(mapped.mapping.matchedInstalledFiles, 3);
    assert.equal(mapped.mapping.issues.length, 0);
    for (let i = 0; i < files.length; i++)
      assert.equal(
        mapped.mods[0].installedFiles[i].sourceMatches[0].member,
        files[i][0],
      );
    assert.deepEqual(fs.readFileSync(archive), original);
    assert.deepEqual(fs.readdirSync(root).sort(), ['fixture.7z', 'input']);
    const inspected = await sevenZip.inspect(
      ledger.mods[0].archiveCandidates[0],
    );
    const activeController = new AbortController();
    const activeRead = sevenZip.hashMember(
      ledger.mods[0].archiveCandidates[0],
      inspected,
      inspected.entries.find((v) => !v.directory),
      activeController.signal,
    );
    activeController.abort();
    await assert.rejects(activeRead, { name: 'AbortError' });
    fs.appendFileSync(archive, 'changed');
    await assert.rejects(
      sevenZip.hashMember(
        ledger.mods[0].archiveCandidates[0],
        inspected,
        inspected.entries.find((v) => !v.directory),
      ),
      /changed/,
    );
    assert.equal(
      (await mapArchiveSources(ledger, { sevenZip })).mapping
        .matchedInstalledFiles,
      0,
    );
    const encrypted = path.join(root, 'encrypted.7z');
    execFileSync(
      executable,
      ['a', '-t7z', '-pfixture-password', '--', encrypted, 'Data'],
      { cwd: source, windowsHide: true, stdio: 'ignore' },
    );
    await assert.rejects(
      sevenZip.inspect({
        archive: encrypted,
        ...fingerprint(fs.readFileSync(encrypted)),
      }),
      /encrypted/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      mapArchiveSources(ledger, { sevenZip, signal: controller.signal }),
      { name: 'AbortError' },
    );
    assert.equal(mapped.installable, false);
    assert.equal(mapped.publicationApproved, false);
  },
);
