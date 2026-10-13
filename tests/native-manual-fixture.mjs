import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yazl from 'yazl';
import { pipeline } from 'node:stream/promises';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const fingerprint = (data) => ({
  bytes: data.length,
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});

export async function manualFixture() {
  const f = createNativeFixture();
  f.game = path.join(f.root, 'owned');
  f.parent = path.join(f.root, 'candidates');
  f.state = path.join(f.root, 'state');
  f.packages = path.join(f.root, 'packages');
  f.cache = path.join(f.state, 'native-downloads');
  for (const folder of [f.game, f.parent, f.cache, f.packages])
    fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.archive = path.join(f.packages, 'original.zip');
  const content = Buffer.alloc(2_000_000, 71);
  const zip = new yazl.ZipFile();
  zip.addBuffer(content, 'Data/example.esp', { compress: false });
  zip.end();
  await pipeline(
    zip.outputStream,
    fs.createWriteStream(f.archive, { flags: 'wx' }),
  );
  f.source = {
    id: 'nexus-original',
    type: 'nexus-archive',
    game: 'falloutnv',
    modId: 123,
    fileId: 456,
    ...fingerprint(fs.readFileSync(f.archive)),
    credit: {
      name: 'Synthetic fixture author',
      url: 'https://example.org/credits',
    },
  };
  f.recipe.sources.push(f.source);
  f.recipe.outputs.push({
    path: 'mods/Example/example.esp',
    ...fingerprint(content),
    action: {
      type: 'extract',
      source: f.source.id,
      member: 'Data/example.esp',
    },
  });
  f.packageFile = path.join(f.packages, 'manual.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  f.options = {
    discover: async () => ({
      games: [{ id: 'fnv', source: 'steam', folder: f.game }],
    }),
    defaultParent: () => f.parent,
    downloadCache: () => f.cache,
  };
  return f;
}
