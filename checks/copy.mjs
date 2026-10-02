// Checks that every string in content/en.json and content/vi.json appears word for word in the copy
// documents (COPY_EN.md, COPY_VI.md, and SPEC.md for the English UI strings). The documents are not part
// of the repository: put them in the project folder to run this. Without them the check is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (f) => path.join(ROOT, f);
const need = ['COPY_EN.md', 'COPY_VI.md', 'SPEC.md'];
const missing = need.filter((f) => !fs.existsSync(at(f)));
if (missing.length) {
  console.log(`copy check skipped: ${missing.join(', ')} not in the project folder`);
  process.exit(0);
}
const read = (f) => fs.readFileSync(at(f), 'utf8');
const docs = { en: need.map(read).join('\n'), vi: read('COPY_VI.md') };
// Values that are structure, not copy.
const STRUCT = new Set(['key', 'date', 'since', 'status', 'live', 'reference', 'start', 'end']);
let bad = 0, n = 0;
for (const lang of ['en', 'vi']) {
  const c = JSON.parse(read(`content/${lang}.json`));
  const names = Object.fromEntries(Object.entries(c.clients).map(([k, v]) => [k, v.name]));
  const walk = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}.${i}`));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
    if (typeof v !== 'string' || v === '' || STRUCT.has(where.split('.').pop())) return;
    // Client tokens and link markup are the build's notation; compare the words they stand for.
    const words = v.replace(/\{[cC]:(\w+)\|([^}]*)\}/g, '$2').replace(/\{[cC]:(\w+)\}/g, (m, k) => names[k]).replace(/\[([^\]]+)\]\(\w+\)/g, '$1');
    n++;
    if (docs[lang].includes(words)) return;
    // Two clients came with their logos, after the copy was written.
    if (/^\.clients\.\w+\.name$/.test(where)) return console.log(`not in the copy documents, supplied with its logo [${lang}]: ${words}`);
    bad++;
    console.log(`NOT FOUND [${lang}] ${where}: ${words}`);
  };
  walk(c, '');
}
console.log(`${n} strings checked, ${bad} not found word for word`);
// The AWS page has copy of its own, written for it and not in the copy documents: count it, so a reader
// knows how much wording to review there.
for (const lang of ['en', 'vi']) {
  const f = `content/aws.${lang}.json`;
  if (!fs.existsSync(at(f))) continue;
  let own = 0;
  const count = (v, key) => {
    if (Array.isArray(v)) return v.forEach((x) => count(x, key));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => count(x, k));
    if (typeof v === 'string' && v && !['key', 'from'].includes(key)) own++;
  };
  count(JSON.parse(read(f)), '');
  console.log(`${f}: ${own} strings written or changed for the AWS page, not in the copy documents`);
}
process.exit(bad ? 1 : 0);
