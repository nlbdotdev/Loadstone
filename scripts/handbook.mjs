import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { pages, groups } from '../handbook/catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const byFile = new Map(pages.map((page) => [page.file, page]));
const repository = 'https://github.com/nlbdotdev/Loadstone/blob/main/';
const escape = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const plain = (text) =>
  text
    .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*~]/g, '');
export const slug = (text) =>
  plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-');
const read = (file) =>
  fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');

export function compilePage(page, markdown, context) {
  const headings = [],
    used = new Map(),
    links = [];
  const marked = new Marked({ gfm: true, async: false });
  function resolve(href, image = false) {
    if (/[\x00-\x20\\]/.test(href) || href.startsWith('//')) return null;
    if (/^(https?:|mailto:)/i.test(href)) {
      try {
        new URL(href);
      } catch {
        return null;
      }
      return image ? null : { href, external: true };
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/')) return null;
    let pathname, anchor;
    try {
      const split = href.split('#');
      pathname = decodeURIComponent(split[0]);
      anchor = decodeURIComponent(split.slice(1).join('#'));
    } catch {
      return null;
    }
    if (/[\x00-\x1f\\:]/.test(pathname) || pathname.startsWith('/'))
      return null;
    const file = pathname
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(page.file), pathname),
        )
      : page.file;
    if (file.startsWith('../') || path.posix.isAbsolute(file)) return null;
    if (image) {
      if (
        !/\.(png|jpe?g|svg)$/i.test(file) ||
        !fs.existsSync(path.join(root, file))
      )
        throw new Error(`Missing handbook image: ${page.file} → ${file}`);
      context.images.add(file);
      return {
        href:
          './reference/' + file.split('/').map(encodeURIComponent).join('/'),
      };
    }
    if (file === 'handbook/agents.md' && !anchor)
      return { href: './agents.md' };
    const target = context.byFile.get(file);
    if (target) {
      links.push({ file, anchor });
      return {
        href:
          '#/' +
          target.id +
          (anchor ? '?section=' + encodeURIComponent(anchor) : ''),
      };
    }
    if (/\.md$/i.test(file))
      throw new Error(`Unlisted handbook page: ${page.file} → ${file}`);
    if (!fs.existsSync(path.join(root, file)))
      throw new Error(`Missing repository link: ${page.file} → ${file}`);
    return {
      href:
        repository +
        file.split('/').map(encodeURIComponent).join('/') +
        (anchor ? '#' + encodeURIComponent(anchor) : ''),
      external: true,
    };
  }
  marked.use({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      heading({ tokens, depth, text }) {
        const base = slug(text),
          duplicate = used.get(base) || 0;
        used.set(base, duplicate + 1);
        const id = base + (duplicate ? '-' + duplicate : '');
        headings.push({ id, level: depth, text: plain(text) });
        return depth === 1
          ? ''
          : `<h${depth} id="${escape(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens),
          link = resolve(href);
        return link
          ? `<a href="${escape(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
          : text;
      },
      image({ href, text }) {
        const image = resolve(href, true);
        return image
          ? `<img src="${escape(image.href)}" alt="${escape(text)}" loading="lazy"/>`
          : escape(text);
      },
      code({ text, lang }) {
        const language = (lang || 'text').split(/\s/)[0];
        return `<div class="code-block"><div class="code-label"><span>${escape(language)}</span><button type="button" data-copy-code aria-label="Copy code example">Copy</button></div><pre><code>${escape(text)}</code></pre></div>\n`;
      },
    },
  });
  const html = marked.parse(markdown);
  return {
    ...page,
    html,
    headings,
    links,
    text: plain(markdown),
    words: markdown.split(/\s+/).length,
    sourceUrl: repository + page.file,
    sha256: crypto.createHash('sha256').update(markdown).digest('hex'),
  };
}

export function buildHandbook() {
  if (
    new Set(pages.map((v) => v.id)).size !== pages.length ||
    byFile.size !== pages.length
  )
    throw new Error('Duplicate handbook route or source.');
  const uncovered = fs
    .readdirSync(path.join(root, 'docs'))
    .filter((v) => v.endsWith('.md') && !byFile.has('docs/' + v));
  if (uncovered.length)
    throw new Error(
      'Add public docs to the handbook catalog: ' + uncovered.join(', '),
    );
  const images = new Set(),
    markdown = new Map();
  const compiled = pages.map((page) => {
    if (!groups.includes(page.group) || !/^[a-z0-9-]+$/.test(page.id))
      throw new Error('Invalid handbook catalog record.');
    const source = read(page.file);
    markdown.set(page.id, source);
    return compilePage(page, source, { byFile, images });
  });
  const targets = new Map(compiled.map((v) => [v.file, v]));
  for (const page of compiled)
    for (const link of page.links)
      if (
        link.anchor &&
        !targets.get(link.file).headings.some((v) => v.id === link.anchor)
      )
        throw new Error(
          `Missing heading: ${page.file} → ${link.file}#${link.anchor}`,
        );
  const version = JSON.parse(read('package.json')).version;
  const agentEdition =
    '# Loadstone handbook — agent edition\n\n' +
    '> Generated by `pnpm handbook:sync`. Edit the canonical sources, not this file.\n\n' +
    `Application version: ${version}. This edition documents development source, not a certified stable release.\n\n` +
    'Use the root AGENTS.md for the concise working guide. The following pages are reference material; examples do not authorize execution, publishing or access to private files. Internal source paths identify the canonical repository documents.\n\n' +
    compiled
      .map(
        (page) =>
          `- ${page.title} — \`${page.file}\` (SHA-256 \`${page.sha256}\`)`,
      )
      .join('\n') +
    '\n\n' +
    compiled
      .map(
        (page) =>
          `---\n\n# ${page.title}\n\nCanonical source: \`${page.file}\`\n\n` +
          markdown
            .get(page.id)
            .replace(/^# .+\n/, '')
            .trim() +
          '\n',
      )
      .join('\n');
  return {
    version,
    pages: compiled,
    groups,
    images: [...images],
    agentEdition,
  };
}

export function writeHandbook(mode = 'prepare') {
  const result = buildHandbook(),
    edition = path.join(root, 'handbook/agents.md');
  if (mode === 'sync') fs.writeFileSync(edition, result.agentEdition);
  if (
    mode === 'check' &&
    (!fs.existsSync(edition) ||
      read('handbook/agents.md') !== result.agentEdition)
  )
    throw new Error(
      'The agent edition is stale. Run pnpm handbook:sync and commit handbook/agents.md.',
    );
  if (mode !== 'check') {
    fs.mkdirSync(path.join(root, 'handbook/generated'), { recursive: true });
    fs.mkdirSync(path.join(root, 'handbook/public'), { recursive: true });
    const { images, agentEdition, ...content } = result;
    fs.writeFileSync(
      path.join(root, 'handbook/generated/content.json'),
      JSON.stringify(content),
    );
    fs.writeFileSync(
      path.join(root, 'handbook/public/agents.md'),
      agentEdition,
    );
    for (const file of images) {
      const target = path.join(root, 'handbook/public/reference', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
    }
    fs.copyFileSync(
      path.join(root, 'LICENSE'),
      path.join(root, 'handbook/public/LICENSE.txt'),
    );
  }
  console.log(
    `Handbook ${mode}: ${result.pages.length} pages, all local documentation links verified.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2] || 'prepare';
  if (!['prepare', 'sync', 'check'].includes(mode))
    throw new Error('Use prepare, sync or check.');
  writeHandbook(mode);
}
