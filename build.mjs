#!/usr/bin/env node
// Builds dist/banks.html and dist/HANDOVER.md from config.json, content/en.json,
// content/vi.json and template.html. Plain Node 18 or later, no dependencies.
// It also renders dist/og-banks.png when Playwright or a local Chrome is available,
// with flags.videoReady on it writes the film (dist/banks-film.html) and its poster, and
// with flags.profilePdf on it prints the page to PDF with a local Chrome, once per language and door.
//
//   node build.mjs                    normal build
//   node build.mjs --no-og            skip the preview image
//   node build.mjs --config other.json --out /tmp/test --today 2027-01-15
//
// The build fails, and writes nothing, on an em dash or en dash in any source or
// output, on a client name whose switch is off, on a hidden person's name, on a
// file of 150 KB or more, and on content that does not match between languages.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LANGS = ['en', 'vi'];
const MAX_BYTES = 150 * 1000;
const SITE = 'https://coderpush.com';
// One family for the whole page, both languages: Geist covers Vietnamese.
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Geist:wght@400..700&display=swap';
// Files the hidden parts point to once their switches are on. They sit next to index.html.
// The film is one self-contained HTML file with its own player. The page shows it in a frame, and
// fetches it only when a visitor asks for it. The build ships a copy: see readFilm and embedFilm.
const VIDEO_DIR = 'assets/video';
const FILM_EMBED = `${VIDEO_DIR}/film-embed.js`;
const FILM_CTA = /const CTA_HREF = '[^'\n]*';/g;
const FILES = {
  film: 'banks-film.html',
  poster: 'banks-film-poster.webp',
  brief: { en: '/banks/coderpush-banks-brief-en.pdf', vi: '/banks/coderpush-banks-brief-vi.pdf' },
  deck: { en: '/banks/coderpush-banks-deck-en.pdf', vi: '/banks/coderpush-banks-deck-vi.pdf' },
};
// The page itself as a PDF, one per language and door, printed by the build (see makePdfs). The page's
// script builds the same names from the stem, so the link follows the language and door in view.
const PDF_STEM = 'coderpush-banks-profile-';
const DOORS = ['bank', 'aws'];
const pdfName = (lang, door) => `${PDF_STEM}${door === 'aws' ? 'aws-' : ''}${lang}.pdf`;
// Chrome's print scale. At 0.75 an A4 sheet lays out like a screen about 1060 px wide, and body text prints near 9.5 pt.
const PDF_SCALE = 0.75;
const PDF_CREATOR = 'coderpush.com/banks';
// Logo files are embedded when they exist in assets/logos, named <key>.svg (or .png, .webp, .jpg).
// Client logos appear only while that client's switch is on. The ISO slot takes the certification
// body's mark, never the ISO logo, and only while flags.isoMark is on.
const LOGO_DIR = 'assets/logos';
// Team photos: assets/team/<key>.webp (or .png, .jpg), embedded only for people who are shown.
const TEAM_DIR = 'assets/team';
const CRED_KEYS = ['aws-advanced-tier', 'aws-ai-competency', 'iso-27001'];
// Icons from the sprite in template.html, by position or key.
const ICONS = {
  creds: ['cloud', 'spark', 'shield'],
  useCases: { 'contact-centre': 'headset', 'rm-copilot': 'brief', 'credit-memo': 'doc', 'governed-analytics': 'bars', 'investment-assistant': 'trend', 'ekyc-deepfake': 'scan' },
  steps: ['doc', 'flask', 'usercheck', 'shield'],
  phases: ['zap', 'wrench', 'rocket'],
  waysIn: ['headset', 'bars', 'scale', 'code'],
  rail: ['key', 'list', 'user', 'power', 'checksq', 'folder'],
};
// Values that are structure, not copy: they must be identical in both languages.
const STRUCT_KEYS = new Set(['key', 'date', 'since', 'status']);
// U+2013 (en dash) and U+2014 (em dash), built from their codes so this file never contains them.
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const errors = [];
const warnings = [];

const args = parseArgs(process.argv.slice(2));
const today = args.today || localDate(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) stop([`--today must look like 2026-10-01, got "${today}"`]);

// 1. Read the sources and check them for dashes.
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const sources = [args.config, 'template.html', 'build.mjs', ...(fs.existsSync(path.join(ROOT, FILM_EMBED)) ? [FILM_EMBED] : []),
  ...fs.readdirSync(path.join(ROOT, 'content')).filter((f) => f.endsWith('.json')).map((f) => `content/${f}`)];
for (const f of sources) scanDashes(read(f), f);
const cfg = readJson(args.config);
const content = { en: readJson('content/en.json'), vi: readJson('content/vi.json') };
const template = read('template.html');
if (errors.length) stop(errors);

// 2. Validate the config and check that both languages have the same shape.
validateConfig();
parity(withoutMeta(content.en), content.vi, '');
if (errors.length) stop(errors);

// 3. Work out everything the template needs, per language.
const logos = loadLogos();
const film = cfg.flags.videoReady ? readFilm() : null;
const gens = {};
for (const l of LANGS) gens[l] = makeGen(l);
if (errors.length) stop(errors);
// The film's own button reads "Book a 30-minute intro", so it gets the link of the page's button with that label.
const filmOut = film ? embedFilm(film, gens.en.href.intro) : null;

// 4. Render, minify and check the page.
let html;
try {
  html = minify(run(compile(template).kids, { lang: null, vars: {}, index: 0 }));
} catch (e) {
  stop([e.message]);
}
checkOutput('dist/banks.html', html);
const bytes = Buffer.byteLength(html);
if (bytes >= MAX_BYTES) errors.push(`dist/banks.html is ${kb(bytes)}; it must stay under ${kb(MAX_BYTES)}`);
if (errors.length) stop(errors);
// The PDFs are printed from the finished page before anything is written, so a failure leaves dist/ as it was.
const pdfs = cfg.flags.profilePdf ? await makePdfs(html) : null;
if (errors.length) stop(errors);

