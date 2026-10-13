const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { nativeActivity } = require('./native-activity.cjs');
const {
  DownloadError,
  openResponse,
  archiveResponse,
  readJson,
  downloadUrl,
} = require('./native-network.cjs');
const { version } = require('../package.json');

const archiveSource = (source) =>
  ['https-archive', 'nexus-archive'].includes(source.type);
function directory(folder) {
  const stat = fs.lstatSync(folder);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(folder).toLowerCase() !== path.resolve(folder).toLowerCase()
  )
    throw new DownloadError(
      'The download cache must be an ordinary local directory.',
    );
  return stat;
}
async function checkCached(file, source, signal, activity) {
  const before = ordinaryFile(file, source.bytes);
  if (before.size !== source.bytes)
    throw new DownloadError(
      'A cached archive differs from the recipe. Preserve it and inspect the cache before retrying.',
    );
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    signal.throwIfAborted();
    hash.update(chunk);
    activity.add(chunk.length);
  }
  if (
    hash.digest('hex') !== source.sha256 ||
    !sameFile(before, ordinaryFile(file, source.bytes))
  )
    throw new DownloadError(
      'A cached archive differs from the recipe. Preserve it and inspect the cache before retrying.',
    );
}
async function nexusLink(source, key, signal, request) {
  const endpoint = `https://api.nexusmods.com/v1/games/${source.game}/mods/${source.modId}/files/${source.fileId}/download_link.json`;
  const response = await request(endpoint, {
    signal,
    headers: {
      apikey: key,
      'Application-Name': 'Loadstone',
      'Application-Version': version,
      Accept: 'application/json',
    },
  });
  if (response.statusCode !== 200) {
    response.destroy();
    throw new DownloadError(
      response.statusCode === 429
        ? 'Nexus request limit reached. Wait before retrying.'
        : 'Nexus refused this download. Check your account or select a manually downloaded archive.',
    );
  }
  const links = await readJson(response, 128000, signal);
  if (
    !Array.isArray(links) ||
    !links.length ||
    links.length > 100 ||
    typeof links[0]?.URI !== 'string'
  )
    throw new DownloadError('Nexus returned an invalid download response.');
  return downloadUrl(links[0].URI).href;
}
async function acquireArchives(
  recipe,
  inputs,
  cache,
  { signal, activity: callback, nexus, request = openResponse } = {},
) {
  const sources = recipe.sources.filter(
    (source) => archiveSource(source) && inputs[source.id] === null,
  );
  const result = { ...inputs };
  if (!sources.length) return result;
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(7200000)])
    : AbortSignal.timeout(7200000);
  const parent = directory(path.dirname(cache));
  if (!fs.existsSync(cache)) fs.mkdirSync(cache);
  const identity = directory(cache);
  function guard() {
    combined.throwIfAborted();
    if (
      directory(path.dirname(cache)).ino !== parent.ino ||
      directory(cache).ino !== identity.ino
    )
      throw new DownloadError('The download cache changed during this build.');
  }
  const activity = nativeActivity(callback, 'downloads', sources.length);
  let key;
  try {
    for (const source of sources) {
      guard();
      if (
        !Number.isSafeInteger(source.bytes) ||
        source.bytes < 0 ||
        source.bytes > 50000000000 ||
        !/^[a-f0-9]{64}$/.test(source.sha256)
      )
        throw new DownloadError(
          'The archive exceeds the supported download limits.',
        );
      activity.start(source.bytes);
      const file = path.join(cache, `${source.sha256}.archive`);
      if (fs.existsSync(file)) {
        await checkCached(file, source, combined, activity);
        guard();
        result[source.id] = file;
        activity.finish();
        continue;
      }
      const space = fs.statfsSync(cache);
      if (space.bavail * space.bsize < source.bytes + 64000000)
        throw new DownloadError(
          'There is not enough free space in the download cache.',
        );
      if (source.type === 'nexus-archive' && key === undefined) {
        if (!nexus)
          throw new DownloadError(
            'Connect your Nexus account in Settings before downloading.',
          );
        try {
          await nexus.verify();
        } catch {
          throw new DownloadError(
            'Nexus account verification failed. Reconnect in Settings before retrying.',
          );
        }
        const saved = nexus.read();
        if (!saved?.premium)
          throw new DownloadError(
            'Automatic Nexus downloads require Premium. Select manually downloaded archives for a free account.',
          );
        key = saved.key;
      }
      const url =
        source.type === 'nexus-archive'
          ? await nexusLink(source, key, combined, request)
          : source.url;
      const response = await archiveResponse(url, combined, request);
      const length = response.headers['content-length'];
      if (
        length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) !== source.bytes)
      ) {
        response.destroy();
        throw new DownloadError('The download length differs from the recipe.');
      }
      const temporary = path.join(
        cache,
        `${source.sha256}.${crypto.randomUUID()}.part`,
      );
      let temporaryIdentity;
      try {
        guard();
        const fd = fs.openSync(temporary, 'wx', 0o600);
        temporaryIdentity = fs.fstatSync(fd);
        const output = fs.createWriteStream(temporary, { fd, autoClose: true });
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        await pipeline(
          response,
          new Transform({
            transform(chunk, _encoding, done) {
              try {
                guard();
                bytes += chunk.length;
                if (bytes > source.bytes)
                  throw new DownloadError(
                    'The download exceeds its declared size.',
                  );
                hash.update(chunk);
                activity.add(chunk.length);
                done(null, chunk);
              } catch (error) {
                done(error);
              }
            },
          }),
          output,
          { signal: combined },
        );
        guard();
        if (bytes !== source.bytes || hash.digest('hex') !== source.sha256)
          throw new DownloadError(
            'The downloaded archive differs from the recipe hash or length.',
          );
        const finished = ordinaryFile(temporary, source.bytes);
        if (
          finished.ino !== temporaryIdentity.ino ||
          finished.size !== source.bytes
        )
          throw new DownloadError(
            'The downloaded archive changed before verification.',
          );
        // link is an exclusive, same-volume promotion; rename could overwrite an
        // existing cache file. The private temporary name is removed below.
        fs.linkSync(temporary, file);
        result[source.id] = file;
      } finally {
        response.destroy();
        // Never follow a replacement cache directory or delete somebody else's
        // file during cancellation/failure cleanup.
        if (temporaryIdentity) {
          try {
            if (
              directory(cache).ino === identity.ino &&
              fs.lstatSync(temporary).ino === temporaryIdentity.ino
            )
              fs.unlinkSync(temporary);
          } catch {}
        }
      }
      activity.finish();
    }
    return result;
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      combined.aborted
        ? 'Archive acquisition stopped. Verified cache files are retained for retry.'
        : 'Archive acquisition failed. Check the connection, cache and source access before retrying.',
    );
  }
}
module.exports = { acquireArchives, archiveSource, nexusLink };
