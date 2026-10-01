// Checks of the PDF files the build prints from the page. No browser needed.
//   node checks/pdf.mjs [distDir]
// It reads each file's structure: pages, fonts, links, language, title and size.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const cfg = JSON.parse(fs.readFileSync(path.join(DIST, '..', 'config.json'), 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
const FILES = [
  ['coderpush-banks-profile-en.pdf', 'en'], ['coderpush-banks-profile-vi.pdf', 'vi'],
  ['coderpush-banks-profile-aws-en.pdf', 'en'], ['coderpush-banks-profile-aws-vi.pdf', 'vi'],
];
for (const [name, lang] of FILES) {
  const file = path.join(DIST, name);
  if (!fs.existsSync(file)) { check(`${name}: the file exists`, false); continue; }
  const buf = fs.readFileSync(file);
  const text = buf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const fonts = [...new Set([...text.matchAll(/\/FontName\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, '')))];
  const links = [...new Set([...text.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]))];
  const a4 = /\/MediaBox\s*\[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/.test(text);
  check(`${name}: a whole PDF of 3 to 9 pages on A4`, text.startsWith('%PDF-') && text.trimEnd().endsWith('%%EOF') && pages >= 3 && pages <= 9 && a4, `${pages} pages, A4 ${a4}`);
  check(`${name}: set in Geist only`, fonts.length > 0 && fonts.every((f) => f.startsWith('Geist')), fonts.join(' '));
  check(`${name}: tagged for screen readers, in the right language, with a title and an outline`, /\/Marked true/.test(text) && text.includes(`/Lang (${lang})`) && /\/Title \(Production AI for Vietnamese banks \| CoderPush\)/.test(text) && /\/Outlines /.test(text), (text.match(/\/Lang \([a-z]+\)/) || [''])[0]);
  const wantLinks = ['https://coderpush.com/', ...(cfg.links.booking ? [cfg.links.booking] : [])];
  check(`${name}: its links can be clicked`, wantLinks.every((l) => links.includes(l)), links.join(' '));
  check(`${name}: under 1.5 MB`, buf.length < 1.5e6, `${(buf.length / 1000).toFixed(0)} KB`);
  check(`${name}: no local path and no browser name in its properties`, !/file:\/\/|\/Users\/|Mozilla/.test(text) && /\/Creator \(coderpush\.com\/banks *\)/.test(text), (text.match(/\/Creator \([^)]{0,40}/) || [''])[0]);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} PDF checks passed`);
process.exit(failed ? 1 : 0);
