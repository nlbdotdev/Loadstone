import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import asar from '@electron/asar';

export async function inventory(directory) {
  const files = [];
  async function walk(folder) {
    for (const entry of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(folder, entry.name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink())
        throw new Error(
          'Depot content cannot contain symbolic links or junctions.',
        );
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        const digest = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(file))
          digest.update(chunk);
        files.push({
          path: path.relative(directory, file).split(path.sep).join('/'),
          bytes: stat.size,
          sha256: digest.digest('hex'),
        });
      } else throw new Error('Depot content contains a non-file entry.');
    }
  }
  await walk(directory);
  return files;
}

export function inspectPackage(content) {
  for (const file of [
    'Loadstone.exe',
    'resources/app.asar',
    'LICENSE.electron.txt',
    'LICENSES.chromium.html',
    'resources/notices/THIRD-PARTY.txt',
    'resources/notices/dependencies.json',
  ]) {
    if (!fs.statSync(path.join(content, file)).isFile())
      throw new Error(`Missing packaged file: ${file}`);
  }
  const executable = fs.openSync(path.join(content, 'Loadstone.exe'), 'r');
  try {
    const header = Buffer.alloc(64);
    if (
      fs.readSync(executable, header, 0, 64, 0) !== 64 ||
      header.toString('ascii', 0, 2) !== 'MZ'
    )
      throw new Error('Invalid Windows executable.');
    const offset = header.readUInt32LE(60),
      pe = Buffer.alloc(6);
    if (
      offset < 64 ||
      offset > 1048576 ||
      fs.readSync(executable, pe, 0, 6, offset) !== 6 ||
      pe.readUInt32LE(0) !== 0x4550 ||
      pe.readUInt16LE(4) !== 0x8664
    )
      throw new Error('Depot requires a Windows x64 executable.');
  } finally {
    fs.closeSync(executable);
  }
  const archive = path.join(content, 'resources/app.asar');
  const metadata = JSON.parse(
    asar.extractFile(archive, 'package.json').toString(),
  );
  const build = JSON.parse(
    asar.extractFile(archive, 'dist/build-info.json').toString(),
  );
  if (
    metadata.name !== 'loadstone' ||
    metadata.main !== 'electron/main.cjs' ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version)
  )
    throw new Error('Unexpected packaged application identity.');
  if (
    !/^[a-f0-9]{40}$/.test(build.commit) ||
    typeof build.dirty !== 'boolean' ||
    !/^[a-f0-9]{64}$/.test(build.lockfileSha256)
  )
    throw new Error('Package must include a valid Git build identity.');
  for (const file of [
    'electron/main.cjs',
    'electron/preload.cjs',
    'dist/index.html',
  ])
    asar.extractFile(archive, file);
  const notices = JSON.parse(
    fs.readFileSync(
      path.join(content, 'resources/notices/dependencies.json'),
      'utf8',
    ),
  );
  if (
    !Array.isArray(notices.packages) ||
    !notices.packages.length ||
    !Array.isArray(notices.missingLicenseTexts)
  )
    throw new Error('Invalid dependency notice inventory.');
  return {
    version: metadata.version,
    license: metadata.license,
    build,
    noticeGaps: notices.missingLicenseTexts,
  };
}

export function steamScripts(
  appId = 'YOUR_APP_ID',
  depotId = 'YOUR_WINDOWS_DEPOT_ID',
) {
  for (const [value, placeholder] of [
    [appId, 'YOUR_APP_ID'],
    [depotId, 'YOUR_WINDOWS_DEPOT_ID'],
  ]) {
    if (
      value !== placeholder &&
      (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 4294967295)
    )
      throw new Error('Steam IDs must be positive unsigned 32-bit integers.');
  }
  return {
    app: `"AppBuild"\n{\n  "AppID" "${appId}"\n  "Desc" "Loadstone Windows preview"\n  "Preview" "1"\n  "ContentRoot" "../content"\n  "BuildOutput" "../output"\n  "Depots"\n  {\n    "${depotId}" "depot_build.vdf"\n  }\n}\n`,
    depot: `"DepotBuild"\n{\n  "DepotID" "${depotId}"\n  "FileMapping"\n  {\n    "LocalPath" "*"\n    "DepotPath" "."\n    "Recursive" "1"\n  }\n}\n`,
  };
}

