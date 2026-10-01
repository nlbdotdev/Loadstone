import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { childEnvironment } = require('../electron/child-environment.cjs');

test('child processes receive only the explicitly selected Nexus key, regardless of inherited casing', () => {
  // Do not inspect or alter any actual account credential.
  const inherited = {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    NEXUS_API_KEY: 'synthetic-uppercase',
    nexus_api_key: 'synthetic-lowercase',
    Nexus_Oauth_Info: 'synthetic-mixedcase',
    NEXUS_OAUTH_INFO: 'synthetic-oauth',
    LOADSTONE_FIXTURE: 'preserved',
  };
  const snapshot = { ...inherited };
  for (const key of [undefined, 'synthetic-selected']) {
    const env = childEnvironment(key, inherited);
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const names = Object.keys(process.env).filter(name => /^nexus_(api_key|oauth_info)$/i.test(name));
      console.log(JSON.stringify({ names, selected: process.env.NEXUS_API_KEY === 'synthetic-selected', preserved: process.env.LOADSTONE_FIXTURE === 'preserved' }));
    `,
      ],
      { env, encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    assert.equal(child.status, 0);
    assert.deepEqual(JSON.parse(child.stdout), {
      names: key ? ['NEXUS_API_KEY'] : [],
      selected: Boolean(key),
      preserved: true,
    });
    assert.deepEqual(inherited, snapshot);
  }
});
