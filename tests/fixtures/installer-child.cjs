const fs = require('node:fs');
const path = require('node:path');
const [output, mode] = process.argv.slice(2);
if (mode === 'wait') {
  console.log('Waiting for cancellation');
  setInterval(() => {}, 1000);
  return;
}
if (mode === 'fail') {
  console.log('controlled download failure');
  process.exit(2);
}
fs.mkdirSync(path.join(output, 'profiles', 'Fixture'), { recursive: true });
fs.writeFileSync(path.join(output, 'ModOrganizer.exe'), 'MZfixture');
fs.writeFileSync(path.join(output, 'game.exe'), 'MZfixture');
fs.writeFileSync(
  path.join(output, 'ModOrganizer.ini'),
  '[customExecutables]\n1\\title=Fixture game\n1\\binary=' +
    path.join(output, 'game.exe').replaceAll('\\', '/') +
    '\n',
);
fs.writeFileSync(
  path.join(output, 'profiles', 'Fixture', 'modlist.txt'),
  '# fixture\n',
);
console.log('Downloaded https://example.com/archive?token=private-token');
setTimeout(() => process.exit(0), 100);
