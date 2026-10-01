import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanText, audit } from '../scripts/audit-publication.mjs';
test('publication patterns report locations without reproducing matched values', () => {
  const token = 'ghp_' + 'X'.repeat(36);
  const input = [
    'ordinary text',
    token,
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'https://' + 'user:password@example.invalid',
    'https://example.invalid?token=' + 'synthetic-canary-value',
  ].join('\n');
  const findings = scanText(input);
  assert.deepEqual(
    findings.map((x) => x.rule).sort(),
    [
      'credential-url',
      'github-token',
      'private-key',
      'signed-or-secret-query',
    ].sort(),
  );
  assert.equal(findings.find((x) => x.rule === 'github-token').line, 2);
  assert.equal(JSON.stringify(findings).includes(token), false);
  assert.equal(
    JSON.stringify(findings).includes('synthetic-canary-value'),
    false,
  );
});
test('publication audit detects deleted historical content and flags sensitive binary filenames', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-audit-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  git('init');
  git('config', 'user.name', 'Audit fixture');
  git('config', 'user.email', 'audit@example.invalid');
  const token = 'ghp_' + 'Z'.repeat(36);
  fs.writeFileSync(path.join(root, 'old.txt'), token);
  git('add', '.');
  git('commit', '-m', 'Fixture one');
  fs.unlinkSync(path.join(root, 'old.txt'));
  fs.writeFileSync(path.join(root, 'nexus.bin'), Buffer.from([0, 1, 2, 3]));
  git('add', '-A');
  git('commit', '-m', 'Fixture two');
  const result = audit(root);
  assert.equal(result.commits, 2);
  assert.equal(
    result.findings.find((x) => x.rule === 'github-token').inHead,
    false,
  );
  assert.equal(
    result.findings.find((x) => x.rule === 'sensitive-filename').inHead,
    true,
  );
  assert.equal(result.manualReview[0].reason, 'binary-content');
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.publicationApproved, false);
});
