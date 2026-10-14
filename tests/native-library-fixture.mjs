import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { materializeNative } = require('../electron/native-materializer.cjs');
const fingerprint = (data) => ({
  bytes: Buffer.byteLength(data),
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});
export async function libraryFixture({ extraFiles = [], mtimes = {} } = {}) {
  const f = createNativeFixture({ mo2Config: true });
  f.recipe.outputs.find(
    (v) => v.action.type === 'mo2-config',
  ).action.executables[0].steamAppId = '22380';
  const game = 'MZ synthetic owned game; never execute';
  Object.assign(f.recipe.requirements[0].files[0], fingerprint(game));
  Object.assign(f.recipe.sources[0], fingerprint(game));
  Object.assign(f.recipe.outputs[0], fingerprint(game));
  const output = f.recipe.outputs.find((v) => v.path === 'ModOrganizer.exe');
  const source = f.recipe.sources.find((v) => v.id === output.action.source);
  const manager = 'MZ synthetic manager; never execute';
  Object.assign(source, fingerprint(manager));
  Object.assign(output, fingerprint(manager));
  fs.writeFileSync(path.join(f.payloads, source.sha256), manager);
  for (const [index, [name, content]] of extraFiles.entries()) {
    const locked = fingerprint(content),
      id = `extra-${index}`;
    fs.writeFileSync(path.join(f.payloads, locked.sha256), content);
    f.recipe.sources.push({ ...source, ...locked, id });
    f.recipe.outputs.push({
      path: name,
      ...locked,
      action: { type: 'copy', source: id },
    });
  }
  const settings = '[General]\nLocalSaves=true\nLocalSettings=true\n';
  const locked = fingerprint(settings);
  fs.writeFileSync(path.join(f.payloads, locked.sha256), settings);
  f.recipe.sources.push({ ...source, ...locked, id: 'profile-settings' });
  f.recipe.outputs.push({
    path: 'profiles/Test/settings.ini',
    ...locked,
    action: { type: 'copy', source: 'profile-settings' },
  });
  f.state = path.join(f.root, 'state');
  fs.mkdirSync(f.state);
  f.owned = path.join(f.root, 'owned');
  fs.mkdirSync(f.owned);
  fs.writeFileSync(path.join(f.owned, 'FalloutNV.exe'), game);
  f.destination = path.join(f.root, 'candidate');
  fs.mkdirSync(path.join(f.root, 'packages'));
  f.packageFile = path.join(f.root, 'packages', 'fixture.loadstone');
  for (const output of f.recipe.outputs)
    if (Object.hasOwn(mtimes, output.path))
      output.mtimeMs = mtimes[output.path];
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  await materializeNative(f.packageFile, f.destination, {
    games: { fnv: f.owned },
    archives: {},
  });
  return f;
}