// 5. Write the page, the preview image and the handover note.
const outDir = path.resolve(ROOT, args.out);
fs.mkdirSync(outDir, { recursive: true });
const hash = crypto.createHash('sha256').update(html).digest('hex');
const ogFile = path.join(outDir, 'og-banks.png');
let ogBy = null;
if (args.og) {
  ogBy = await renderOg(ogFile);
  if (!ogBy) warnings.push('og-banks.png was not rendered: neither Playwright nor a local Chrome was found.');
}
const ogReady = fs.existsSync(ogFile);
const note = handover({ bytes, hash, ogReady });
checkOutput('dist/HANDOVER.md', note);
if (errors.length) stop(errors);
fs.writeFileSync(path.join(outDir, 'banks.html'), html);
fs.writeFileSync(path.join(outDir, 'HANDOVER.md'), note);
// The PDFs sit next to the page. A build without them clears them from the out folder.
for (const l of LANGS) for (const d of DOORS) {
  const f = path.join(outDir, pdfName(l, d));
  const made = pdfs && pdfs.find((x) => x.name === pdfName(l, d));
  if (made) fs.writeFileSync(f, made.data);
  else if (fs.existsSync(f)) fs.rmSync(f);
}
// The film and its poster sit next to the page. A build without the film clears them from the out folder.
if (filmOut) {
  fs.writeFileSync(path.join(outDir, FILES.film), filmOut.text);
  fs.copyFileSync(path.join(ROOT, VIDEO_DIR, FILES.poster), path.join(outDir, FILES.poster));
} else {
  for (const f of [FILES.film, FILES.poster]) if (fs.existsSync(path.join(outDir, f))) fs.rmSync(path.join(outDir, f));
}
report();

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { config: 'config.json', out: 'dist', today: null, og: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--config') a.config = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--today') a.today = argv[++i];
    else if (k === '--no-og') a.og = false;
    else stop([`Unknown option ${k}. Options: --config file, --out dir, --today YYYY-MM-DD, --no-og`]);
  }
  return a;
}

function stop(list) {
  console.error(`\nBuild failed. Nothing was written.\n\n${[...new Set(list)].map((e) => `  x ${e}`).join('\n')}\n`);
  process.exit(1);
}

function readJson(p) {
  try { return JSON.parse(read(p)); } catch (e) { stop([`${p}: ${e.message}`]); }
}

function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(from, to) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(to) - t(from)) / 864e5);
}

function kb(n) { return `${(n / 1000).toFixed(1)} KB`; }
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }

function scanDashes(text, label) {
  text.split('\n').forEach((line, i) => {
    if (DASH.test(line)) errors.push(`${label}:${i + 1} has an em dash or en dash; use a hyphen: ${line.trim().slice(0, 90)}`);
  });
}

function withoutMeta(o) {
  const { meta, ...rest } = o;
  return rest;
}

function validateConfig() {
  for (const k of ['clients', 'people', 'flags', 'links']) {
    if (!cfg[k] || typeof cfg[k] !== 'object') errors.push(`${args.config}: "${k}" must be an object`);
  }
  if (errors.length) return;
  for (const k of Object.keys(content.en.clients)) {
    if (typeof cfg.clients[k] !== 'boolean') errors.push(`${args.config}: clients.${k} must be true or false`);
  }
  for (const k of Object.keys(cfg.clients)) {
    if (!content.en.clients[k]) errors.push(`${args.config}: clients.${k} has no entry in content/en.json`);
  }
  const team = content.en.team.people.map((p) => p.key);
  for (const [k, v] of Object.entries(cfg.people)) {
    if (typeof v !== 'boolean') errors.push(`${args.config}: people.${k} must be true or false`);
    if (!team.includes(k)) errors.push(`${args.config}: people.${k} is not in the team list`);
  }
  for (const k of ['regulationDates', 'oneDayReply', 'videoReady', 'profilePdf', 'downloads', 'marketplace', 'isoMark']) {
    if (typeof cfg.flags[k] !== 'boolean') errors.push(`${args.config}: flags.${k} must be true or false`);
  }
  if (typeof cfg.flags.aiPolicyUrl !== 'string') errors.push(`${args.config}: flags.aiPolicyUrl must be a string`);
  else if (cfg.flags.aiPolicyUrl && !/^https:\/\/\S+$/.test(cfg.flags.aiPolicyUrl)) errors.push(`${args.config}: flags.aiPolicyUrl must be an https:// address or empty`);
  for (const k of ['booking', 'email', 'awsContactEmail']) {
    if (typeof cfg.links[k] !== 'string') { errors.push(`${args.config}: links.${k} must be a string`); continue; }
    cfg.links[k] = cfg.links[k].trim();
  }
  if (errors.length) return;
  if (cfg.links.booking && !/^https:\/\/\S+$/.test(cfg.links.booking)) errors.push(`${args.config}: links.booking must be an https:// address or empty`);
  for (const k of ['email', 'awsContactEmail']) {
    if (cfg.links[k] && !EMAIL.test(cfg.links[k])) errors.push(`${args.config}: links.${k} is not an email address`);
  }
  if (!cfg.links.email) warnings.push('links.email is empty: the footer and privacy note have no address' + (cfg.links.booking ? '.' : ', and the booking buttons open an email with no recipient.'));
  if (!cfg.links.awsContactEmail && !cfg.links.email) warnings.push('links.awsContactEmail is empty: the AWS door\'s "Share an opportunity" opens an email with no recipient.');
}

function parity(a, b, p) {
  const where = p || 'the top level';
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) { errors.push(`content/vi.json: ${where} should be a list`); return; }
    if (a.length !== b.length) errors.push(`${where}: content/en.json has ${a.length} items, content/vi.json has ${b.length}`);
    a.forEach((x, i) => { if (i < b.length) parity(x, b[i], `${p}.${i}`); });
    return;
  }
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') { errors.push(`content/vi.json: ${where} should be an object`); return; }
    for (const k of Object.keys(a)) if (!(k in b)) errors.push(`content/vi.json is missing ${p ? `${p}.` : ''}${k}`);
    for (const k of Object.keys(b)) if (!(k in a)) errors.push(`content/en.json is missing ${p ? `${p}.` : ''}${k}`);
    for (const k of Object.keys(a)) if (k in b) parity(a[k], b[k], p ? `${p}.${k}` : k);
    return;
  }
  if (typeof a !== typeof b) { errors.push(`${where}: the value type differs between en and vi`); return; }
  if ((typeof a !== 'string' || STRUCT_KEYS.has(p.split('.').pop())) && a !== b) errors.push(`${where}: "${a}" in en but "${b}" in vi; this value must be the same in both`);
  if (typeof a === 'string') {
    const sig = (s) => [...s.matchAll(/\{[cC]:(\w+)(?:\|[^}]*)?\}|\{(org|n|email)\}|\]\((\w+)\)/g)].map((m) => m[1] || m[2] || m[3]).sort().join(',');
    if (sig(a) !== sig(b)) errors.push(`${where}: client tokens, placeholders or links differ between en ("${sig(a)}") and vi ("${sig(b)}")`);
  }
}

// Text helpers ---------------------------------------------------------------

function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function capFirst(s, lang) { const a = Array.from(s); return a.length ? a[0].toLocaleUpperCase(lang) + a.slice(1).join('') : s; }

