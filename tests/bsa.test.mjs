import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { bsaFixture } from './bsa-fixture.mjs';
const require = createRequire(import.meta.url);
const { inspectBsa104 } = require('../electron/bsa104.cjs');
const fingerprint = (bytes) => ({
  bytes: Buffer.byteLength(bytes),
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
});
function fixture(t, encoded) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-bsa-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'cache', 'test.bsa');
  fs.mkdirSync(path.dirname(input));
  fs.writeFileSync(input, encoded.bytes);
  return { root, input };
}

test('BSA 104 inspection hashes compressed, uncompressed, toggled, empty and shared content without writing payloads', async (t) => {
  for (const flags of [3, 7, 0x83, 0x103, 0x107]) {
    const encoded = bsaFixture(
      [
        { path: 'Meshes/first.nif', data: 'synthetic mesh', compressed: false },
        { path: 'Meshes/second.nif', alias: 0, compressed: false },
        {
          path: 'Textures/compressed.dds',
          data: 'texture'.repeat(3000),
          compressed: true,
        },
        {
          path: 'Textures/plain.dds',
          data: 'plain texture',
          compressed: false,
        },
        { path: 'empty.txt', data: '', compressed: false },
        { path: 'empty-zlib.txt', data: '', compressed: true },
      ],
      flags,
    );
    const { root, input } = fixture(t, encoded),
      before = fs.statSync(input);
    const report = await inspectBsa104(input, {
      expected: fingerprint(encoded.bytes),
    });
    assert.deepEqual(report.archive, fingerprint(encoded.bytes));
    assert.deepEqual(report.members, [
      { path: 'Meshes/first.nif', ...fingerprint('synthetic mesh') },
      { path: 'Meshes/second.nif', ...fingerprint('synthetic mesh') },
      {
        path: 'Textures/compressed.dds',
        ...fingerprint('texture'.repeat(3000)),
      },
      { path: 'Textures/plain.dds', ...fingerprint('plain texture') },
      { path: 'empty.txt', ...fingerprint('') },
      { path: 'empty-zlib.txt', ...fingerprint('') },
    ]);
    assert.equal(report.sharedExtents, 1);
    assert.equal(report.installable, false);
    assert.equal(report.publicationApproved, false);
    assert.equal(report.totalBytes, 21041);
    assert.equal(fs.statSync(input).mtimeMs, before.mtimeMs);
    assert.deepEqual(fs.readFileSync(input), encoded.bytes);
    assert.deepEqual(fs.readdirSync(root), ['cache']);
    assert.deepEqual(fs.readdirSync(path.dirname(input)), ['test.bsa']);
  }
});

test('BSA inspection rejects unsupported, unsafe and inconsistent indexes as a whole', async (t) => {
  const mutations = [
    (b) => b.bytes.write('BA2\0'),
    (b) => b.bytes.writeUInt32LE(105, 4),
    (b) => b.bytes.writeUInt32LE(37, 8),
    (b) => b.bytes.writeUInt32LE(0x203, 12),
    (b) => b.bytes.writeUInt32LE(1, 12),
    (b) => b.bytes.writeUInt32LE(500001, 20),
    (b) => b.bytes.writeUInt32LE(0xffffffff, 28),
    (b) => b.bytes.writeUInt32LE(123, 48),
    (b) => b.bytes.writeUInt32LE(5, 44),
    (b) => b.bytes.writeUInt32LE(0x80000003, b.records[0] + 8),
    (b) => b.bytes.writeUInt32LE(b.metaEnd - 1, b.records[0] + 12),
    (b) => b.bytes.writeUInt32LE(b.bytes.length - 1, b.records[0] + 12),
    (b) => b.bytes.writeUInt32LE(b.entries[0].offset + 1, b.records[1] + 12),
    (b) => b.bytes.writeUInt32LE(0, b.records[0] + 8),
    (b) => {
      b.bytes[b.namesOffset] = 0xe9;
    },
    (b) => {
      b.bytes[b.metaEnd - 1] = 0x41;
    },
  ];
  for (const mutate of mutations) {
    const encoded = bsaFixture(
      [
        { path: 'Meshes/a.nif', data: 'abc' },
        { path: 'Meshes/b.nif', data: 'def' },
      ],
      0x103,
    );
    mutate(encoded);
    await assert.rejects(
      inspectBsa104(fixture(t, encoded).input),
      undefined,
      String(mutate),
    );
  }
  for (const paths of [
    ['../a.txt'],
    ['C:/a.txt'],
    ['//a.txt'],
    ['a/NUL.txt'],
    ['a./b.txt'],
    ['a/../b.txt'],
    ['a//b.txt'],
    ['a.txt', 'A.txt'],
    ['A/one.txt', 'a/two.txt'],
    ['a', 'a/b.txt'],
    ['a/b', 'a/b/c.txt'],
    ['a/b.txt', 'a\\b.txt'],
    ['a\0b.txt'],
  ]) {
    const encoded = bsaFixture(paths.map((p) => ({ path: p, data: 'abc' })));
    await assert.rejects(
      inspectBsa104(fixture(t, encoded).input),
      undefined,
      paths.join(', '),
    );
  }
  const shared = bsaFixture([
    { path: 'a.txt', data: 'abc' },
    { path: 'b.txt', alias: 0 },
  ]);
  shared.bytes.writeUInt32LE(
    shared.entries[0].size | 0x40000000,
    shared.records[1] + 8,
  );
  await assert.rejects(inspectBsa104(fixture(t, shared).input), /conflicting/);
});

