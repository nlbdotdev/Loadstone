import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import yazl from 'yazl';
const require = createRequire(import.meta.url);
const {
  validateRecipe,
  canonicalJson,
  limits,
} = require('../electron/native-format.cjs');
const {
  inspectNativePackage,
  ordinaryFile,
  sameFile,
} = require('../electron/native-package.cjs');
const { canonical, contains } = require('../electron/live-catalog.cjs');

export async function packNativeRecipe(recipe, payloadDirectory, output) {
  recipe = validateRecipe(recipe);
  const data = Buffer.from(canonicalJson(recipe));
  if (data.length > limits.recipeBytes)
    throw new Error('Native recipe exceeds the size limit.');
  const target = path.resolve(output),
    root = canonical(payloadDirectory);
  if (!target.endsWith('.loadstone') || contains(root, canonical(target)))
    throw new Error(
      'Choose a new .loadstone path outside the payload directory.',
    );
  if (fs.existsSync(target))
    throw new Error('Refusing to replace an existing package.');
  const zip = new yazl.ZipFile(),
    options = {
      mtime: new Date('1980-01-01T00:00:00Z'),
      mode: 0o100644,
      compress: false,
    };
  zip.addBuffer(data, 'recipe.json', options);
  // Buffer only the bounded bundled payload set. Each buffer is the exact bytes
  // that passed validation, so a changed source cannot alter the archive later.
  for (const source of recipe.sources
    .filter((v) => v.type === 'payload')
    .sort((a, b) => a.sha256.localeCompare(b.sha256, 'en'))) {
    const file = path.join(root, source.sha256),
      before = ordinaryFile(file, source.bytes);
    const payload = fs.readFileSync(file);
    if (
      !sameFile(before, ordinaryFile(file, source.bytes)) ||
      payload.length !== source.bytes ||
      crypto.createHash('sha256').update(payload).digest('hex') !==
        source.sha256
    )
      throw new Error('Bundled payload differs from its locked input.');
    zip.addBuffer(payload, `payload/${source.sha256}`, options);
  }
  // Exclusive creation preserves an earlier package, including a path created
  // after the existence check. Only a file created by this call may be removed.
  const fd = fs.openSync(target, 'wx');
  const stream = fs.createWriteStream(target, { fd });
  const onError = (error) => zip.outputStream.destroy(error);
  zip.on('error', onError);
  try {
    const writing = pipeline(zip.outputStream, stream);
    zip.end();
    await writing;
    return await inspectNativePackage(target);
  } catch (error) {
    stream.destroy();
    if (!stream.closed)
      await new Promise((resolve) => stream.once('close', resolve));
    fs.unlinkSync(target);
    throw error;
  } finally {
    zip.removeListener('error', onError);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, input, payloads, output, ...extra] = process.argv.slice(2);
  if (command === 'inspect' && input && !payloads) {
    const { recipe, ...result } = await inspectNativePackage(input);
    console.log(
      JSON.stringify(
        { id: recipe.id, version: recipe.version, ...result },
        null,
        2,
      ),
    );
  } else if (
    command === 'pack' &&
    input &&
    payloads &&
    output &&
    !extra.length
  ) {
    ordinaryFile(input, limits.recipeBytes);
    const recipe = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(input)),
    );
    const { recipe: validated, ...result } = await packNativeRecipe(
      recipe,
      payloads,
      output,
    );
    console.log(
      JSON.stringify(
        { id: validated.id, version: validated.version, ...result },
        null,
        2,
      ),
    );
  } else
    throw new Error(
      'Usage: native-package.mjs pack <recipe.json> <payload-directory> <new.loadstone> | inspect <file.loadstone>',
    );
}
