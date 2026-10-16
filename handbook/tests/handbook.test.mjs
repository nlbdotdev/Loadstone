import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron } from 'playwright';
import { buildHandbook, compilePage } from '../../scripts/handbook.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const artifacts = path.join(root, 'test-results/handbook');
fs.mkdirSync(artifacts, { recursive: true });

test('Markdown compilation escapes active content and bounds links to documented sources', () => {
  const page = { id: 'fixture', file: 'handbook/pages/fixture.md' };
  const context = { byFile: new Map([[page.file, page]]), images: new Set() };
  const result = compilePage(
    page,
    [
      '# Fixture',
      '## A heading',
      '## A heading',
      '[Local](#a-heading-1)',
      '[External](https://example.org/docs)',
      '[Unsafe](javascript:alert%281%29)',
      '[Drive](C%3A%5Cprivate%5Cfile.png)',
      '[Escape](..%5C..%5Cprivate.png)',
      '<script>window.unsafe = true;</script>',
      '```html',
      '<img src=x onerror=alert(1)>',
      '```',
    ].join('\n\n'),
    context,
  );
  assert.match(result.html, /href="#\/fixture\?section=a-heading-1"/);
  assert.match(
    result.html,
    /href="https:\/\/example.org\/docs" target="_blank" rel="noopener noreferrer"/,
  );
  assert.doesNotMatch(result.html, /href="(?:javascript|C|\.\.)/);
  assert.doesNotMatch(result.html, /<script|<img/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /data-copy-code/);
  assert.deepEqual(
    result.headings.map((v) => v.id),
    ['fixture', 'a-heading', 'a-heading-1'],
  );
  assert.throws(
    () => compilePage(page, '[Missing](unknown.md)', context),
    /Unlisted handbook page/,
  );
});

test('the complete agent edition is reproducible from the public page catalog', () => {
  const content = buildHandbook();
  assert.equal(
    content.agentEdition,
    fs
      .readFileSync(path.join(root, 'handbook/agents.md'), 'utf8')
      .replaceAll('\r\n', '\n'),
  );
  for (const page of content.pages) {
    assert.ok(
      !path.isAbsolute(page.file) && !page.file.split('/').includes('..'),
    );
    assert.ok(
      content.agentEdition.includes(`Canonical source: \`${page.file}\``),
    );
  }
});

test(
  'built handbook supports search, deep links, keyboard access, code copying and mobile reading offline',
  { timeout: 120000 },
  async () => {
    const dist = path.join(root, 'handbook/dist');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-handbook-'));
    const entry = path.join(temp, 'render.cjs');
    fs.writeFileSync(
      entry,
      `const {app,BrowserWindow}=require('electron');app.setPath('userData',require('node:path').join(__dirname,'profile'));app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadURL('about:blank'));`,
    );
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json',
      '.md': 'text/markdown',
    };
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      const file = path.resolve(
        dist,
        '.' +
          decodeURIComponent(
            url.pathname === '/' ? '/index.html' : url.pathname,
          ),
      );
      if (
        !file.startsWith(dist + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'text/plain',
      });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let app;
    const errors = [],
      externalRequests = [];
    try {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({ args: [entry], env });
      const page = await app.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        if (
          route
            .request()
            .url()
            .startsWith(origin + '/')
        )
          return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(origin);
      await page
        .getByRole('heading', {
          name: 'Your next playthrough, well documented.',
        })
        .waitFor();
      await page.screenshot({ path: path.join(artifacts, 'desktop.png') });
      await page.locator('.skip-link').focus();
      await page.keyboard.press('Enter');
      assert.equal(
        await page
          .locator('main')
          .evaluate((element) => document.activeElement === element),
        true,
      );
      assert.notEqual(new URL(page.url()).hash, '#main');

      await page.keyboard.press('Control+k');
      const search = page.getByRole('textbox', {
        name: 'Search documentation',
      });
      await search.fill('repair');
      await page
        .getByRole('dialog')
        .getByRole('link')
        .filter({ hasText: 'Repair a setup' })
        .click();
      await page
        .getByRole('heading', { name: 'Repair a setup', exact: true })
        .waitFor();
      assert.equal(await page.getByRole('dialog').isVisible(), false);
      await page.keyboard.press('Control+k');
      await search.fill('no-such-handbook-topic-019843');
      await page.getByRole('heading', { name: 'No matching pages.' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').isVisible(), false);

      const content = buildHandbook();
      const development = content.pages.find((v) => v.id === 'development');
      const anchor = development.headings.find((v) => v.level === 2).id;
      await page.goto(origin + '/#/development?section=' + anchor);
      await page.reload();
      await page
        .getByRole('heading', { name: 'Development guide', exact: true })
        .waitFor();
      assert.equal(
        await page.locator('nav a[aria-current="page"]').getAttribute('href'),
        '#/development',
      );
      assert.ok(
        await page
          .locator('[id="' + anchor + '"]')
          .evaluate(
            (element) => Math.abs(element.getBoundingClientRect().top - 96) < 4,
          ),
      );
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async (text) => {
              window.copiedExample = text;
            },
          },
          configurable: true,
        });
      });
      await page
        .getByRole('button', { name: 'Copy code example' })
        .first()
        .click();
      assert.match(await page.evaluate(() => window.copiedExample), /pnpm/);
      await page
        .getByRole('status')
        .filter({ hasText: 'Code example copied.' })
        .waitFor();
      await page.screenshot({ path: path.join(artifacts, 'development.png') });

      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const article of content.pages) {
          await page.goto(origin + '/#/' + article.id);
          await page.waitForFunction(
            (id) =>
              location.hash === '#/' + id &&
              document.title.startsWith(
                id === 'welcome' ? 'The Loadstone handbook' : '',
              ),
            article.id,
          );
          await page
            .getByRole('heading', {
              name:
                article.id === 'welcome'
                  ? 'Your next playthrough, well documented.'
                  : article.title,
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
            `${article.id} fits ${width}px viewport`,
          );
        }
      }
      await page.goto(origin + '/#/welcome');
      await page
        .getByRole('heading', {
          name: 'Your next playthrough, well documented.',
        })
        .waitFor();
      await page.screenshot({
        path: path.join(artifacts, 'mobile.png'),
        fullPage: true,
      });
      assert.equal(await page.locator('.sidebar').getAttribute('inert'), '');
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
      await page
        .getByRole('navigation')
        .getByRole('link', { name: 'Your first setup', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Your first setup', exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Toggle navigation' })
          .getAttribute('aria-expanded'),
        'false',
      );
      await page.goto(origin + '/#/not-a-page');
      await page
        .getByRole('heading', { name: "That page isn't here." })
        .waitFor();
      await page.getByRole('link', { name: 'Back to the handbook' }).click();
      await page
        .getByRole('heading', {
          name: 'Your next playthrough, well documented.',
        })
        .waitFor();

      const edition = await (await fetch(origin + '/agents.md')).text();
      assert.equal(edition, content.agentEdition);
      const notices = await (
        await fetch(origin + '/frontend-notices.json')
      ).json();
      assert.ok(
        notices.packages.some(
          (pkg) => pkg.name === 'svelte' && pkg.notices.length,
        ),
      );
      assert.match(
        await (await fetch(origin + '/LICENSE.txt')).text(),
        /GNU GENERAL PUBLIC LICENSE/,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        externalRequests,
        [],
        'reading and searching must not require external requests',
      );
    } finally {
      if (app) await app.close();
      await new Promise((resolve) => server.close(resolve));
      if (
        path.dirname(temp) !== path.resolve(os.tmpdir()) ||
        !path.basename(temp).startsWith('loadstone-handbook-')
      )
        throw new Error('Unexpected fixture directory.');
      fs.rmSync(temp, { recursive: true, force: true });
    }
  },
);
