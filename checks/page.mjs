// The checks of SPEC.md section 9 for dist/banks.html, driven through Chrome DevTools.
// run.mjs starts the servers and calls this. On its own: node checks/page.mjs <httpBase> <fileUrl> [plainHttpBase]
// They describe the page as config.json has it today: clients named, three experts shown, the film on.
import { launch, sleep } from './cdp.mjs';
const [HTTP, FILE, PLAIN] = process.argv.slice(2);
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const b = await launch(9340);
let p = await b.newPage();
const fresh = async () => { await p.close(); p = await b.newPage(); };
const views = [['en', 'bank'], ['vi', 'bank'], ['en', 'aws'], ['vi', 'aws']];
const q = (lang, door, extra = '') => `?lang=${lang}${door === 'aws' ? '&door=aws' : ''}${extra}`;
const expectH1 = { 'en-bank': 'Production AI for Vietnamese banks.', 'vi-bank': 'AI vận hành thật cho ngân hàng Việt Nam.', 'en-aws': "Bring us in when a bank's AI is stuck at pilot.", 'vi-aws': 'Hãy gọi chúng tôi khi AI của ngân hàng mắc kẹt ở giai đoạn thử nghiệm.' };
const visibleH1 = `[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length).map(h => h.innerText.trim())`;

// 1. Console errors and the four views, from disk and from local servers.
for (const [label, base] of [['disk', FILE], ['server gzip', HTTP], ['server plain', PLAIN]].filter(([, x]) => x)) {
  for (const [lang, door] of views) {
    await fresh();
    await p.viewport(1280, 900);
    await p.goto(base + q(lang, door));
    const st = await p.eval(`(() => {
      const h1 = ${visibleH1};
      const other = document.querySelectorAll('${lang === 'en' ? '.vi' : '.en'}');
      const hiddenOther = [...other].every(e => !e.getClientRects().length);
      const doorHidden = [...document.querySelectorAll('${door === 'aws' ? '.d-bank' : '.d-aws'}')].every(e => !e.getClientRects().length);
      const doorShown = [...document.querySelectorAll('${door === 'aws' ? '.d-aws' : '.d-bank'}')].filter(e => !e.closest('dialog:not([open])')).every(e => e.getClientRects().length);
      return { lang: document.documentElement.lang, door: document.documentElement.getAttribute('data-door') || 'bank', h1, hiddenOther, doorHidden, doorShown, pressed: [...document.querySelectorAll('[aria-pressed=true]')].map(x => x.getAttribute('data-lang-btn')).join(','), doorSwitch: document.querySelectorAll('[data-door-btn], .sw-door').length };
    })()`);
    const good = st.lang === lang && st.door === door && st.h1.length === 1 && st.h1[0] === expectH1[`${lang}-${door}`] && st.hiddenOther && st.doorHidden && st.doorShown && st.pressed === lang && st.doorSwitch === 0;
    ok(`${label}: ${lang}/${door} renders`, good, good ? '' : JSON.stringify(st));
    ok(`${label}: ${lang}/${door} no console errors`, p.logs.length === 0, p.logs.join(' | '));
  }
}

