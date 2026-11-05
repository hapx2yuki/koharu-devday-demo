import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const lines = ['Third-party notices', 'Generated from the production dependencies in package-lock.json.', 'The project code is MIT. Third-party packages retain their respective licenses.', ''];
for (const [path, data] of Object.entries(lock.packages)) {
  if (!path || data.dev || data.optional) continue;
  let pkg; try { pkg = JSON.parse(await readFile(path + '/package.json', 'utf8')); } catch { continue; }
  lines.push('='.repeat(72), pkg.name + ' ' + pkg.version, 'License: ' + (pkg.license || data.license || 'See upstream package'), pkg.homepage || '', '');
  let found = false;
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENCE', 'LICENCE.md']) {
    try { lines.push(await readFile(path + '/' + name, 'utf8')); found = true; break; } catch {}
  }
  if (!found) lines.push('Full license text is available in the upstream package linked by package-lock.json.');
}
await writeFile('THIRD_PARTY_NOTICES.txt', lines.join('\n'));