// {c:key} writes the client's name when its switch is on and the fallback wording when it is off.
// {C:key} does the same with a capital letter, for the start of a sentence or a label.
// {C:key|Text} writes Text instead of the bare name when the switch is on.
function clientName(key, cap, pub, lang) {
  const c = content[lang].clients[key];
  if (!c || typeof cfg.clients[key] !== 'boolean') throw new Error(`Unknown client "${key}" in a {c:${key}} token`);
  if (cfg.clients[key]) return pub !== undefined ? pub : c.name;
  if (!c.fallback) throw new Error(`clients.${key} is off but content/${lang}.json has no fallback wording for it`);
  return cap ? capFirst(c.fallback, lang) : c.fallback;
}

// Copy strings: resolve client tokens, escape, and turn [label](target) into a link.
function text(s, lang, html) {
  const out = s.replace(/\{([cC]):(\w+)(?:\|([^}]*))?\}/g, (m, c, key, pub) => clientName(key, c === 'C', pub, lang));
  if (!html) return out.replace(/\[([^\]]+)\]\((\w+)\)/g, '$1');
  // Keep short hyphenated or slashed words (on-prem, go/no-go) and a number with its unit (500 ms, 3-4 weeks) on one line.
  const kept = escHtml(out).replace(/(?<![\p{L}\p{N}/-])(?:\d[\d.,]*(?:-\d[\d.,]*)? (?:ms|weeks?|minutes?|days?|tuần|phút|ngày)|[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)+)(?![\p{L}\p{N}/-])/gu,
    (w) => (w.length <= 16 ? `<span class="nw">${w}</span>` : w));
  return kept.replace(/\[([^\]]+)\]\((\w+)\)/g, (m, label, target) => {
    const href = gens[lang] && gens[lang].href[target];
    if (href === undefined) throw new Error(`Unknown link target "${target}" in: ${s}`);
    return href ? `<a href="${escAttr(href)}" data-cta="link-${target}">${label}</a>` : label;
  });
}

function fill(s, placeholder, htmlValue, lang) {
  const parts = s.split(placeholder);
  if (parts.length !== 2) throw new Error(`Expected ${placeholder} once in: ${s}`);
  return text(parts[0], lang, true) + htmlValue + text(parts[1], lang, true);
}

function initials(name, lang) {
  const words = name.replace(/\([^)]*\)/g, ' ').replace(/^\s*(Dr|TS)\.\s*/i, '').trim().split(/\s+/);
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toLocaleUpperCase(lang);
}

// Everything the template reads under gen.*, for one language.
function makeGen(lang) {
  const C = content[lang];
  const L = cfg.links;
  const plain = (s) => text(s, lang, false);
  const mailto = (to, subject) => `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  const awsTo = L.awsContactEmail || L.email;
  const g = { fontsHref: FONTS_HREF };
  try {
    g.href = {
      book: L.booking || mailto(L.email, plain(C.hero.bank.book)),
      intro: L.booking || mailto(L.email, plain(C.faq.button)),
      share: mailto(awsTo, plain(C.hero.aws.share)),
      awsEmail: awsTo ? mailto(awsTo, plain(C.hero.aws.share)) : '',
      brief: FILES.brief[lang],
      deck: FILES.deck[lang],
    };
    const mail = L.email ? `<a href="mailto:${escAttr(L.email)}">${escHtml(L.email)}</a>` : '';
    g.contact = mail;
    g.privacyNote = fill(C.ui.privacyNote, '{email}', mail, lang);
    g.preparedFor = fill(C.ui.preparedFor, '{org}', '<span class="org"></span>', lang);
    g.daysBy = {};
    for (const card of C.proof.cards) {
      if (!card.since) continue;
      g.daysBy[card.since] = fill(C.ui.days, '{n}', `<span class="n">${Math.max(0, daysBetween(card.since, today))}</span>`, lang);
    }

    const split = (s, n, sep = ' · ') => {
      const parts = s.split(sep);
      if (parts.length !== n) throw new Error(`content/${lang}.json: expected ${n} parts separated by "${sep}" in: ${s}`);
      return parts;
    };
    const D = C.pattern.diagram;
    g.dg = {
      quick: split(D.quick, 3), apps: split(D.apps, 2), stt: split(D.stt, 3), tagging: split(D.tagging, 2),
      recordings: split(D.recordings, 2), store: split(D.store, 3), platform: split(D.platform, 2),
      rail: split(D.rail, 2), railItems: split(D.railItems, 6), arrows: split(D.arrows, 4),
      region: split(D.stateRegion, 2, '; '), onprem: split(D.stateOnprem, 3),
    };
    g.waysIn = split(C.offer.waysIn, 4).map((text, i) => ({ text, icon: ICONS.waysIn[i] }));
    g.dg.railItems = g.dg.railItems.map((text, i) => ({ text, icon: ICONS.rail[i] }));
    g.builders = split(C.team.builders, 3);
    const has = (k) => (logos[k] ? k : '');
    g.wordmark = has('coderpush');
    g.creds = C.hero.eyebrow.map((text, i) => ({ text, icon: ICONS.creds[i], badge: CRED_KEYS[i] !== 'iso-27001' || cfg.flags.isoMark ? has(CRED_KEYS[i]) : '' }));
    g.useCases = C.useCases.items.map((u) => ({ ...u, icon: ICONS.useCases[u.key] || 'checkc' }));
    g.steps = C.safety.steps.map((st, i) => ({ ...st, icon: ICONS.steps[i] || 'checkc', no: String(i + 1).padStart(2, '0') }));
    g.phases = C.offer.phases.map((ph, i) => ({ ...ph, icon: ICONS.phases[i] || 'checkc' }));
    g.proofCards = C.proof.cards.map((card) => {
      const key = (card.client.match(/\{[cC]:(\w+)/) || [])[1];
      const shown = key && cfg.clients[key] === true;
      return { ...card, logo: shown ? has(key) : '' };
    });
    g.clientLogos = Object.keys(content.en.clients).filter((k) => cfg.clients[k] === true)
      .map((k) => ({ key: k, name: content.en.clients[k].name, logo: has(k) }));
    // Each logo is embedded once, as a class, however many places show it.
    const inUse = [...new Set([g.wordmark, ...g.creds.map((c) => c.badge), ...g.clientLogos.map((c) => c.logo)].filter(Boolean))];
    g.logoCss = inUse.map((k) => `.L-${k}{--w:${logos[k].w}px;--h:${logos[k].h}px;background-image:url("${logos[k].src}")}`).join('\n');
    g.logosUsed = inUse;
    g.team = C.team.people
      .filter((p) => !(p.key in cfg.people) || cfg.people[p.key] === true)
      .map((p) => ({ ...p, initials: initials(p.name, lang), photo: photo(p.key) }));

    // The clock: past rows, the next deadline, and where "Today" sits. The page recomputes all of it on load.
    const rows = C.clock.rows.map((r) => ({ ...r, cls: !r.date ? 'draft' : r.date <= today ? 'past' : 'future' }));
    const next = rows.findIndex((r) => r.date && r.date > today);
    if (next >= 0) Object.assign(rows[next], { cls: 'future next', next: true, todayBefore: true });
    else if (rows.some((r) => !r.date)) rows[rows.findIndex((r) => !r.date)].todayBefore = true;
    else g.clockTodayEnd = true;
    g.clockRows = rows;
    g.clockHasNext = next >= 0;
    g.inDays = fill(C.ui.inDays, '{n}', `<span class="n">${next >= 0 ? daysBetween(today, rows[next].date) : 0}</span>`, lang);

    g.jsonld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'CoderPush', legalName: plain(C.ui.legalName), url: SITE, ...(L.email ? { email: L.email } : {}) },
        { '@type': 'FAQPage', '@id': `${SITE}/banks#faq`, url: `${SITE}/banks`, inLanguage: lang,
          mainEntity: C.faq.items.map((q) => ({ '@type': 'Question', name: plain(q.q), acceptedAnswer: { '@type': 'Answer', text: plain(q.a) } })) },
      ],
    }).replace(/</g, '\\u003c');

    // The PDF link: without JavaScript it is the English bank file, which is the view shown then.
    g.pdf = { stem: PDF_STEM, file: pdfName('en', 'bank') };
    // The film: where the page finds it and its poster, and its length for the badge on the poster.
    g.video = { file: FILES.film, poster: FILES.poster, duration: film ? film.duration : '' };
    if (cfg.flags.isoMark && !logos['iso-27001']) errors.push(`flags.isoMark is on but ${LOGO_DIR}/iso-27001.svg is missing. Add the certification body's mark (never the ISO logo) or switch the flag off.`);
  } catch (e) {
    errors.push(e.message);
  }
  return g;
}

