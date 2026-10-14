import fs from 'node:fs';
import path from 'node:path';
import { bsaFixture } from './bsa-fixture.mjs';
import {
  createArchiveFixture,
  fingerprint,
} from './native-archive-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';

export async function createNativeBsaFixture(
  kind = 'zip-windows',
  options = {},
) {
  const content = Buffer.from('synthetic mesh'.repeat(1000));
  const files = [
    { path: 'Meshes/first.nif', data: content, compressed: false },
    { path: 'Meshes/shared.nif', data: content, alias: 0, compressed: false },
    {
      path: 'Textures/example.dds',
      data: Buffer.alloc(200000, 71),
      compressed: true,
    },
    { path: 'empty.bin', data: Buffer.alloc(0), compressed: false },
  ];
  const encoded = bsaFixture(files, 0x107);
  options.mutateBsa?.(encoded);
  const second = bsaFixture(
    [{ path: 'other.bin', data: 'second container' }],
    7,
  );
  const containers = [
    ['Data/Archive A.bsa', encoded.bytes],
    ['Data/Archive B.bsa', second.bytes],
  ];
  const f = await createArchiveFixture(kind, {
    extraFiles: [...containers, ...(options.extraFiles || [])],
    timestamps: true,
  });
  f.bsaOutputs = [];
  for (const [index, [container, bytes]] of containers.entries()) {
    for (const file of index
      ? [{ path: 'other.bin', data: Buffer.from('second container') }]
      : files) {
      const output = {
        path: `mods/BSA${index}/${file.path}`,
        ...fingerprint(Buffer.from(file.data)),
        mtimeMs: 946684800321,
        action: {
          type: 'extract-bsa104',
          source: 'original-archive',
          container: { member: container, ...fingerprint(bytes) },
          member: file.path,
        },
      };
      f.recipe.outputs.push(output);
      f.bsaOutputs.push(output);
    }
  }
  const duplicate = {
    ...f.bsaOutputs[0],
    path: 'mods/BSA0/duplicate.nif',
    mtimeMs: 946684801234,
  };
  f.recipe.outputs.push(duplicate);
  f.bsaOutputs.push(duplicate);
  f.packageFile = path.join(f.packages, 'bsa-fixture.loadstone');
  options.mutateRecipe?.(f.recipe);
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  f.selected.packageFile = f.packageFile;
  f.staging = path.join(f.root, 'staging');
  fs.mkdirSync(f.staging);
  return f;
}
