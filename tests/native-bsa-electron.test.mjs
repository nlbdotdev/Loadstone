import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { createNativeBsaFixture } from './native-bsa-fixture.mjs';
import { fingerprint } from './native-archive-fixture.mjs';
const require = createRequire(import.meta.url);

for (const kind of ['zip-windows', 'rar5'])
  test(
    `real Electron reviews and reconstructs nested BSA104 files from ${kind}`,
    {
      timeout: 60000,
      skip: kind !== 'zip-windows' && !process.env.LOADSTONE_TEST_7ZIP,
    },
    async () => {
      const f = await createNativeBsaFixture(kind);
      const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
        env,
      });
      try {
        const page = await app.firstWindow();
        await page
          .getByRole('button', { name: 'Explore the demo', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Settings', exact: true })
          .click();
        await page.evaluate(() =>
          window.loadstone.settings({ dummyData: false }),
        );
        await app.evaluate(
          ({ dialog }, f) => {
            process.getBuiltinModule('os').tmpdir = () => f.staging;
            const files = [
              f.packageFile,
              f.inputsFile,
              f.parent,
              ...(f.executable ? [f.executable] : []),
            ];
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [files.shift()],
            });
          },
          {
            ...f,
            executable:
              kind === 'zip-windows'
                ? undefined
                : process.env.LOADSTONE_TEST_7ZIP,
          },
        );
        await page
          .getByRole('button', {
            name: 'Choose local build inputs',
            exact: true,
          })
          .click();
        const review = page.getByRole('region', {
          name: 'Review native build',
        });
        await review.waitFor();
        await review
          .getByRole('button', { name: 'Build candidate', exact: true })
          .click();
        await page
          .getByText('Files verified · Launch untested', { exact: true })
          .waitFor();
        const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
        assert.equal(jobs[0].status, 'verified');
        for (const output of f.recipe.outputs) {
          const file = path.join(jobs[0].destination, output.path);
          assert.deepEqual(fingerprint(fs.readFileSync(file)), {
            bytes: output.bytes,
            sha256: output.sha256,
          });
          assert.equal(Math.round(fs.statSync(file).mtimeMs), output.mtimeMs);
        }
        assert.deepEqual(fs.readdirSync(f.staging), []);
        assert.equal(
          await page.evaluate(
            async () => (await window.loadstone.liveJobs()).length,
          ),
          0,
        );
      } finally {
        await app.close();
      }
    },
  );
