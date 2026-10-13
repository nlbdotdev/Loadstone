import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { acquireArchives } = require('../electron/native-downloads.cjs');
const {
  publicAddress,
  publicLookup,
  downloadUrl,
  openResponse,
  archiveResponse,
} = require('../electron/native-network.cjs');
const fingerprint = (bytes) => ({
  bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
});
const sourceFor = (bytes) => ({
  id: 'archive',
  type: 'https-archive',
  url: 'https://example.org/archive',
  ...fingerprint(bytes),
});
function response(bytes, statusCode = 200, headers = {}) {
  const stream = Readable.from([Buffer.from(bytes)]);
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}
function fixture(bytes = Buffer.from('synthetic downloaded archive')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-download-'));
  return {
    root,
    cache: path.join(root, 'cache'),
    bytes,
    recipe: { sources: [sourceFor(bytes)] },
  };
}
test('download network rejects local/reserved addresses and pins checked DNS without disabling TLS', async () => {
  for (const ip of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.9.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.19.0.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:0808:0808::1',
    '3fff::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of [
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(publicAddress(ip), true, ip);
  for (const url of [
    'http://example.org/file',
    'https://127.1/file',
    'https://[::1]/file',
    'https://example.org:444/file',
    'https://key@example.org/file',
    'https://example.org/file#fragment',
  ])
    assert.throws(() => downloadUrl(url));
  const originalLookup = dns.lookup;
  const originalGet = https.get;
  try {
    const lookup = (all) =>
      new Promise((resolve, reject) =>
        publicLookup('example.org', { all }, (error, address, family) =>
          error ? reject(error) : resolve({ address, family }),
        ),
      );
    dns.lookup = (_host, options, callback) => {
      assert.equal(options.all, true);
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
    };
    await assert.rejects(lookup(true), /public addresses/);
    dns.lookup = (_host, _options, callback) =>
      callback(null, [{ address: '8.8.8.8', family: 4 }]);
    assert.deepEqual(await lookup(false), { address: '8.8.8.8', family: 4 });
    assert.deepEqual((await lookup(true)).address, [
      { address: '8.8.8.8', family: 4 },
    ]);
    https.get = (url, options, callback) => {
      assert.equal(url.hostname, 'example.org');
      assert.equal(options.agent, false);
      assert.equal(options.lookup, publicLookup);
      assert.equal(options.rejectUnauthorized, undefined);
      assert.equal(options.headers['Accept-Encoding'], 'identity');
      const request = new EventEmitter();
      request.setTimeout = () => {};
      queueMicrotask(() => callback(response('ok')));
      return request;
    };
    (await openResponse('https://example.org/file')).destroy();
  } finally {
    dns.lookup = originalLookup;
    https.get = originalGet;
  }
});
test('redirects are bounded and revalidated without authentication headers', async () => {
  let calls = 0;
  await assert.rejects(
    archiveResponse(
      'https://example.org/file',
      undefined,
      async (_url, options) => {
        calls++;
        assert.equal(options.headers, undefined);
        return response('', 302, { location: 'https://127.0.0.1/secret' });
      },
    ),
    /unsupported address/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    archiveResponse('https://example.org/file', undefined, async () => {
      calls++;
      return response('', 302, { location: '/again' });
    }),
    /too many/,
  );
  assert.equal(calls, 6);
  const ok = await archiveResponse(
    'https://example.org/file',
    undefined,
    async (url) =>
      url.endsWith('/file')
        ? response('', 302, {
            location: 'https://cdn.example.org/result?token=synthetic',
          })
        : response('ok'),
  );
  assert.equal(
    (await Array.fromAsync(ok)).map((v) => v.toString()).join(''),
    'ok',
  );
});
test('archive acquisition streams, verifies and exclusively caches bytes; retry rehashes without networking', async () => {
  const f = fixture(Buffer.alloc(1000000, 67)),
    events = [];
  const result = await acquireArchives(f.recipe, { archive: null }, f.cache, {
    activity: (v) => events.push(v),
    request: async (_url, options) => {
      assert.equal(options.headers, undefined);
      return response(f.bytes, 200, {
        'content-length': String(f.bytes.length),
      });
    },
  });
  assert.deepEqual(fs.readFileSync(result.archive), f.bytes);
  assert.deepEqual(fs.readdirSync(f.cache), [
    `${f.recipe.sources[0].sha256}.archive`,
  ]);
  assert.equal(events.at(-1).completed, 1);
  assert.equal(events.at(-1).bytes, f.bytes.length);
  assert.equal(JSON.stringify(events).includes(f.root), false);
  const again = await acquireArchives(f.recipe, { archive: null }, f.cache, {
    request: async () => {
      throw new Error('must not fetch');
    },
  });
  assert.deepEqual(again, result);
  fs.writeFileSync(result.archive, Buffer.alloc(f.bytes.length, 68));
  await assert.rejects(
    acquireArchives(f.recipe, { archive: null }, f.cache),
    /cached archive differs/,
  );
  assert.deepEqual(
    fs.readFileSync(result.archive),
    Buffer.alloc(f.bytes.length, 68),
  );
});
test('wrong hashes, oversize/truncated responses, rate limits and cancellation do not publish partial cache files', async () => {
  for (const request of [
    async () => response('wrong'),
    async () => response(Buffer.alloc(200)),
    async () => response('short', 200, { 'content-length': '999' }),
    async () => response('', 429),
    async () => response('data', 200, { 'content-encoding': 'gzip' }),
    async () => {
      const stream = response('');
      queueMicrotask(() => stream.destroy(new Error('synthetic-secret')));
      return stream;
    },
  ]) {
    const f = fixture();
    await assert.rejects(
      acquireArchives(f.recipe, { archive: null }, f.cache, { request }),
      (error) => !error.message.includes('synthetic-secret'),
    );
    assert.deepEqual(fs.readdirSync(f.cache), []);
  }
  const f = fixture(),
    controller = new AbortController();
  await assert.rejects(
    acquireArchives(f.recipe, { archive: null }, f.cache, {
      signal: controller.signal,
      request: async () => {
        const stream = Readable.from(
          (async function* () {
            yield f.bytes.subarray(0, 5);
            await new Promise((resolve) => setTimeout(resolve, 300));
            yield f.bytes.subarray(5);
          })(),
        );
        stream.statusCode = 200;
        stream.headers = {};
        return stream;
      },
      activity: (v) => {
        if (v.bytes > 0 && v.completed === 0) controller.abort();
      },
    }),
  );
  assert.deepEqual(fs.readdirSync(f.cache), []);
});
test('Nexus uses freshly verified Premium and sends credentials only to the API; cache retry needs no key', async () => {
  const f = fixture();
  f.recipe.sources[0] = {
    ...f.recipe.sources[0],
    type: 'nexus-archive',
    game: 'falloutnv',
    modId: 123,
    fileId: 456,
  };
  delete f.recipe.sources[0].url;
  let verified = false,
    calls = 0;
  const nexus = {
    verify: async () => {
      verified = true;
    },
    read: () => {
      assert.ok(verified);
      return { key: 'synthetic-secret', premium: true };
    },
  };
  const request = async (url, options) => {
    calls++;
    if (url.startsWith('https://api.nexusmods.com/')) {
      assert.match(
        url,
        /\/games\/falloutnv\/mods\/123\/files\/456\/download_link\.json$/,
      );
      assert.equal(options.headers.apikey, 'synthetic-secret');
      assert.equal(options.headers['Application-Name'], 'Loadstone');
      return response(
        JSON.stringify([
          { URI: 'https://cdn.example.org/archive?token=synthetic' },
        ]),
      );
    }
    assert.equal(options.headers, undefined);
    return response(f.bytes);
  };
  const result = await acquireArchives(f.recipe, { archive: null }, f.cache, {
    nexus,
    request,
  });
  assert.equal(calls, 2);
  assert.deepEqual(fs.readFileSync(result.archive), f.bytes);
  assert.deepEqual(
    await acquireArchives(f.recipe, { archive: null }, f.cache),
    result,
  );
  for (const premium of [false, undefined]) {
    const other = fixture();
    other.recipe = f.recipe;
    await assert.rejects(
      acquireArchives(other.recipe, { archive: null }, other.cache, {
        nexus: {
          verify: async () => {},
          read: () => ({ premium, key: 'synthetic-secret' }),
        },
        request: async () => {
          throw new Error('must not request links');
        },
      }),
      /require Premium/,
    );
  }
  const other = fixture();
  other.recipe = f.recipe;
  await assert.rejects(
    acquireArchives(other.recipe, { archive: null }, other.cache, {
      nexus,
      request: async () =>
        response('', 302, { location: 'https://example.org/key' }),
    }),
    /Nexus refused/,
  );
});

test('redirected cache, low disk space, write errors and publication conflicts preserve unrelated files', async () => {
  const redirected = fixture();
  const outside = path.join(redirected.root, 'unrelated');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'preserve');
  fs.symlinkSync(outside, redirected.cache, 'junction');
  await assert.rejects(
    acquireArchives(redirected.recipe, { archive: null }, redirected.cache),
    /ordinary local directory/,
  );
  assert.deepEqual(fs.readdirSync(outside), ['keep.txt']);
  const low = fixture(),
    originalStatfs = fs.statfsSync;
  try {
    fs.statfsSync = () => ({ bavail: 0, bsize: 4096 });
    await assert.rejects(
      acquireArchives(low.recipe, { archive: null }, low.cache),
      /free space/,
    );
  } finally {
    fs.statfsSync = originalStatfs;
  }
  assert.deepEqual(fs.readdirSync(low.cache), []);
  const failed = fixture(),
    originalWrite = fs.write;
  try {
    fs.write = (...args) =>
      args.at(-1)(new Error('fixture private disk error'));
    await assert.rejects(
      acquireArchives(failed.recipe, { archive: null }, failed.cache, {
        request: async () => response(failed.bytes),
      }),
      (error) => !error.message.includes('private disk'),
    );
  } finally {
    fs.write = originalWrite;
  }
  assert.deepEqual(fs.readdirSync(failed.cache), []);
  // A competing cache entry appears after the existence check. It must never
  // be replaced by rename, even when our download hash is correct.
  const conflict = fixture();
  const existing = path.join(
    conflict.cache,
    `${conflict.recipe.sources[0].sha256}.archive`,
  );
  await assert.rejects(
    acquireArchives(conflict.recipe, { archive: null }, conflict.cache, {
      request: async () => {
        fs.writeFileSync(existing, 'preserve competing content');
        return response(conflict.bytes);
      },
    }),
  );
  assert.equal(fs.readFileSync(existing, 'utf8'), 'preserve competing content');
  assert.deepEqual(fs.readdirSync(conflict.cache), [path.basename(existing)]);
});
