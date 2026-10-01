const yauzl = require('yauzl');
const { relativeFile, games } = require('./manifest.cjs');
const gameTypes = {
  fnv: 'FalloutNewVegas',
  skyrimse: 'SkyrimSpecialEdition',
  fallout4: 'Fallout4',
};
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value))
    throw new Error('The list declares an unsupported engine version.');
  return value.split('.').map(Number).concat([0]).slice(0, 4);
}
function newerVersion(value, supported) {
  const a = versionParts(value),
    b = versionParts(supported);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function inspectList(
  file,
  manifest,
  engineVersion,
  includeOutputs = false,
) {
  const zip = await yauzl.openPromise(file, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  let data = null,
    count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (++count > 500000)
        throw new Error('The list archive contains too many entries.');
      if (entry.fileName !== 'modlist') continue;
      if (data)
        throw new Error('The archive contains duplicate list metadata.');
      if (entry.uncompressedSize > 64_000_000)
        throw new Error('The list metadata exceeds the supported size.');
      const input = await zip.openReadStreamPromise(entry),
        chunks = [];
      let size = 0;
      for await (const chunk of input) {
        size += chunk.length;
        if (size > 64_000_000) {
          input.destroy();
          throw new Error('The list metadata exceeds the supported size.');
        }
        chunks.push(chunk);
      }
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Error('The list metadata is not valid JSON.');
      }
    }
  } finally {
    zip.close();
  }
  if (
    !data ||
    typeof data.Name !== 'string' ||
    data.Name.length > 500 ||
    !Array.isArray(data.Archives) ||
    !Array.isArray(data.Directives) ||
    data.Directives.length === 0 ||
    data.Directives.length > 500000 ||
    data.Archives.length > 100000
  )
    throw new Error('The archive does not contain a supported Wabbajack list.');
  if (data.GameType !== gameTypes[manifest.game.id])
    throw new Error(
      'The Wabbajack archive targets a different game than this manifest.',
    );
  if (Array.isArray(data.OtherGames) && data.OtherGames.length)
    throw new Error(
      'This list requires additional games. Multi-game installation is not supported yet.',
    );
  if (newerVersion(data.WabbajackVersion, engineVersion))
    throw new Error(
      `This list requires Wabbajack ${data.WabbajackVersion}. Update the Loadstone engine integration first.`,
    );
  const outputs = new Set();
  let installBytes = 0,
    downloadBytes = 0;
  for (const directive of data.Directives) {
    if (
      !directive ||
      !relativeFile(directive.To) ||
      !Number.isSafeInteger(directive.Size) ||
      directive.Size < 0
    )
      throw new Error(
        'The list contains an unsafe installation path or invalid file size.',
      );
    const output = directive.To.replaceAll('\\', '/').toLowerCase();
    if (outputs.has(output))
      throw new Error('The list contains duplicate installation paths.');
    outputs.add(output);
    installBytes += directive.Size;
  }
  const sources = new Set();
  for (const archive of data.Archives) {
    if (
      !archive ||
      !Number.isSafeInteger(archive.Size) ||
      archive.Size < 0 ||
      typeof archive.State?.$type !== 'string'
    )
      throw new Error('The list contains invalid download metadata.');
    sources.add(archive.State.$type.split(',')[0]);
    downloadBytes += archive.Size;
  }
  if (
    !Number.isSafeInteger(installBytes) ||
    !Number.isSafeInteger(downloadBytes)
  )
    throw new Error('The list declares invalid total storage requirements.');
  if (
    manifest.storage.installBytes < installBytes ||
    manifest.storage.downloadBytes < downloadBytes
  )
    throw new Error(
      'The manifest understates the list storage requirements. Obtain a corrected manifest.',
    );
  const profile = manifest.launch.profile.toLowerCase();
  if (
    !outputs.has('modorganizer.exe') ||
    !outputs.has(`profiles/${profile}/modlist.txt`) ||
    !outputs.has('modorganizer.ini')
  )
    throw new Error(
      'The list does not include the MO2 application and profile declared by this manifest.',
    );
  if (manifest.launch.gameRoot) {
    const executable =
      manifest.launch.gameRoot.replaceAll('\\', '/').toLowerCase() +
      '/' +
      games[manifest.game.id].executable.toLowerCase();
    if (!outputs.has(executable))
      throw new Error(
        'The list does not produce the game executable inside its declared isolated game folder.',
      );
  }
  const automatic = new Set([
    'NexusDownloader',
    'GameFileSourceDownloader',
    'HttpDownloader',
    'WabbajackCDNDownloader',
  ]);
  const unsupportedSources = [...sources].filter(
    (source) => !automatic.has(source),
  );
  return {
    name: data.Name,
    game: data.GameType,
    version: String(data.Version || ''),
    engineVersion: data.WabbajackVersion,
    archives: data.Archives.length,
    files: outputs.size,
    installBytes,
    downloadBytes,
    requiresNexus: sources.has('NexusDownloader'),
    unsupportedSources,
    ...(includeOutputs
      ? {
          outputs: data.Directives.map((d) => ({
            path: d.To,
            bytes: d.Size,
            type: d.$type,
          })),
        }
      : {}),
  };
}
module.exports = { inspectList, newerVersion };