// 2. Browser language default: no lang, Vietnamese browser gets Vietnamese.
await fresh();
await p.S('Emulation.setLocaleOverride', { locale: 'vi-VN' }).catch(() => {});
await p.S('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 Chrome/140', acceptLanguage: 'vi-VN,vi', platform: 'MacIntel' });
await p.S('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'language', { get: () => 'vi-VN' });" });
await p.goto(HTTP);
ok('no lang + Vietnamese browser opens Vietnamese', (await p.eval('document.documentElement.lang')) === 'vi');
await fresh();
await p.goto(HTTP);
ok('no lang + English browser opens English', (await p.eval('document.documentElement.lang')) === 'en');

// 3. Personal link.
await fresh();
await p.viewport(1280, 900);
await p.goto(HTTP + '?for=Example+Bank&uc=contact-centre,governed-analytics&lang=vi');
let pl = await p.eval(`(() => ({
  greet: document.querySelector('.pf').getClientRects().length ? document.querySelector('.pf').innerText.trim() : null,
  order: [...document.querySelectorAll('.ucs [data-uc]')].map(c => c.getAttribute('data-uc')),
  tags: [...document.querySelectorAll('.ucs .tag')].filter(t => t.getClientRects().length).map(t => t.closest('[data-uc]').getAttribute('data-uc') + ':' + t.innerText.trim()),
  book: (() => { const a = document.querySelector('a[data-cta=hero-book].vi'); return { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }; })(),
  share: document.querySelector('a[data-cta=hero-share].vi').getAttribute('href'),
}))()`);
ok('personal link: greeting above the headline', pl.greet && pl.greet.startsWith('Dành riêng cho Example Bank'), pl.greet);
ok('personal link: picked use cases first', pl.order.slice(0, 2).join() === 'contact-centre,governed-analytics' && pl.order.length === 6, pl.order.join());
ok('personal link: "Gợi ý riêng" tag on the picks only', pl.tags.join() === 'contact-centre:Gợi ý riêng,governed-analytics:Gợi ý riêng', pl.tags.join());
// The booking buttons open links.booking when config.json has one, and otherwise an email. Emails name the company.
const bookOk = pl.book.href.startsWith('mailto:') ? decodeURIComponent(pl.book.href).includes('Example Bank')
  : /^https:\/\//.test(pl.book.href) && pl.book.target === '_blank' && pl.book.rel === 'noopener';
ok('personal link: the booking button opens the booking page in a new tab, or an email naming the company', bookOk, JSON.stringify(pl.book));
ok('personal link: email subjects name the company', pl.share.startsWith('mailto:') && decodeURIComponent(pl.share).includes('Example Bank'), decodeURIComponent(pl.share));
ok('personal link: no console errors', p.logs.length === 0, p.logs.join(' | '));

// 4. A for value containing HTML shows as plain text; unknown keys ignored; 60-character cap.
await fresh();
let dialogs = 0;
const evil = '<img src=x onerror="window.__x=1;alert(1)"><script>window.__y=1<\/script><b>Bold</b>';
await p.goto(HTTP + '?for=' + encodeURIComponent(evil) + '&uc=nope,ekyc-deepfake,,EKYC-DEEPFAKE');
await sleep(500);
pl = await p.eval(`(() => ({
  children: [...document.querySelectorAll('.org')].reduce((n, e) => n + e.children.length, 0),
  text: document.querySelector('.org').textContent,
  imgs: document.querySelectorAll('.pf img, .pf script, .pf b').length,
  x: typeof window.__x, y: typeof window.__y,
  order: [...document.querySelectorAll('.ucs [data-uc]')].map(c => c.getAttribute('data-uc')).slice(0, 2),
  picked: document.querySelectorAll('.ucs .picked').length,
}))()`);
const capped = Array.from(evil).slice(0, 60).join('');
ok('HTML in for= stays plain text', pl.children === 0 && pl.imgs === 0 && pl.x === 'undefined' && pl.y === 'undefined' && pl.text === capped, JSON.stringify(pl));
ok('for= capped at 60 characters', Array.from(pl.text).length === 60, `${Array.from(pl.text).length} chars`);
ok('unknown use-case keys ignored', pl.order[0] === 'ekyc-deepfake' && pl.picked === 1, JSON.stringify(pl.order));
ok('HTML in for=: no console errors', p.logs.length === 0, p.logs.join(' | '));

// 5. Switches: URL updates without reload, reader stays at the same section, hash for the diagram.
await fresh();
await p.viewport(1280, 900);
await p.goto(HTTP + '?for=Acme&uc=credit-memo');
await p.eval(`window.__marker = 42; document.getElementById('proof').scrollIntoView(); window.scrollBy(0, 200); new Promise(r => setTimeout(r, 400))`);
const before = await p.eval(`document.getElementById('proof').getBoundingClientRect().top`);
await p.eval(`document.querySelector('[data-lang-btn=vi]').click()`);
await sleep(200);
let sw = await p.eval(`({ search: location.search, marker: window.__marker, top: document.getElementById('proof').getBoundingClientRect().top, lang: document.documentElement.lang })`);
ok('language switch updates the URL without a reload', sw.search === '?for=Acme&uc=credit-memo&lang=vi' && sw.marker === 42 && sw.lang === 'vi', JSON.stringify(sw));
ok('language switch keeps the reader in the same section', Math.abs(sw.top - before) < 400, `proof top ${Math.round(before)} then ${Math.round(sw.top)}`);
ok('header has no door switch, only EN and VI', await p.eval(`document.querySelectorAll('.hd button').length === 2 && !document.querySelector('[data-door-btn]')`));
await p.eval(`document.querySelector('label[for=dep-onprem]').click()`);
await sleep(100);
ok('deployment choice goes into the hash', (await p.eval('location.hash')) === '#deploy=onprem');
await fresh();
await p.goto(HTTP + '#deploy=region');
ok('hash #deploy=region preselects the option', await p.eval(`document.getElementById('dep-region').checked && getComputedStyle(document.querySelector('.bd-v')).display === 'block'`));

// 6. 360 px: no sideways scroll in any view, diagram state or open panel.
await fresh();
await p.viewport(360, 740, true);
const widths = [];
for (const [lang, door] of views) {
  for (const st of ['region', 'localzone', 'onprem']) {
    await p.goto(HTTP + q(lang, door, `&for=${encodeURIComponent('Ngân hàng Thương mại Cổ phần Kỹ thương Việt Nam Chi nhánh Hà Nội số 1')}&uc=ekyc-deepfake&s=${st}#deploy=${st}`), { settle: 300 });
    await p.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
    const w = await p.eval(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map(e => e.tagName + '.' + e.className).slice(0, 5) })`);
    widths.push(`${lang}/${door}/${st}: ${w.sw}/${w.cw}${w.over.length ? ' ' + w.over.join(' ') : ''}`);
  }
}
const bad = widths.filter((x) => !/: 360\/360$/.test(x));
ok('360 px wide: no sideways scroll (4 views x 3 diagram states, panels open)', bad.length === 0, bad.join(' | ') || `${widths.length} layouts`);

// 7. Keyboard.
await fresh();
await p.viewport(1280, 900);
await p.goto(HTTP + '?lang=en');
const seq = [];
for (let i = 0; i < 70; i++) {
  await p.key('Tab', 'Tab', 9);
  const f = await p.eval(`(() => { const a = document.activeElement; if (!a || a === document.body) return null;
    let target = a; if (a.id && a.id.startsWith('dep-')) target = document.querySelector('label[for=' + a.id + ']');
    const cs = getComputedStyle(target); const r = target.getBoundingClientRect();
    return { d: a.tagName.toLowerCase() + (a.getAttribute('data-lang-btn') ? '[' + a.getAttribute('data-lang-btn') + ']' : a.getAttribute('data-door-btn') ? '[' + a.getAttribute('data-door-btn') + ']' : a.id ? '#' + a.id : a.getAttribute('data-cta') ? '[' + a.getAttribute('data-cta') + ']' : ''),
      ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' }; })()`);
  if (!f) break;
  seq.push(f);
}
const noRing = seq.filter((f) => !f.ring || !f.visible).map((f) => f.d);
ok('keyboard: every stop is visible with a focus ring', seq.length >= 15 && noRing.length === 0, noRing.join(',') || `${seq.length} stops`);
ok('keyboard: switches, CTAs, diagram and FAQ are reachable', ['button[en]', 'button[vi]', 'a[hero-book]', 'input#dep-localzone', 'summary', 'a[faq-intro]'].every((d) => seq.some((f) => f.d === d)), seq.map((f) => f.d).join(' '));
// activate by keyboard
await p.eval(`document.querySelector('[data-lang-btn=vi]').focus()`);
await p.key('Enter', 'Enter', 13);
await sleep(100);
const kLang = await p.eval('document.documentElement.lang');
await p.eval(`document.querySelector('[data-lang-btn=en]').focus()`);
await p.key(' ', 'Space', 32);
await sleep(100);
const kDoor = await p.eval(`document.documentElement.lang`);
await p.eval(`document.getElementById('dep-localzone').focus()`);
await p.key('ArrowRight', 'ArrowRight', 39);
await sleep(100);
const kRadio = await p.eval(`document.getElementById('dep-onprem').checked && location.hash`);
await p.eval(`document.querySelector('#faq summary').focus()`);
await p.key('Enter', 'Enter', 13);
await sleep(100);
const kFaq = await p.eval(`document.querySelector('#faq details').open`);
ok('keyboard: Enter/Space/arrows work the language switch, selector and FAQ', kLang === 'vi' && kDoor === 'en' && kRadio === '#deploy=onprem' && kFaq === true, JSON.stringify({ kLang, kDoor, kRadio, kFaq }));

// 8. Reduced motion.
for (const mode of ['reduce', 'no-preference']) {
  await fresh();
  await p.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode }] });
  await p.viewport(1280, 900);
  await p.goto(HTTP + '?lang=en');
  const m = await p.eval(`(() => ({
    anims: document.getAnimations().length,
    hidden: [...document.querySelectorAll('.rv')].filter(e => getComputedStyle(e).opacity !== '1').length,
    trans: [...document.querySelectorAll('.rv, .dg-l, .btn, .sw button')].filter(e => getComputedStyle(e).transitionDuration.split(',').some(t => parseFloat(t) > 0)).length,
    built: document.querySelector('.dg').classList.contains('built'),
    pulse: getComputedStyle(document.querySelector('.live .dot'), '::after').animationName,
  }))()`);
  if (mode === 'reduce') ok('reduced motion: no animation, no transitions, everything visible', m.anims === 0 && m.hidden === 0 && m.trans === 0 && m.built && m.pulse === 'none', JSON.stringify(m));
  else ok('motion allowed: live dot loops, reveals wait for scroll (control)', m.anims > 0 && m.hidden > 0 && m.pulse === 'pulse', JSON.stringify(m));
}