// Logos: every image in assets/logos becomes a data URI plus its display size. Raster files are prepared at
// twice the display size (see assets/logos/README.md); SVG files are sized by their viewBox.
function imageSize(buf, ext) {
  if (ext === 'png' && buf.toString('ascii', 12, 16) === 'IHDR') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (ext === 'webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >>> 14) & 0x3fff)]; }
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  return [0, 0];
}

function loadLogos() {
  const dir = path.join(ROOT, LOGO_DIR);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^([a-z0-9-]+)\.(svg|png|webp)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const ext = m[2].toLowerCase();
    const buf = fs.readFileSync(path.join(dir, f));
    let src;
    let w = 0;
    let h = 0;
    if (ext === 'svg') {
      const svg = buf.toString('utf8').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|metadata)[\s\S]*?<\/\1>/gi, '').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
      const vb = svg.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      const ratio = vb ? +vb[1] / +vb[2] : 0;
      // Same visual weight as the prepared raster logos: badges by height, other marks by area.
      if (ratio) { h = CRED_KEYS.includes(key) ? 104 : key === 'coderpush' ? 24 : Math.min(44, 54 / Math.sqrt(ratio)); w = h * ratio; }
      src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    } else {
      [w, h] = imageSize(buf, ext).map((n) => n / 2);
      src = `data:image/${ext};base64,${buf.toString('base64')}`;
    }
    if (!w || !h) { errors.push(`${LOGO_DIR}/${f}: could not read its size. Use a .webp or .png, or an .svg with a viewBox.`); continue; }
    out[key] = { src, w: Math.round(w), h: Math.round(h), file: f, bytes: src.length };
  }
  return out;
}

