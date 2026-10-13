import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const fingerprint = (data) => ({
  bytes: Buffer.byteLength(data),
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});
export function createNativeFixture() {
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