// 9. Fonts: every visible glyph in the brand fonts, Vietnamese and English.
async function fontsUsed(lang) {
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(HTTP + `?lang=${lang}&for=Ng%C3%A2n%20h%C3%A0ng`, { settle: 800 });
  await p.eval(`(() => {
    document.querySelectorAll('details').forEach(d => d.open = true);
    document.querySelectorAll('.rv').forEach(e => e.classList.add('in'));
    document.querySelector('.dg').classList.add('built');
    document.querySelectorAll('body *').forEach(e => { if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length) e.setAttribute('data-ft', ''); });
    const t = 'Ngân hàng tuân thủ Luật Trí tuệ nhân tạo; khử nhận dạng; Ưu tiên; Ổn định';
    for (const [k, v] of [['h', 'Geist'], ['b', 'Geist'], ['m', 'Geist']]) {
      const d = document.createElement('div'); d.id = 'probe-' + k; d.textContent = t; d.style.fontFamily = v; d.style.fontWeight = k === 'h' ? '600' : k === 'm' ? '500' : '400'; document.body.appendChild(d);
    }
    return document.fonts.ready.then(() => new Promise(r => setTimeout(r, 1500)));
  })()`);
  const { root } = await p.S('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await p.S('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-ft]' });
  const fams = {};
  for (const id of nodeIds) {
    const { fonts } = await p.S('CSS.getPlatformFontsForNode', { nodeId: id });
    for (const f of fonts) { const k = `${f.familyName}${f.isCustomFont ? '' : ' (system)'}`; fams[k] = (fams[k] || 0) + f.glyphCount; }
  }
  const probes = {};
  for (const k of ['h', 'b', 'm']) {
    const { nodeId } = await p.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#probe-' + k });
    probes[k] = (await p.S('CSS.getPlatformFontsForNode', { nodeId })).fonts.map((f) => `${f.familyName}${f.isCustomFont ? '' : ' (system)'}:${f.glyphCount}`).join(' ');
  }
  return { fams, probes, nodes: nodeIds.length };
}
const vi = await fontsUsed('vi');
const brand = (list) => (f) => list.some((n) => f === n || f === `${n} Thin`);
const viOk = Object.keys(vi.fams).every(brand(['Geist']));
ok('Vietnamese view: all text in Geist, no other font', viOk, JSON.stringify(vi.fams) + ` over ${vi.nodes} text elements`);
ok('Vietnamese test string: no fallback letters at weights 400, 500 and 600', ['h', 'b', 'm'].every((k) => /^Geist:73$/.test(vi.probes[k])), JSON.stringify(vi.probes));
const en = await fontsUsed('en');
ok('English view: all text in Geist, no other font', Object.keys(en.fams).every(brand(['Geist'])), JSON.stringify(en.fams));

