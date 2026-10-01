import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  [
    'github-token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  ],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['credential-url', /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi],
  [
    'signed-or-secret-query',
    /[?&](?:api_?key|access_token|auth_token|signature|x-amz-signature|token)=[^\s&"'<>]{8,}/gi,
  ],
  [
    'personal-home-path',
    /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s\\/"']+|\/(?:Users|home)\/[^\s/"']+/g,
  ],
];

export function scanText(text) {
  const findings = [];
  for (const [rule, expression] of rules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      findings.push({
        rule,
        line: text.slice(0, match.index).split('\n').length,
      });
    }
  }
  return findings;
}
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
export function audit(cwd) {
  const commits = git(cwd, ['rev-list', '--all'])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  const objects = new Map();
  for (const commit of commits) {
    for (const record of git(cwd, ['ls-tree', '-r', '-z', commit])
      .toString()
      .split('\0')
      .filter(Boolean)) {
      const tab = record.indexOf('\t'),
        [mode, type, object] = record.slice(0, tab).split(' '),
        file = record.slice(tab + 1);
      if (type !== 'blob') continue;
      if (!objects.has(object)) objects.set(object, { paths: new Set(), mode });
      objects.get(object).paths.add(file);
    }
  }
  const findings = [],
    manualReview = [];
  let scannedTextBlobs = 0;
  for (const [object, details] of objects) {
    const paths = [...details.paths].sort(),
      size = Number(git(cwd, ['cat-file', '-s', object]).toString());
    for (const file of paths) {
      if (
        /(^|\/)(?:\.env(?:\..*)?|nexus\.bin|nexus-oauth-info|credentials?\.json|id_rsa|id_ed25519)$/i.test(
          file,
        )
      )
        findings.push({
          rule: 'sensitive-filename',
          object,
          paths: [file],
          line: null,
        });
    }
    if (size > 8 * 1024 * 1024) {
      manualReview.push({ object, paths, bytes: size, reason: 'over-8-MiB' });
      continue;
    }
    const data = git(cwd, ['cat-file', 'blob', object]);
    if (data.includes(0)) {
      manualReview.push({
        object,
        paths,
        bytes: size,
        sha256: digest(data),
        reason: 'binary-content',
      });
      continue;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      manualReview.push({ object, paths, bytes: size, reason: 'non-UTF8' });
      continue;
    }
    scannedTextBlobs++;
    for (const finding of scanText(text))
      findings.push({ ...finding, object, paths });
  }
  const head = git(cwd, ['rev-parse', 'HEAD']).toString().trim();
  const currentBlobs = new Set(
    git(cwd, ['ls-tree', '-r', 'HEAD'])
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[2]),
  );
  for (const finding of findings)
    finding.inHead = currentBlobs.has(finding.object);
  return {
    schemaVersion: 1,
    head,
    scope: 'All commits reachable from local Git refs; unique file blobs only.',
    commits: commits.length,
    uniqueBlobs: objects.size,
    scannedTextBlobs,
    findings,
    manualReview,
    limitations: [
      'No network fetch; audit available refs after fetching the intended publication history.',
      'Working-tree edits, unreachable objects, commit messages, author identities and release assets require separate review.',
      'Pattern matches include synthetic fixtures and need human classification. No entropy or provider-side credential validation is performed.',
      'Binary images and other unscanned blobs require manual review, including metadata.',
      'No matched values or line excerpts are emitted. A clean report is not publication approval.',
    ],
    publicationApproved: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length > 2)
    throw new Error('Run without arguments from the repository root.');
  const report = audit(process.cwd());
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(
    'test-results/publication-audit.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        commits: report.commits,
        uniqueBlobs: report.uniqueBlobs,
        findings: report.findings.length,
        findingsInHead: report.findings.filter((x) => x.inHead).length,
        manualReview: report.manualReview.length,
        report: 'test-results/publication-audit.json',
        publicationApproved: false,
      },
      null,
      2,
    ),
  );
}
