import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
const { ZipFile } = createRequire(import.meta.url)('yazl');
export function listMetadata() {
  return {
    Name: 'Fixture list',
    GameType: 'FalloutNewVegas',
    WabbajackVersion: '4.2.3.0',
    Version: '1.0.0',
    OtherGames: [],
    Archives: [],
    Directives: [
      'ModOrganizer.exe',
      'ModOrganizer.ini',
      'profiles/Fixture/modlist.txt',
    ].map((To) => ({ To, Size: 1, $type: 'InlineFile' })),
  };
}
export async function writeList(file, metadata = listMetadata()) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(metadata)), 'modlist');
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(file));
}