test('BSA inspection rejects truncated, corrupt, trailing and oversized compressed data', async (t) => {
  for (const change of [
    'truncated',
    'corrupt',
    'trailing',
    'short-size',
    'long-size',
    'oversized',
  ]) {
    const encoded = bsaFixture([
      { path: 'sample.txt', data: 'synthetic'.repeat(100), compressed: true },
    ]);
    const start = encoded.entries[0].offset;
    if (change === 'truncated') encoded.bytes = encoded.bytes.subarray(0, -1);
    if (change === 'corrupt') encoded.bytes[start + 6] ^= 0xff;
    if (change === 'trailing') {
      encoded.bytes = Buffer.concat([encoded.bytes, Buffer.from('extra')]);
      encoded.bytes.writeUInt32LE(
        (encoded.entries[0].size + 5) | 0x40000000,
        encoded.records[0] + 8,
      );
    }
    if (change === 'short-size') encoded.bytes.writeUInt32LE(1, start);
    if (change === 'long-size') encoded.bytes.writeUInt32LE(901, start);
    if (change === 'oversized')
      encoded.bytes.writeUInt32LE(1_000_000_001, start);
    await assert.rejects(
      inspectBsa104(fixture(t, encoded).input),
      undefined,
      change,
    );
  }
  const many = bsaFixture(
    Array.from({ length: 21 }, (_, i) => ({
      path: `${i}.txt`,
      data: '',
      compressed: true,
      ...(i ? { alias: 0 } : {}),
    })),
  );
  many.bytes.writeUInt32LE(1_000_000_000, many.entries[0].offset);
  await assert.rejects(inspectBsa104(fixture(t, many).input), /limits/);
});

test('BSA fingerprint changes, cancellation and concurrent changes never return partial evidence', async (t) => {
  const encoded = bsaFixture(
    Array.from({ length: 1001 }, (_, i) => ({
      path: `file${i}.txt`,
      data: 'abc',
      ...(i ? { alias: 0 } : {}),
    })),
  );
  const { input } = fixture(t, encoded);
  await assert.rejects(
    inspectBsa104(input, {
      expected: { bytes: encoded.bytes.length, sha256: '0'.repeat(64) },
    }),
    /fingerprint/,
  );
  await assert.rejects(inspectBsa104(input, { signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
  const controller = new AbortController();
  await assert.rejects(
    inspectBsa104(input, {
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    inspectBsa104(input, {
      progress: () => {
        const stat = fs.statSync(input);
        fs.utimesSync(input, stat.atime, new Date(stat.mtimeMs + 10000));
      },
    }),
    /changed/,
  );
});

test('BSA CLI writes only a new private report after success and protects source/existing outputs', (t) => {
  const { root, input } = fixture(
    t,
    bsaFixture([{ path: 'a.txt', data: 'example' }]),
  );
  const output = path.join(root, 'reports', 'inventory.json');
  function run(target, source = input) {
    return spawnSync(
      process.execPath,
      ['scripts/inspect-bsa.mjs', source, target],
      { encoding: 'utf8', timeout: 15000 },
    );
  }
  assert.equal(run(output).status, 0);
  const original = fs.readFileSync(output);
  assert.equal(
    JSON.parse(original).members[0].sha256,
    fingerprint('example').sha256,
  );
  assert.ok(!original.includes(Buffer.from(input)));
  assert.notEqual(run(output).status, 0);
  assert.deepEqual(fs.readFileSync(output), original);
  const forbidden = path.join(path.dirname(input), 'report.json');
  assert.notEqual(run(forbidden).status, 0);
  assert.equal(fs.existsSync(forbidden), false);
  fs.writeFileSync(input, 'invalid');
  const failed = path.join(root, 'failed', 'report.json');
  assert.notEqual(run(failed).status, 0);
  assert.equal(fs.existsSync(failed), false);
});