function photo(key) {
  for (const ext of ['webp', 'png', 'jpg']) {
    const f = path.join(ROOT, TEAM_DIR, `${key}.${ext}`);
    if (fs.existsSync(f)) return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(f).toString('base64')}`;
  }
  return '';
}

// The film --------------------------------------------------------------------

// Reads the film, checks that it shows nothing the switches hide, and notes its length.
function readFilm() {
  const file = `${VIDEO_DIR}/${FILES.film}`;
  const missing = [FILES.film, FILES.poster, path.basename(FILM_EMBED)].filter((f) => !fs.existsSync(path.join(ROOT, VIDEO_DIR, f)));
  if (missing.length) {
    errors.push(`flags.videoReady is on but ${missing.map((f) => `${VIDEO_DIR}/${f}`).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing.${missing.includes(FILES.poster) ? ` The poster is made by: node ${VIDEO_DIR}/prepare.mjs` : ''}`);
    return null;
  }
  const src = read(file);
  // The film carries its sound, fonts and pictures as base64. Those stay out of the text checks.
  const lean = src.replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
  scanDashes(lean, file);
  checkNames(file, lean);
  for (const [key, on] of Object.entries(cfg.clients)) {
    if (!on && new RegExp(`['"]${escRe(key)}['"]`).test(lean)) errors.push(`${file}: the film shows the ${key} logo but clients.${key} is off. Switch flags.videoReady off, or use a film without it.`);
  }
  if ((lean.match(FILM_CTA) || []).length !== 1) errors.push(`${file}: expected one line that reads const CTA_HREF = '...'; (the film's booking link setting), so that the build can point it at the page's booking link.`);
  if (!/<\/body>/i.test(lean)) errors.push(`${file}: no closing body tag, so this is not the film's HTML file.`);
  const seconds = Number((lean.match(/window\.DURATION\s*=\s*([\d.]+)/) || [])[1]) || 0;
  if (!seconds) warnings.push(`${file}: the film does not state its length (window.DURATION), so the poster shows no time.`);
  const gone = ['film', 'big', 'sound', 'hot-cta'].filter((id) => !new RegExp(`id=["']${id}["']`).test(lean));
  if (gone.length) warnings.push(`${file}: the film's player has changed (no ${gone.map((id) => `#${id}`).join(', ')}). It still opens in the page, but check that it starts there, and with sound.`);
  const label = text(content.en.hero.bank.video, 'en', false);
  const said = Number((label.match(/(\d+)[\s-]second/) || [])[1]);
  if (seconds && said && Math.abs(said - seconds) > 5) warnings.push(`The button reads "${label}" but the film runs ${Math.round(seconds)} seconds. The copy is used as written.`);
  const whole = Math.round(seconds);
  return { src, seconds, duration: seconds ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : '' };
}

// The copy that ships: its button gets the page's booking link, and film-embed.js goes in before </body>.
function embedFilm(f, href) {
  const cta = `const CTA_HREF = ${JSON.stringify(href).replace(/</g, '\\x3c')};`;
  const src = f.src.replace(FILM_CTA, () => cta);
  const at = src.toLowerCase().lastIndexOf('</body>');
  const out = `${src.slice(0, at)}<script>\n${read(FILM_EMBED).trim()}\n</script>\n${src.slice(at)}`;
  return { text: out, bytes: Buffer.byteLength(out), sent: zlib.gzipSync(out, { level: 9 }).length };
}

// The page as a PDF -------------------------------------------------------------

// Prints the finished page with a local Chrome, once per language and door. The page's own print
// styles (template.html, @media print) decide how it looks; this only opens each view and prints it.
async function makePdfs(page) {
  const chrome = findChrome();
  if (!chrome) {
    errors.push('flags.profilePdf is on but no Chrome was found to print the PDFs. Install Google Chrome, or set CHROME_PATH, or switch the flag off.');
    return null;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banks-pdf-'));
  const file = path.join(tmp, 'banks.html');
  fs.writeFileSync(file, page);
  const stamp = `${today.replace(/-/g, '')}000000`;
  const out = [];
  const c = openChrome(chrome, path.join(tmp, 'profile'));
  try {
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = (method, params) => c.send(method, params, sessionId);
    await tab('Page.enable');
    // Reduced motion shows every part at once, with nothing waiting to be scrolled into view.
    await tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const lang of LANGS) for (const door of DOORS) {
      const name = pdfName(lang, door);
      const loaded = c.once('Page.loadEventFired', sessionId);
      await tab('Page.navigate', { url: `${pathToFileURL(file).href}?lang=${lang}${door === 'aws' ? '&door=aws' : ''}` });
      await loaded;
      const fonts = await tab('Runtime.evaluate', { expression: "document.fonts.ready.then(() => document.fonts.check('400 17px Geist') && document.fonts.check('600 17px Geist'))", awaitPromise: true, returnByValue: true });
      if (!fonts.result || fonts.result.value !== true) {
        errors.push(`${name}: the Geist font did not load, so the PDF would print in another font. Is the network reachable?`);
        continue;
      }
      const printed = await tab('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, scale: PDF_SCALE, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, generateTaggedPDF: true, generateDocumentOutline: true });
      // Chrome stamps the time of printing, and names itself as the creator. The build date and the page's
      // address go in their place, at the same length, so the same page gives the same file.
      const text = Buffer.from(printed.data, 'base64').toString('latin1')
        .replace(/\/(CreationDate|ModDate) \(D:\d{14}/g, (m, key) => `/${key} (D:${stamp}`)
        .replace(/\/Creator \(((?:[^()\\]|\\.)*)\)/, (m, v) => (v.length >= PDF_CREATOR.length ? `/Creator (${PDF_CREATOR.padEnd(v.length)})` : m));
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
      const strays = [...new Set([...text.matchAll(/\/FontName\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, '')))].filter((f) => !f.startsWith('Geist'));
      if (!text.startsWith('%PDF-') || pages < 2 || pages > 12) errors.push(`${name}: Chrome did not give a usable PDF (${pages} pages).`);
      if (strays.length) errors.push(`${name}: the PDF uses ${strays.join(', ')} besides Geist.`);
      out.push({ name, lang, door, pages, data: Buffer.from(text, 'latin1') });
    }
  } catch (e) {
    errors.push(`Chrome could not print the PDFs: ${e.message}`);
  } finally {
    await c.close();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* it is in the temp folder anyway */ }
  }
  return out;
}

// Chrome over its debugging pipe: no port, no package. Messages are JSON, each ended by a zero byte.
function openChrome(chrome, profile) {
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const [, , , toChrome, fromChrome] = proc.stdio;
  let buf = Buffer.alloc(0), id = 0, dead = null;
  const pending = new Map();
  const waiters = [];
  const fail = (err) => {
    dead = dead || err;
    for (const { reject } of pending.values()) reject(dead);
    pending.clear();
    for (const w of waiters.splice(0)) w.reject(dead);
  };
  fromChrome.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (let end = buf.indexOf(0); end >= 0; end = buf.indexOf(0)) {
      const msg = JSON.parse(buf.subarray(0, end).toString('utf8'));
      buf = buf.subarray(end + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const w of waiters.slice()) {
          if (w.method !== msg.method || w.sessionId !== msg.sessionId) continue;
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg.params);
        }
      }
    }
  });
  proc.once('exit', () => fail(new Error('Chrome closed before the work was done')));
  proc.once('error', (e) => fail(e));
  toChrome.on('error', () => {});
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); });
  const within = (promise, what, ms = 60000) => Promise.race([promise, wait(ms).then(() => { throw new Error(`Chrome did not answer ${what} within ${ms / 1000} seconds`); })]);
  return {
    send(method, params = {}, sessionId) {
      return within(new Promise((resolve, reject) => {
        if (dead) { reject(dead); return; }
        const n = ++id;
        pending.set(n, { resolve, reject });
        toChrome.write(`${JSON.stringify({ id: n, method, params, sessionId })}\0`);
      }), method);
    },
    once(method, sessionId) {
      return within(new Promise((resolve, reject) => { waiters.push({ method, sessionId, resolve, reject }); }), method);
    },
    async close() {
      const gone = new Promise((resolve) => proc.once('exit', resolve));
      if (!dead) { try { await Promise.race([this.send('Browser.close'), wait(1000)]); } catch { /* it has gone already */ } }
      proc.kill();
      await Promise.race([gone, wait(3000)]);
    },
  };
}

// Template engine -------------------------------------------------------------
//   {{t path}}  copy in both languages (or the current one inside {{#lang}} or {{#in}})
//   {{r path}}  prepared HTML, same rule      {{a path}}  attribute text, one language
//   {{v path}}  a plain value                  {{@lang}} {{@n}} {{@index}}
//   {{#each path as x}}  {{#if path}} {{#if path == word}} {{else}}  {{#unless path}}
//   {{#lang}} renders its block once per language, {{#in en}} once in English.
// Paths read content/<lang>.json, or cfg.* (config.json), or gen.* (worked out above).
// A path segment in [brackets] is looked up first, as in ui.status.[p.status].

