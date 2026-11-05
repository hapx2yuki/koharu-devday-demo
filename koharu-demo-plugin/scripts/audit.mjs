import { readdir, readFile } from 'node:fs/promises';
const exclusions = new Set(['node_modules', '.git', '.local']);
const forbidden = [
  /OAI-Sites-Authorization/,
  /\/Users\//,
  /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/,
];
let count = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (exclusions.has(e.name)) continue;
    const path = dir + '/' + e.name;
    if (e.isDirectory()) await walk(path);
    else {
      if (path.endsWith('/audit.mjs')) continue;
      if (/\.env|credentials|tokens/.test(e.name)) throw new Error('Forbidden file: ' + path);
      const text = await readFile(path, 'utf8');
      if (forbidden.some(p => p.test(text))) throw new Error('Private marker found: ' + path);
      count++;
    }
  }
}
await walk('.');
const pkg = JSON.parse(await readFile('plugin.json', 'utf8'));
if (pkg.name !== 'koharu-demo') throw new Error('Wrong plugin manifest');
console.log(JSON.stringify({ filesChecked: count, privateMarkers: 0, scope: 'package source and generated bundles', secretGuarantee: 'Known private markers and key patterns only; review remains required.' }));
