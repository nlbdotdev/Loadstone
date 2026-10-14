import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';

export const fingerprint = (data) => ({
  bytes: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});
const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const vint = (number) => {
  const bytes = [];
  do {
    const low = number % 128;
    number = Math.floor(number / 128);
    bytes.push(low | (number ? 128 : 0));
  } while (number);
  return Buffer.from(bytes);
};
// Original test-only stored RAR5 encoder from the published format description:
// https://www.rarlab.com/technote.htm. No third-party archive or encoder is copied.
export function storedRar5(files) {
  const header = (...fields) => {
    const body = Buffer.concat(fields);
    const checked = Buffer.concat([vint(body.length), body]);
    return Buffer.concat([uint32(crc32(checked)), checked]);
  };
  const parts = [
    Buffer.from('526172211a070100', 'hex'),
    header(vint(1), vint(0), vint(0)),
  ];
  for (const [name, data] of files) {
    const encoded = Buffer.from(name);
    parts.push(
      header(
        vint(2),
        vint(2),
        vint(data.length),
        vint(4),
        vint(data.length),
        vint(32),
        uint32(crc32(data)),
        vint(0),
        vint(0),
        vint(encoded.length),
        encoded,
      ),
      data,
    );
  }
  parts.push(header(vint(5), vint(0), vint(0)));
  return Buffer.concat(parts);
}

export async function createArchiveFixture(
  kind = '7z',
  { encrypted = false, extraFiles = [], timestamps = false } = {},
) {
  const f = createNativeFixture();
  f.game = path.join(f.root, 'owned');
  f.packages = path.join(f.root, 'packages');
  f.parent = path.join(f.root, 'candidates');
  f.state = path.join(f.root, 'state');
  for (const folder of [f.game, f.packages, f.parent]) fs.mkdirSync(folder);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.files = new Map([
    ['Data/00-empty.txt', Buffer.alloc(0)],
    ['Data/A[1].esp', Buffer.alloc(2_000_000, 71)],
    ['Data/ü-settings.ini', Buffer.from('original unicode file')],
    ['Data/@literal.txt', Buffer.from('literal member selector')],
  ]);
  const allFiles = new Map([
    ...f.files,
    ['Data/unused.bin', Buffer.alloc(500000, 88)],
    ...extraFiles,
  ]);
  f.archive = path.join(f.packages, `source.${kind === '7z' ? '7z' : 'rar'}`);
  if (kind === '7z') {
    const input = path.join(f.root, 'archive-input');
    for (const [name, data] of allFiles) {
      fs.mkdirSync(path.dirname(path.join(input, name)), { recursive: true });
      fs.writeFileSync(path.join(input, name), data);
    }
    execFileSync(
      process.env.LOADSTONE_TEST_7ZIP,
      [
        'a',
        '-t7z',
        '-ms=on',
        ...(encrypted ? ['-pfixture-password'] : []),
        '--',
        f.archive,
        '.',
      ],
      { cwd: input, windowsHide: true, stdio: 'ignore' },
    );
  } else fs.writeFileSync(f.archive, storedRar5(allFiles));
  f.recipe.sources.push({
    id: 'original-archive',
    type: 'https-archive',
    url: 'https://example.org/original',
    ...fingerprint(fs.readFileSync(f.archive)),
    credit: { name: 'Fixture author', url: 'https://example.org/credits' },
  });
  for (const [member, data] of f.files)
    f.recipe.outputs.push({
      path: `mods/Example/${member}`,
      ...fingerprint(data),
      action: { type: 'extract', source: 'original-archive', member },
    });
  const repeated = f.recipe.outputs.find(
    (v) => v.action.member === 'Data/A[1].esp',
  );
  f.recipe.outputs.push({ ...repeated, path: 'mods/Second/copy.esp' });
  f.packageFile = path.join(f.packages, 'fixture.loadstone');
  if (timestamps)
    for (const [index, output] of f.recipe.outputs.entries())
      output.mtimeMs = 946684800123 + index * 86400000;
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  f.options = {
    games: { fnv: f.game },
    archives: { 'original-archive': f.archive },
  };
  f.inputsFile = path.join(f.packages, 'inputs.json');
  fs.writeFileSync(f.inputsFile, JSON.stringify(f.options));
  f.selected = {
    packageFile: f.packageFile,
    inputsFile: f.inputsFile,
    parent: f.parent,
  };
  f.destination = path.join(f.parent, 'candidate');
  return f;
}