function compile(src) {
  const root = { type: 'root', kids: [] };
  const stack = [root];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const push = (n) => { const top = stack[stack.length - 1]; (top.inElse ? top.alt : top.kids).push(n); };
  const re = /\{\{\s*([\s\S]*?)\s*\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) push({ type: 'text', value: src.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1];
    const line = lineAt(m.index);
    let t;
    if ((t = tag.match(/^#each\s+(\S+)\s+as\s+(\w+)$/))) { const n = { type: 'each', path: t[1], name: t[2], kids: [], line }; push(n); stack.push(n); }
    else if ((t = tag.match(/^#(if|unless)\s+(.+)$/))) { const n = { type: t[1], cond: t[2].trim(), kids: [], alt: [], line }; push(n); stack.push(n); }
    else if (tag === '#lang') { const n = { type: 'lang', kids: [], line }; push(n); stack.push(n); }
    else if ((t = tag.match(/^#in\s+(en|vi)$/))) { const n = { type: 'in', lang: t[1], kids: [], line }; push(n); stack.push(n); }
    else if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (top.type !== 'if' && top.type !== 'unless') throw new Error(`template.html:${line}: {{else}} outside {{#if}}`);
      top.inElse = true;
    } else if ((t = tag.match(/^\/(each|if|unless|lang|in)$/))) {
      const top = stack.pop();
      if (top.type !== t[1]) throw new Error(`template.html:${line}: {{/${t[1]}}} closes {{#${top.type}}} from line ${top.line}`);
    } else if ((t = tag.match(/^(t|r|a|v)\s+(\S+)$/))) push({ type: 'out', mode: t[1], path: t[2], line });
    else if ((t = tag.match(/^@(lang|n|index)$/))) push({ type: 'special', name: t[1], line });
    else throw new Error(`template.html:${line}: unknown tag {{${tag}}}`);
  }
  if (last < src.length) push({ type: 'text', value: src.slice(last) });
  if (stack.length > 1) throw new Error(`template.html:${stack[stack.length - 1].line}: {{#${stack[stack.length - 1].type}}} is never closed`);
  return root;
}

function lookup(p, lang) {
  const segs = p.split('.');
  let cur = content[lang];
  if (segs[0] === 'cfg') { cur = cfg; segs.shift(); } else if (segs[0] === 'gen') { cur = gens[lang]; segs.shift(); }
  for (const s of segs) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[s];
  }
  return cur;
}

function resolve(expr, ctx) {
  const e = expr.replace(/\[([^\]]+)\]/g, (m, inner) => {
    const v = lookup(resolve(inner, ctx), ctx.lang || 'en');
    if (v === undefined || v === null || typeof v === 'object') throw new Error(`[${inner}] does not name a value`);
    return String(v);
  });
  const [head, ...rest] = e.split('.');
  return head in ctx.vars ? [ctx.vars[head], ...rest].join('.') : e;
}

function truthy(expr, ctx) {
  const m = expr.match(/^(\S+)\s*(==|!=)\s*(\S+)$/);
  if (m) {
    const same = String(lookup(resolve(m[1], ctx), ctx.lang || 'en')) === m[3];
    return m[2] === '==' ? same : !same;
  }
  const v = lookup(resolve(expr, ctx), ctx.lang || 'en');
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

function both(ctx, f) {
  if (ctx.lang) return f(ctx.lang);
  const en = f('en');
  const vi = f('vi');
  return en === vi ? en : `<span class="en">${en}</span><span class="vi">${vi}</span>`;
}

function output(n, ctx) {
  const p = resolve(n.path, ctx);
  const val = (l) => {
    const v = lookup(p, l);
    if (v === undefined || v === null || typeof v === 'object') throw new Error(`template.html:${n.line}: ${p} is missing or not text in ${l}`);
    return String(v);
  };
  if (n.mode === 'v') return escAttr(val(ctx.lang || 'en'));
  if (n.mode === 'a') {
    if (!ctx.lang) throw new Error(`template.html:${n.line}: {{a ${n.path}}} needs {{#lang}} or {{#in}}`);
    return escAttr(text(val(ctx.lang), ctx.lang, false));
  }
  if (n.mode === 't') return both(ctx, (l) => text(val(l), l, true));
  return both(ctx, val);
}

function run(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'out') out += output(n, ctx);
    else if (n.type === 'special') {
      if (n.name === 'lang' && !ctx.lang) throw new Error(`template.html:${n.line}: {{@lang}} needs {{#lang}}`);
      out += n.name === 'lang' ? ctx.lang : n.name === 'n' ? String(ctx.index + 1) : String(ctx.index);
    } else if (n.type === 'each') {
      const base = resolve(n.path, ctx);
      const list = lookup(base, ctx.lang || 'en');
      if (!Array.isArray(list)) throw new Error(`template.html:${n.line}: ${base} is not a list`);
      list.forEach((_, i) => { out += run(n.kids, { ...ctx, vars: { ...ctx.vars, [n.name]: `${base}.${i}` }, index: i }); });
    } else if (n.type === 'if' || n.type === 'unless') {
      const ok = truthy(n.cond, ctx) !== (n.type === 'unless');
      out += run(ok ? n.kids : n.alt, ctx);
    } else if (n.type === 'lang') {
      for (const l of LANGS) out += run(n.kids, { ...ctx, lang: l });
    } else if (n.type === 'in') {
      out += run(n.kids, { ...ctx, lang: n.lang });
    }
  }
  return out;
}

// Output ------------------------------------------------------------------------

function minify(page) {
  const held = [];
  const hold = (s) => `\u0000${held.push(s) - 1}\u0000`;
  let out = page
    .replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => hold(`<style>${minCss(css)}</style>`))
    .replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => hold(`<script>${minJs(js)}</script>`))
    .replace(/<script type="text\/vtt"[\s\S]*?<\/script>/g, (m) => hold(m));
  out = out.replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n');
  // A plain attribute value needs no quotes in HTML. A value that ends a self-closing tag keeps them,
  // or the slash would become part of it.
  out = out.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/(\s[a-zA-Z-]+)="([A-Za-z0-9_.:#-]+)"(?=[\s>])/g, '$1=$2'));
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => held[+i]);
}

function minCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>~])\s*/g, '$1')
    .replace(/:\s+/g, ':').replace(/;}/g, '}').trim();
}

function minJs(js) {
  return js.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
}