export async function stagePackage(source, destination, appId, depotId) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  if (
    path.relative(source, destination) === '' ||
    (!path.relative(source, destination).startsWith('..' + path.sep) &&
      !path.isAbsolute(path.relative(source, destination)))
  )
    throw new Error('The kit must be outside its source package.');
  if (fs.existsSync(destination))
    throw new Error(
      'Choose a new kit directory; existing artifacts are never overwritten.',
    );
  const scripts = steamScripts(appId, depotId);
  const identity = inspectPackage(source);
  const original = await inventory(source);
  fs.mkdirSync(destination, { recursive: true });
  const content = path.join(destination, 'content');
  fs.cpSync(source, content, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const copied = await inventory(content);
  if (JSON.stringify(copied) !== JSON.stringify(original))
    throw new Error(
      'The package changed during staging. Discard this incomplete kit and retry.',
    );
  fs.mkdirSync(path.join(destination, 'scripts'));
  const template = !appId || !depotId;
  fs.writeFileSync(
    path.join(
      destination,
      'scripts',
      'app_build.vdf' + (template ? '.template' : ''),
    ),
    scripts.app,
    { flag: 'wx' },
  );
  fs.writeFileSync(
    path.join(
      destination,
      'scripts',
      'depot_build.vdf' + (template ? '.template' : ''),
    ),
    scripts.depot,
    { flag: 'wx' },
  );
  const manifest = {
    schemaVersion: 1,
    platform: 'win32-x64',
    launch: {
      executable: 'Loadstone.exe',
      arguments: '',
      workingDirectory: '',
    },
    ...identity,
    releaseApproved: false,
    files: copied,
  };
  fs.writeFileSync(
    path.join(destination, 'depot-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  fs.writeFileSync(
    path.join(destination, 'README.txt'),
    'Loadstone Windows depot preview\n\nLaunch content/Loadstone.exe. Configure the Steam launch executable as Loadstone.exe (Windows 64-bit), with no arguments.\nThe content directory alone is the depot root. Keep this manifest and scripts outside the depot.\nTemplates require your assigned app/depot IDs and renaming both files to .vdf. Preview stays 1; no SetLive directive is generated.\nNo upload has occurred. No release approval is implied. Licensing, Nexus registration, real install-to-play, clean Windows/Steam acceptance and store review remain required.\nUser settings, credentials and setups must remain outside the depot. Do not enable Steam Cloud for credential files.\n',
    { flag: 'wx' },
  );
  return manifest;
}

export async function verifyKit(directory) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'depot-manifest.json'), 'utf8'),
  );
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32-x64')
    throw new Error('Unsupported depot manifest.');
  const content = path.join(directory, 'content');
  if (
    JSON.stringify(await inventory(content)) !== JSON.stringify(manifest.files)
  )
    throw new Error('Depot files differ from the staged manifest.');
  const identity = inspectPackage(content);
  for (const key of ['version', 'license', 'build', 'noticeGaps'])
    if (JSON.stringify(identity[key]) !== JSON.stringify(manifest[key]))
      throw new Error('Depot identity differs from the manifest.');
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length === 2) {
    const result = await verifyKit(path.resolve(args[1]));
    console.log(
      `Verified ${result.files.length} depot files for ${result.version} at ${result.build.commit}.`,
    );
  } else if (args.length === 1 || args.length === 3) {
    const source = path.resolve(args[0]);
    const destination = path.resolve(
      'release/steam',
      `preview-${crypto.randomUUID()}`,
    );
    const result = await stagePackage(source, destination, args[1], args[2]);
    console.log(
      JSON.stringify(
        {
          directory: destination,
          version: result.version,
          files: result.files.length,
          build: result.build,
          noticeGaps: result.noticeGaps,
          releaseApproved: false,
        },
        null,
        2,
      ),
    );
  } else
    throw new Error(
      'Usage: node scripts/steam-depot.mjs <unpacked-directory> [app-id depot-id] OR --verify <kit-directory>',
    );
}