// 10. Analytics events and properties, with a stand-in for Vercel's va().
await fresh();
await p.S('Page.addScriptToEvaluateOnNewDocument', { source: "window.__ev = []; window.va = function () { window.__ev.push(Array.from(arguments)); }; addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[data-cta]'); if (a) e.preventDefault(); }, true);" });
await p.viewport(1280, 900);
await p.goto(HTTP + '?for=Test+Bank&lang=en');
await sleep(5400);
await p.eval(`(async () => {
  const w = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('[data-lang-btn=vi]').click(); await w(100);
  document.querySelector('label[for=dep-region]').click(); await w(100);
  document.querySelector('#faq summary').click(); await w(100);
  document.querySelector('a[data-cta=faq-intro].vi').click(); await w(100);
  for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await w(40); }
  await w(300);
})()`);
const ev = await p.eval('window.__ev');
const names = [...new Set(ev.map((e) => e[1].name))].sort();
const tooMany = ev.filter((e) => e[1].data && Object.keys(e[1].data).length > 2).map((e) => e[1].name);
const po = ev.find((e) => e[1].name === 'page_open');
ok('analytics: all six events fire', ['cta_click', 'deploy_select', 'faq_open', 'locale_switch', 'page_open', 'section_view'].every((n) => names.includes(n)) && !names.includes('door_switch'), names.join(','));
ok('analytics: at most two properties per event', tooMany.length === 0, tooMany.join(','));
ok('analytics: page_open carries for', po && po[1].data.for === 'Test Bank', JSON.stringify(po && po[1]));
ok('analytics: sections counted', ev.filter((e) => e[1].name === 'section_view').length >= 10, `${ev.filter((e) => e[1].name === 'section_view').length} section_view events`);
await fresh();
await p.S('Page.addScriptToEvaluateOnNewDocument', { source: "window.__ev = []; window.va = function () { window.__ev.push(Array.from(arguments)); };" });
await p.S('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { get: () => true });" });
await p.goto(HTTP + '?for=Scanner');
await sleep(5600);
ok('analytics: no page_open while the page is not visible', !(await p.eval('window.__ev')).some((e) => e[1].name === 'page_open'));

// 11. No cookies.
const cookies = await p.S('Network.getCookies', { urls: [HTTP] });
ok('the page sets no cookies', cookies.cookies.length === 0 && (await p.eval('document.cookie')) === '');

// 12. Without JavaScript: English, bank door, everything visible, FAQ still expands.
await fresh();
await p.S('Emulation.setScriptExecutionDisabled', { value: true });
await p.viewport(1280, 900);
await p.goto(HTTP + '?lang=vi&door=aws');
const { root } = await p.S('DOM.getDocument', { depth: -1 });
const html = (await p.S('DOM.getOuterHTML', { nodeId: root.nodeId })).outerHTML;
const summ = await p.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#faq summary' });
await p.S('DOM.scrollIntoViewIfNeeded', { nodeId: summ.nodeId });
const box = await p.S('DOM.getBoxModel', { nodeId: summ.nodeId });
const [x1, y1, , , x3, y3] = box.model.content;
for (const type of ['mousePressed', 'mouseReleased']) await p.S('Input.dispatchMouseEvent', { type, x: (x1 + x3) / 2, y: (y1 + y3) / 2, button: 'left', clickCount: 1 });
await sleep(200);
const det = await p.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#faq details[open]' });
await p.S('Emulation.setScriptExecutionDisabled', { value: false });
const nojs = await p.eval(`(() => ({
  lang: document.documentElement.lang,
  enShown: [...document.querySelectorAll('.en')].some(e => e.getClientRects().length), viShown: [...document.querySelectorAll('.vi')].some(e => e.getClientRects().length),
  bank: [...document.querySelectorAll('.d-bank')].filter(e => !e.closest('dialog:not([open])')).every(e => e.getClientRects().length), aws: [...document.querySelectorAll('.d-aws')].some(e => e.getClientRects().length),
  film: [...document.querySelectorAll('.vp, [data-video]')].filter(e => e.getClientRects().length).length, heroCols: getComputedStyle(document.querySelector('.hr')).gridTemplateColumns.split(' ').length,
  faded: [...document.querySelectorAll('.rv')].filter(e => getComputedStyle(e).opacity !== '1').length,
  switches: [...document.querySelectorAll('.sw')].some(e => e.getClientRects().length),
}))()`);
ok('no JavaScript: English, bank door, all content visible', !/class="[^"]*\bjs\b/.test(html.slice(0, 300)) && nojs.lang === 'en' && nojs.enShown && !nojs.viShown && nojs.bank && !nojs.aws && nojs.faded === 0 && !nojs.switches, JSON.stringify(nojs));
ok('no JavaScript: FAQ answers still expand', det.nodeId > 0);
ok('no JavaScript: the film poster and button are left out, and the hero stays one column', nojs.film === 0 && nojs.heroCols === 1, JSON.stringify({ film: nojs.film, heroCols: nojs.heroCols }));