function checkOutput(label, full) {
  const out = full.replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:image');
  scanDashes(out, label);
  checkNames(label, out);
  for (const [re, what] of [[/\{[cC]:\w+/, 'a client token'], [/\{\{/, 'a template tag'], [/\{(org|n|email)\}/, 'a placeholder'], [/\]\(\w+\)/, 'link markup']]) {
    const m = out.match(re);
    if (m) errors.push(`${label}: ${what} was left in the output: ${out.slice(Math.max(0, m.index - 40), m.index + 40)}`);
  }
}

// A client whose switch is off, or a person who is not shown, must not be named anywhere.
function checkNames(label, out) {
  for (const [key, on] of Object.entries(cfg.clients)) {
    if (on) continue;
    for (const name of new Set(LANGS.map((l) => content[l].clients[key].name))) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(name).replace(/ /g, '\\s*')}(?![\\p{L}\\p{N}])`, 'giu');
      for (const m of out.matchAll(re)) {
        const around = out.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ');
        errors.push(`${label}: "${m[0]}" appears but clients.${key} is off: ...${around}...`);
      }
    }
  }
  for (const p of content.en.team.people) {
    if (!(p.key in cfg.people) || cfg.people[p.key]) continue;
    for (const l of LANGS) {
      const name = content[l].team.people.find((x) => x.key === p.key).name;
      if (out.includes(name)) errors.push(`${label}: "${name}" appears but people.${p.key} is off`);
    }
  }
}

function handover({ bytes, hash, ogReady }) {
  const f = cfg.flags;
  const blocking = [];
  if (!cfg.links.email && !cfg.links.booking) blocking.push('config.json has no links.email or links.booking, so the booking buttons have no destination.');
  else if (!cfg.links.email) blocking.push('config.json has no links.email, so the footer and the privacy note have no contact address.');
  if (!cfg.links.awsContactEmail && !cfg.links.email) blocking.push('config.json has no links.awsContactEmail, so the AWS door has no contact address.');
  if (!ogReady) blocking.push('og-banks.png is missing, and the link-preview tags point to it.');
  const files = [['banks.html', 'public/banks/index.html']];
  if (ogReady) files.push(['og-banks.png', 'public/banks/og-banks.png']);
  if (f.videoReady) files.push([FILES.film, `public/banks/${FILES.film}`], [FILES.poster, `public/banks/${FILES.poster}`]);
  if (pdfs) for (const x of pdfs) files.push([x.name, `public/banks/${x.name}`]);
  if (f.downloads) {
    for (const l of LANGS) files.push([`the one-page brief (${l.toUpperCase()}), from LV`, `public${FILES.brief[l]}`]);
    for (const l of LANGS) files.push([`the PDF deck (${l.toUpperCase()}), from LV`, `public${FILES.deck[l]}`]);
  }
  const L = [];
  L.push('# /banks: handover for the web team', '');
  L.push(`Build of ${today}: banks.html is ${kb(bytes)}, sha256 ${hash.slice(0, 12)}.`, '');
  if (blocking.length) L.push(`**Not ready to go live.** ${blocking.join(' ')} LV will send a new build.`, '');
  L.push('## Files', '', '| File | Put it at |', '| --- | --- |', ...files.map(([a, b]) => `| ${a} | ${b} |`), '');
  L.push('banks.html is the whole page: both doors, both languages, and all CSS and JavaScript inline. It has its own header and footer and no main-site navigation. There is no build step, no environment variable and no server code. Each new build from LV replaces index.html; please do not edit the file by hand.', '');
  if (f.videoReady) {
    L.push(`${FILES.film} is the overview film: one self-contained file of ${mb(filmOut.bytes)}, about ${mb(filmOut.sent)} as sent compressed. The page fetches it only when a visitor presses play, then shows it in a frame inside the page. Each new build replaces it together with index.html.`, '');
    L.push(`The film and its poster are addressed relative to the page. That works at /banks/ with the trailing slash, which is how the site serves pages. If the page is ever served at /banks without the slash, it switches to /banks/ addresses by itself.`, '');
    L.push(`The site must allow its own pages to be shown in a frame on the same site. Today it sends no X-Frame-Options header and no frame-ancestors rule, so nothing needs changing. If one is added later, keep the same origin allowed for /banks/${FILES.film}.`, '');
  }
  if (pdfs) L.push(`The ${pdfs.length} PDF files are the page itself, printed for A4 paper: one per language, for the bank door and for the AWS door. The Download PDF button in the header and at the end of the page fetches the one for the language and door in view. They are addressed relative to the page, like the film, and each new build replaces them.`, '');
  L.push('## Routing', '', 'coderpush.com is a Next.js site on Vercel with trailing slashes, so the page must answer at both /banks and /banks/. Merge this into next.config.js:', '');
  L.push('```js', 'async rewrites() {', '  return [', "    { source: '/banks', destination: '/banks/index.html' },", "    { source: '/banks/', destination: '/banks/index.html' },", '  ];', '},', 'async redirects() {', '  return [', '    // Temporary until launch week, then set permanent: true.', "    { source: '/aws', destination: '/banks?door=aws', permanent: false },", "    { source: '/pitchdeck', destination: '/banks', permanent: false },", '  ];', '},', '```', '');
  L.push('## Analytics', '');
  L.push('1. Turn on Vercel Web Analytics for the project if it is not on.');
  L.push('2. Paste its script tag from the Vercel dashboard just before `</head>` in public/banks/index.html. Paste it again whenever a new build replaces the file.');
  L.push('3. Custom events need the Pro plan. The page sends these, each with at most two properties:', '');
  L.push('| Event | When | Properties |', '| --- | --- | --- |');
  L.push('| page_open | After the page has been visible for five seconds | for and door, or door and lang |');
  L.push('| locale_switch | The EN or VI switch in the header | lang |');
  L.push('| section_view | A section reaches the middle of the screen, once per door | section, door |');
  L.push('| deploy_select | An option in the diagram\'s deployment selector | option |');
  L.push('| faq_open | An FAQ answer opens | question |');
  L.push(`| cta_click | A booking, share${f.videoReady ? ', film' : ''}${f.profilePdf ? ', PDF' : ''} or download button, or an email link | cta, and for or door |`, '');
  L.push('Without the script tag the page sends nothing, and it never sets cookies, so it also works opened from disk.', '');
  L.push('## Addresses to test', '');
  L.push('- `/banks?lang=vi` and `/banks?lang=en` pick the language. Without `lang`, a browser set to Vietnamese gets Vietnamese.');
  L.push('- `/banks?door=aws` opens the AWS door.');
  L.push('- `/banks?for=Example+Bank&uc=contact-centre,governed-analytics` shows a greeting for Example Bank and puts those two use cases first.');
  L.push('- `#deploy=region`, `#deploy=localzone` and `#deploy=onprem` set the diagram.', '');
  L.push('## Before announcing', '');
  L.push('- On a phone, /banks and /banks/ open the bank door, and /aws opens the AWS door.');
  L.push('- Click a button on the live page and check that the click shows up in Vercel Analytics.');
  if (f.videoReady) L.push('- Press play on the poster on the live page: the film opens in the page and plays.');
  if (pdfs) L.push('- Press Download PDF on the live page, once in English and once in Vietnamese: each gives a PDF in that language.');
  return `${L.join('\n')}\n`;
}

// Preview image ---------------------------------------------------------------

function ogHtml() {
  const C = content.en;
  const t = (x) => escHtml(text(x, 'en', false));
  const sprite = (template.match(/<svg class="sprite"[\s\S]*?<\/svg>/) || [''])[0];
  const chips = gens.en.creds.map((c) => (c.badge
    ? `<li class="b"><span style="display:block;width:${logos[c.badge].w}px;height:${logos[c.badge].h}px;background:url('${logos[c.badge].src}') center/contain no-repeat"></span></li>`
    : `<li><svg class="ic"><use href="#i-${c.icon}"/></svg>${t(c.text)}</li>`)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${escAttr(FONTS_HREF)}">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0A0A0A;color:#F5F5F5;font-family:'Geist',sans-serif}
body{position:relative}
.sprite{position:absolute;width:0;height:0}
.g{position:absolute;left:480px;top:-380px;width:1200px;height:760px;background:radial-gradient(closest-side,rgba(129,200,40,.18),rgba(129,200,40,0))}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(245,245,245,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(245,245,245,.05) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(ellipse 75% 80% at 70% 0%,#000 20%,transparent 100%)}
.in{position:absolute;left:72px;right:72px;top:64px;bottom:64px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center}
.wm{font:700 40px/1 'Geist',sans-serif;letter-spacing:-0.04em}.wm span{color:#81C828}
.u{font:500 20px/1 'Geist',sans-serif;color:#81C828}
ul{margin:auto 0 0;padding:0;list-style:none;display:flex;align-items:center;gap:16px}
li.b{padding:0;border:0;background:none}
li{display:flex;align-items:center;gap:10px;padding:8px 16px 8px 12px;border:1px solid #262626;border-radius:999px;background:rgba(245,245,245,.03);font:500 19px/1.2 'Geist',sans-serif}
.ic{width:22px;height:22px;fill:none;stroke:#81C828;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
h1{margin:24px 0 24px;font:600 92px/1.02 'Geist',sans-serif;letter-spacing:-0.04em}
p{margin:0;max-width:1000px;font:400 30px/1.35 'Geist',sans-serif;color:#A3A3A3}
</style></head><body>${sprite}<div class="g"></div><div class="grid"></div><div class="in">
<div class="top"><div class="wm">coderpush<span>.</span></div><div class="u">coderpush.com/banks</div></div>
<ul>${chips}</ul>
<h1>${t(C.hero.bank.headline)}</h1>
<p>${t(C.hero.bank.subline)}</p>
</div></body></html>`;
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => p && fs.existsSync(p));
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return b.length > 24 && b.toString('ascii', 12, 16) === 'IHDR' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0];
}

// True once the file is a whole PNG: it ends with the IEND chunk.
function pngComplete(file) {
  if (!fs.existsSync(file)) return false;
  const b = fs.readFileSync(file);
  return b.length > 24 && b.toString('ascii', b.length - 8, b.length - 4) === 'IEND';
}

async function renderOg(outFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banks-og-'));
  const page = path.join(tmp, 'og.html');
  fs.writeFileSync(page, ogHtml());
  const done = (by) => {
    const [w, h] = pngSize(outFile);
    if (w === 1200 && h === 630) return by;
    warnings.push(`og-banks.png came out ${w} by ${h} instead of 1200 by 630.`);
    return by;
  };
  try {
    for (const mod of ['playwright', 'playwright-core', '@playwright/test']) {
      let chromium;
      try { const pw = await import(mod); chromium = pw.chromium || (pw.default && pw.default.chromium); } catch { continue; }
      if (!chromium) continue;
      try {
        const browser = await chromium.launch();
        const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
        await tab.goto(pathToFileURL(page).href, { waitUntil: 'networkidle' });
        await tab.evaluate(() => document.fonts.ready);
        await tab.screenshot({ path: outFile });
        await browser.close();
        return done('Playwright');
      } catch (e) {
        warnings.push(`Playwright is installed but could not render the image (${e.message.split('\n')[0]}); trying Chrome.`);
      }
    }
    const chrome = findChrome();
    if (!chrome) return null;
    // Chrome writes the picture and then, in some versions, stays open. So the build waits for the
    // finished file, not for Chrome to leave, and writes into the temp folder so that an image from
    // an earlier build is never taken for a new one.
    const shot = path.join(tmp, 'og.png');
    const proc = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--force-device-scale-factor=1', `--user-data-dir=${path.join(tmp, 'profile')}`, '--window-size=1200,630',
      '--virtual-time-budget=10000', `--screenshot=${shot}`, pathToFileURL(page).href,
    ], { stdio: 'ignore' });
    let exited = false;
    const gone = new Promise((resolve) => { proc.once('exit', () => { exited = true; resolve(); }); proc.once('error', () => { exited = true; resolve(); }); });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = Date.now() + 60000;
    while (!pngComplete(shot) && !exited && Date.now() < until) await wait(100);
    if (!exited) { proc.kill(); await Promise.race([gone, wait(3000)]); }
    if (!exited) { proc.kill('SIGKILL'); await Promise.race([gone, wait(2000)]); }
    if (pngComplete(shot)) {
      fs.copyFileSync(shot, outFile);
      return done('Chrome');
    }
    warnings.push('Chrome did not render og-banks.png within a minute.');
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* it is in the temp folder anyway */ }
  }
}

function report() {
  const on = (o) => Object.entries(o).filter(([, v]) => v === true).map(([k]) => k);
  const shown = gens.en.team.map((p) => `${p.name}${p.photo ? '' : ' (no photo, initials shown)'}`).join(', ');
  const flagsOn = on(cfg.flags).concat(cfg.flags.aiPolicyUrl ? ['aiPolicyUrl'] : []);
  console.log(`\nBuilt /banks for ${today}`);
  console.log(`  clients named: ${on(cfg.clients).join(', ') || 'none, fallback wording everywhere'}`);
  console.log(`  team shown:    ${shown}`);
  console.log(`  flags on:      ${flagsOn.join(', ') || 'none'}`);
  console.log(`  links:         booking ${cfg.links.booking || '-'}, email ${cfg.links.email || '-'}, AWS ${cfg.links.awsContactEmail || '-'}`);
  console.log(`  wrote ${path.relative(ROOT, path.join(outDir, 'banks.html')) || 'banks.html'} (${kb(bytes)}), HANDOVER.md${ogBy ? `, og-banks.png (${ogBy})` : ''}`);
  console.log('  checks passed: no em or en dash, no unapproved client or hidden person, under 150 KB');
  if (pdfs) console.log(`  PDFs:          ${pdfs.map((x) => `${x.name} (${x.pages} pages, ${kb(x.data.length)})`).join(', ')}`);
  if (filmOut) console.log(`  film:          ${FILES.film} (${film.duration || 'length unknown'}, ${mb(filmOut.bytes)}, about ${mb(filmOut.sent)} as sent) and ${FILES.poster}, written next to the page`);
  const wanted = ['coderpush', 'aws-advanced-tier', 'aws-ai-competency', ...(cfg.flags.isoMark ? ['iso-27001'] : []), ...Object.keys(cfg.clients).filter((k) => cfg.clients[k])];
  const used = gens.en.logosUsed;
  console.log(`  logos:         ${used.length ? `${used.join(', ')} (${kb(used.reduce((n, k) => n + logos[k].bytes, 0))} embedded)` : 'none yet'}`);
  const missing = wanted.filter((k) => !logos[k]);
  if (missing.length) console.log(`  logo files to add in ${LOGO_DIR}: ${missing.map((k) => `${k}.svg`).join(', ')}`);
  if (warnings.length) console.log(`\n${warnings.map((w) => `  ! ${w}`).join('\n')}`);
  console.log('');
}
