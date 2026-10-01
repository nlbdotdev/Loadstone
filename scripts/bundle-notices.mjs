import fs from 'node:fs';
import path from 'node:path';
export function packageNotice(folder) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(folder, 'package.json'), 'utf8'),
  );
  const notices = fs
    .readdirSync(folder)
    .filter(
      (name) =>
        /^(licen[cs]e|notice)(\.|$)/i.test(name) &&
        fs.statSync(path.join(folder, name)).isFile(),
    )
    .sort()
    .map((name) => ({
      name,
      text: fs
        .readFileSync(path.join(folder, name), 'utf8')
        .replaceAll('\r\n', '\n'),
    }));
  return {
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    homepage: metadata.homepage || null,
    notices,
  };
}
export function bundleNotices() {
  return {
    name: 'loadstone-bundle-notices',
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!module.renderedLength) continue;
          let file = id.split('?')[0];
          if (file.startsWith('\0vite/'))
            file = path.join(process.cwd(), 'node_modules/vite/package.json');
          else if (file.startsWith('\0'))
            throw new Error(
              'Unattributed generated bundle module; extend license provenance before packaging.',
            );
          if (!file.replaceAll('\\', '/').includes('/node_modules/')) continue;
          let folder = path.dirname(file),
            found = false;
          while (folder !== path.dirname(folder)) {
            const manifest = path.join(folder, 'package.json');
            if (fs.existsSync(manifest)) {
              const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
              if (metadata.name && metadata.version) {
                const record = packageNotice(folder),
                  key = `${record.name}@${record.version}`;
                if (!packages.has(key))
                  packages.set(key, { ...record, renderedModules: 0 });
                packages.get(key).renderedModules++;
                found = true;
                break;
              }
            }
            folder = path.dirname(folder);
          }
          if (!found)
            throw new Error('A rendered dependency has no package metadata.');
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'frontend-notices.json',
        source:
          JSON.stringify(
            {
              schemaVersion: 1,
              packages: [...packages.values()].sort((a, b) =>
                a.name.localeCompare(b.name, 'en'),
              ),
            },
            null,
            2,
          ) + '\n',
      });
    },
  };
}