// 12b. Words kept together never sit directly in a flex or grid box (which would drop the spaces around them).
for (const lang of ['en', 'vi']) {
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(HTTP + `?lang=${lang}`);
  const sp = await p.eval(`(() => ({
    bad: [...document.querySelectorAll('.nw')].filter(e => /flex|grid/.test(getComputedStyle(e.parentElement).display)).map(e => e.parentElement.tagName + '.' + e.parentElement.className + ' > ' + e.textContent),
    btn: [...document.querySelectorAll('a[data-cta=hero-book]')].filter(a => a.getClientRects().length).map(a => a.innerText.trim()),
  }))()`);
  const want = lang === 'en' ? 'Book a use-case sprint' : 'Đặt lịch sprint 2 tuần';
  ok(`${lang}: spaces kept around words held together`, sp.bad.length === 0 && sp.btn[0] === want, JSON.stringify(sp));
}

// 12c. Logos: each one decodes, has a real size, and is named for screen readers (or backed by hidden text).
for (const [lang, w] of [['en', 1280], ['vi', 360]]) {
  await fresh();
  await p.viewport(w, 900, w < 700);
  await p.goto(HTTP + `?lang=${lang}`);
  const lg = await p.eval(`(async () => {
    const els = [...document.querySelectorAll('.logo')].filter(e => e.getClientRects().length);
    const out = { count: els.length, band: [], bad: [], cards: document.querySelectorAll('#proof .lchip .logo').length, badges: document.querySelectorAll('.hero .has-badge .logo').length };
    for (const e of els) {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const bi = cs.backgroundImage; const m = bi.startsWith('url("data:image') ? [bi, bi.slice(5, -2)] : null;
      let natural = 0;
      if (m) { const im = new Image(); im.src = m[1]; try { await im.decode(); natural = im.naturalWidth; } catch (err) {} }
      const named = e.getAttribute('role') === 'img' ? !!e.getAttribute('aria-label') : e.getAttribute('aria-hidden') === 'true';
      if (!m || !natural || r.width < 12 || r.height < 12 || !named) out.bad.push(e.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (e.closest('.lwp')) out.band.push(e.getAttribute('aria-label'));
    }
    return out;
  })()`);
  ok(`${lang} at ${w} px: logos decode, are sized and named`, lg.bad.length === 0 && lg.band.join() === 'TPS,MB Bank,TPBank,Ensign,BuyMed,Sleek,Nanoco' && lg.cards === 6 && lg.badges === 2, JSON.stringify(lg));
  ok(`${lang} at ${w} px: no console errors with logos`, p.logs.length === 0, p.logs.join(' | '));
}

