import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