// 12d. Team: the three experts with their photos, and no trace of anyone switched off.
await fresh();
await p.viewport(1280, 900);
await p.goto(HTTP + '?lang=en');
const tm = await p.eval(`(async () => {
  const cards = [...document.querySelectorAll('#team .card')];
  const imgs = cards.map(c => c.querySelector('img.avp'));
  for (const im of imgs) if (im) { try { await im.decode(); } catch (e) {} }
  return { names: cards.map(c => c.querySelector('h3 .en, h3').textContent.trim()), photos: imgs.map(im => im ? im.naturalWidth : 0),
    long: /Long Vu|V\u0169 Long/.test(document.documentElement.innerHTML), initials: document.querySelectorAll('#team .av').length };
})()`);
ok('team shows Harley, Ben and Andy with photos, and Long is nowhere in the file', tm.names.length === 3 && tm.photos.every((w) => w === 192) && !tm.long && tm.initials === 0, JSON.stringify(tm));

// 13. Live numbers.
await fresh();
await p.goto(HTTP + '?lang=en');
const days = await p.eval(`document.querySelector('.days .en').textContent`);
const expectDays = Math.round((Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - Date.UTC(2026, 3, 10)) / 864e5);
ok('T\'FOX day counter computed on load', days === `${expectDays} days in production`, days);

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
await b.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
