// Checks of the page for AWS teams, dist/aws.html, driven through Chrome DevTools.
// run.mjs starts the servers and calls this. On its own: node checks/aws.mjs <httpOrigin> <fileUrl>
// The page shares its template with the banks page, so this file checks what is its own: the AWS copy,
// the wording that must not appear, the nine use cases, and that everything else still works.
import { launch, sleep } from './cdp.mjs';
const [WEB, FILE] = process.argv.slice(2);
const HTTP = `${WEB}/aws/`;
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const b = await launch(9345);
let p = await b.newPage();
const fresh = async () => { await p.close(); p = await b.newPage(); };
const H1 = { en: "Bring us in when a bank's AI is stuck at pilot.", vi: 'Hãy gọi chúng tôi khi AI của ngân hàng mắc kẹt ở giai đoạn thử nghiệm.' };
// Wording AWS teams should not meet on this page, in either language, shown or hidden.
const BANNED = /on[\s-]?prem|copilot|data cent(?:re|er)|trung tâm dữ liệu/i;
const UC_KEYS = ['contact-centre', 'sales-call-compliance', 'rm-assistant', 'credit-memo', 'knowledge-assistant', 'governed-analytics', 'investment-assistant', 'ai-law-evidence', 'ai-native-engineering'];

try {
  // 1. Both languages, from a server and from disk.
  for (const [label, base] of [['server', HTTP], ['disk', FILE]]) {
    for (const lang of ['en', 'vi']) {
      await fresh();
      await p.viewport(1280, 900);
      await p.goto(`${base}?lang=${lang}`);
      const st = await p.eval(`(() => {
        const shown = (sel) => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length);
        return { lang: document.documentElement.lang, door: document.documentElement.getAttribute('data-door'),
          h1: shown('h1').map(h => h.innerText.trim()), otherLang: shown('${lang === 'en' ? '.vi' : '.en'}').length,
          bankParts: document.querySelectorAll('.d-bank').length, pressed: [...document.querySelectorAll('[aria-pressed=true]')].map(x => x.getAttribute('data-lang-btn')).join() };
      })()`);
      ok(`${label}: ${lang} renders the AWS page`, st.lang === lang && st.door === 'aws' && st.h1.length === 1 && st.h1[0] === H1[lang] && st.otherLang === 0 && st.bankParts === 0 && st.pressed === lang, JSON.stringify(st));
      ok(`${label}: ${lang} no console errors`, p.logs.length === 0, p.logs.join(' | '));
    }
  }

  // 2. Wording: the whole file, hidden parts included, and the text a reader sees in each language.
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en`);
  const src = await p.eval(`fetch(location.href).then(r => r.text()).then(t => t.replace(/data:image\\/[a-z+.-]+;base64,[A-Za-z0-9+\\/=]+/g, 'data:image'))`);
  const hit = src.match(BANNED);
  ok('the file has no on-prem, Copilot or own-data-centre wording, in either language', !hit, hit ? src.slice(Math.max(0, hit.index - 60), hit.index + 60).replace(/\s+/g, ' ') : `${Math.round(src.length / 1000)} KB read`);
  ok('the file has no em dash or en dash', !new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`).test(src));
  const head = await p.eval(`({ robots: (document.querySelector('meta[name=robots]') || {}).content || '', canonical: document.querySelector('link[rel=canonical]').getAttribute('href'), og: document.querySelector('meta[property="og:image"]').content, title: document.title, desc: document.querySelector('meta[name=description]').content })`);
  ok('head: its own address, not listed by search engines, its own preview image', head.robots === 'noindex' && head.canonical === 'https://coderpush.com/aws' && head.og === 'https://coderpush.com/aws/og-aws.png' && /on AWS/.test(head.title) && !BANNED.test(head.desc), JSON.stringify(head));

  // 3. Sections, in the order an AWS reader meets them.
  const order = await p.eval(`[...document.querySelectorAll('main > section')].filter(s => s.getClientRects().length).map(s => s.id)`);
  ok('sections: when to bring us in comes right after the hero, the use cases after the pattern', order.join() === 'top,when,gap,clock,pattern,usecases,proof,safety,team,offer,faq', order.join());
  const when = await p.eval(`[...document.querySelectorAll('#when li')].map(l => l.innerText.trim())`);
  ok('when to bring us in: six triggers, data in Vietnam with no alternative named', when.length === 6 && when[2] === 'Data must stay in Vietnam.', when[2]);

  // 4. The use cases.
  for (const lang of ['en', 'vi']) {
    await fresh();
    await p.viewport(1280, 900);
    await p.goto(`${HTTP}?lang=${lang}`);
    const uc = await p.eval(`(() => {
      const cards = [...document.querySelectorAll('#usecases .ucs .card')];
      const vis = (e) => e && e.getClientRects().length ? e.innerText.trim() : '';
      return { keys: cards.map(c => c.getAttribute('data-uc')),
        labels: [...new Set(cards.flatMap(c => [...c.querySelectorAll('.kl')].map(vis)))],
        aws: cards.map(c => vis(c.querySelector('.on-aws'))),
        rows: cards.map(c => [...c.querySelectorAll('.kv')].filter(r => r.getClientRects().length).length),
        headline: vis(document.querySelector('#usecases h2')) };
    })()`);
    const labels = lang === 'en' ? ['On AWS', 'KPI', 'Proof'] : ['Trên AWS', 'KPI', 'Minh chứng'];
    ok(`${lang}: nine use cases in order, each with a labelled On AWS row and a KPI`, uc.keys.join() === UC_KEYS.join() && uc.labels.join() === labels.join() && uc.aws.every((t) => t.length > 30 && /AWS|Amazon|Kiro/.test(t)) && uc.rows.every((n) => n === 2 || n === 3), JSON.stringify({ keys: uc.keys.length, labels: uc.labels, rows: uc.rows }));
    ok(`${lang}: the contact-centre case names speech to text on AWS and Quick as the front end`, /Local Zone/.test(uc.aws[0]) && /Amazon Bedrock/.test(uc.aws[0]) && /Amazon Quick/.test(uc.aws[0]), uc.aws[0]);
  }
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?for=AWS+Vietnam&uc=ai-law-evidence,contact-centre,rm-copilot&lang=en`);
  const pl = await p.eval(`({ greet: document.querySelector('.pf').innerText.trim(), order: [...document.querySelectorAll('.ucs [data-uc]')].map(c => c.getAttribute('data-uc')).slice(0, 3), picked: document.querySelectorAll('.ucs .picked').length })`);
  ok('personal link: greeting, picked use cases first, a key from the banks page ignored', pl.greet.startsWith('Prepared for AWS Vietnam') && pl.order.slice(0, 2).join() === 'ai-law-evidence,contact-centre' && pl.picked === 2, JSON.stringify(pl));

  // 5. The pattern: two places for the data, both on AWS.
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en#deploy=onprem`);
  const dep = await p.eval(`({ options: [...document.querySelectorAll('input[name=deploy]')].map(r => r.value), checked: (document.querySelector('input[name=deploy]:checked') || {}).value, caption: [...document.querySelectorAll('.cap')].filter(c => c.getClientRects().length).map(c => c.innerText.trim()), store: document.querySelector('.dg').innerText.includes('Hanoi Local Zone') })`);
  ok('deployment selector: AWS Region and Hanoi Local Zone only, and an unknown choice in the address changes nothing', dep.options.join() === 'region,localzone' && dep.checked === 'localzone' && dep.caption.length === 1 && dep.store, JSON.stringify(dep));
  await p.eval(`document.querySelector('label[for=dep-region]').click()`);
  await sleep(150);
  ok('choosing AWS Region puts it in the address and redraws the diagram', await p.eval(`location.hash === '#deploy=region' && getComputedStyle(document.querySelector('.bd-v')).display === 'block' && [...document.querySelectorAll('.cap')].filter(c => c.getClientRects().length)[0].id === 'cap-region'`));

  // 6. Proof and FAQ.
  const pf = await p.eval(`({ titles: [...document.querySelectorAll('#proof .card h3')].map(h => h.innerText.trim()), faq: [...document.querySelectorAll('#faq details')].map(d => d.getAttribute('data-faq')), faqHead: document.querySelector('#faq h2').innerText.trim(), film: document.querySelectorAll('[data-video], .vp, dialog').length })`);
  ok('proof: AWS workloads first, Presight kept with no place named', pf.titles.length === 6 && pf.titles[0].startsWith("T'FOX") && pf.titles[1] === 'Customer Data Platform on AWS' && pf.titles[3] === 'Presight, governed AI analytics', pf.titles.join(' | '));
  ok('FAQ: six questions under their own headline, without the one about working off AWS', pf.faq.join() === 'data-location,ownership,contract,aws-funding,time-to-live,security-review' && pf.faqHead.length > 10, pf.faq.join());
  ok('no film on this page', pf.film === 0 && !p.requests.some((u) => u.includes('banks-film')));

  // 7. Language switch and the PDF.
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en`);
  await p.eval(`window.__marker = 5; document.querySelector('[data-lang-btn=vi]').click()`);
  await sleep(200);
  const sw = await p.eval(`(async () => { const a = document.querySelector('a[data-pdf]'); const r = await fetch(a.href); const head = new TextDecoder('latin1').decode((await r.arrayBuffer()).slice(0, 5)); return { search: location.search, marker: window.__marker, lang: document.documentElement.lang, hrefs: [...document.querySelectorAll('a[data-pdf]')].map(x => x.getAttribute('href')), label: a.innerText.trim(), status: r.status, head }; })()`);
  ok('language switch: no reload, no door in the address', sw.search === '?lang=vi' && sw.marker === 5 && sw.lang === 'vi', JSON.stringify({ search: sw.search, marker: sw.marker }));
  ok('both PDF buttons give this page in the language in view', sw.hrefs.length === 2 && sw.hrefs.every((h) => h === 'coderpush-aws-profile-vi.pdf') && sw.label === 'Tải PDF' && sw.status === 200 && sw.head === '%PDF-', JSON.stringify(sw));
  await fresh();
  await p.goto(`${WEB}/aws?lang=en`);
  ok('at /aws without the slash the PDF is found at /aws/', (await p.eval(`document.querySelector('a[data-pdf]').getAttribute('href')`)) === '/aws/coderpush-aws-profile-en.pdf');

  // 8. 360 px: no sideways scroll, in both languages and both diagram states, with every panel open.
  await fresh();
  await p.viewport(360, 740, true);
  const widths = [];
  for (const lang of ['en', 'vi']) {
    for (const st of ['region', 'localzone']) {
      await p.goto(`${HTTP}?lang=${lang}&for=${encodeURIComponent('Amazon Web Services Vietnam Company Limited')}&s=${st}#deploy=${st}`, { settle: 300 });
      await p.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
      const w = await p.eval(`({ sw: document.documentElement.scrollWidth, over: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map(e => e.tagName + '.' + e.className).slice(0, 4) })`);
      widths.push(`${lang}/${st}: ${w.sw}${w.over.length ? ' ' + w.over.join(' ') : ''}`);
    }
  }
  const bad = widths.filter((x) => !/: 360$/.test(x));
  ok('360 px wide: no sideways scroll (2 languages x 2 diagram states, panels open)', bad.length === 0, bad.join(' | ') || `${widths.length} layouts`);

  // 9. Keyboard: every stop shows where it is.
  await fresh();
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en`);
  const seq = [];
  for (let i = 0; i < 60; i++) {
    await p.key('Tab', 'Tab', 9);
    const f = await p.eval(`(() => { const a = document.activeElement; if (!a || a === document.body) return null;
      let t = a; if (a.id && a.id.startsWith('dep-')) t = document.querySelector('label[for=' + a.id + ']');
      const cs = getComputedStyle(t), r = t.getBoundingClientRect();
      return { d: a.tagName.toLowerCase() + (a.getAttribute('data-cta') ? '[' + a.getAttribute('data-cta') + ']' : a.id ? '#' + a.id : ''), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1, visible: r.width > 0 && r.height > 0 }; })()`);
    if (!f) break;
    seq.push(f);
  }
  const noRing = seq.filter((f) => !f.ring || !f.visible).map((f) => f.d);
  ok('keyboard: every stop is visible with a focus ring, and the main actions are reachable', seq.length >= 12 && noRing.length === 0 && ['a[header-pdf]', 'a[hero-share]', 'input#dep-localzone', 'a[faq-intro]', 'a[faq-pdf]'].every((d) => seq.some((f) => f.d === d)), noRing.join(',') || seq.map((f) => f.d).join(' '));

  // 10. Reduced motion, and print.
  await fresh();
  await p.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en`);
  const rm = await p.eval(`({ anims: document.getAnimations().length, hidden: [...document.querySelectorAll('.rv')].filter(e => getComputedStyle(e).opacity !== '1').length, built: document.querySelector('.dg').classList.contains('built') })`);
  ok('reduced motion: no animation, everything visible', rm.anims === 0 && rm.hidden === 0 && rm.built, JSON.stringify(rm));
  await p.eval(`window.dispatchEvent(new Event('beforeprint')), 1`);
  await p.S('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(300);
  const pr = await p.eval(`({ bg: getComputedStyle(document.body).backgroundColor, hidden: [...document.querySelectorAll('.sw, .hb, [data-pdf], #privacy')].filter(e => e.getClientRects().length).length, closed: [...document.querySelectorAll('details')].filter(d => !d.open).length, share: [...document.querySelectorAll('a[data-cta=hero-share]')].filter(e => e.getClientRects().length).length })`);
  ok('print: white paper, switches and download buttons left out, every answer open', pr.bg === 'rgb(255, 255, 255)' && pr.hidden === 0 && pr.closed === 0 && pr.share === 1, JSON.stringify(pr));

  // 11. Fonts: every visible letter in Geist, in both languages.
  for (const lang of ['vi', 'en']) {
    await fresh();
    await p.viewport(1280, 900);
    await p.goto(`${HTTP}?lang=${lang}`, { settle: 800 });
    await p.eval(`(() => {
      document.querySelectorAll('details').forEach(d => d.open = true);
      document.querySelectorAll('.rv').forEach(e => e.classList.add('in'));
      document.querySelector('.dg').classList.add('built');
      document.querySelectorAll('body *').forEach(e => { if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length) e.setAttribute('data-ft', ''); });
      return document.fonts.ready.then(() => new Promise(r => setTimeout(r, 1200)));
    })()`);
    const { root } = await p.S('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await p.S('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-ft]' });
    const fams = {};
    for (const id of nodeIds) {
      const { fonts } = await p.S('CSS.getPlatformFontsForNode', { nodeId: id });
      for (const f of fonts) { const k = `${f.familyName}${f.isCustomFont ? '' : ' (system)'}`; fams[k] = (fams[k] || 0) + f.glyphCount; }
    }
    ok(`${lang}: all text in Geist, no other font`, Object.keys(fams).length > 0 && Object.keys(fams).every((f) => f === 'Geist' || f === 'Geist Thin'), `${JSON.stringify(fams)} over ${nodeIds.length} text elements`);
  }

  // 12. Analytics and cookies.
  await fresh();
  await p.S('Page.addScriptToEvaluateOnNewDocument', { source: "window.__ev = []; window.va = function () { window.__ev.push(Array.from(arguments)); }; addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[data-cta]'); if (a) e.preventDefault(); }, true);" });
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=en`);
  await sleep(5400);
  await p.eval(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('label[for=dep-region]').click(); await w(100);
    document.querySelector('#faq summary').click(); await w(100);
    document.querySelector('a[data-cta=hero-share].en').click(); await w(100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await w(40); }
    await w(300);
  })()`);
  const ev = await p.eval('window.__ev');
  const names = [...new Set(ev.map((e) => e[1].name))].sort();
  const doors = [...new Set(ev.filter((e) => e[1].data && e[1].data.door).map((e) => e[1].data.door))];
  const tooMany = ev.filter((e) => e[1].data && Object.keys(e[1].data).length > 2).map((e) => e[1].name);
  ok('analytics: events fire, each with at most two properties, and the door is always aws', ['cta_click', 'deploy_select', 'faq_open', 'page_open', 'section_view'].every((n) => names.includes(n)) && doors.join() === 'aws' && tooMany.length === 0 && ev.some((e) => e[1].name === 'section_view' && e[1].data.section === 'when'), `${names.join(',')} doors ${doors.join()}`);
  const cookies = await p.S('Network.getCookies', { urls: [HTTP] });
  ok('the page sets no cookies', cookies.cookies.length === 0 && (await p.eval('document.cookie')) === '');

  // 13. Without JavaScript: English, the AWS content, answers that still open, and a PDF link that still works.
  await fresh();
  await p.S('Emulation.setScriptExecutionDisabled', { value: true });
  await p.viewport(1280, 900);
  await p.goto(`${HTTP}?lang=vi`);
  const { root } = await p.S('DOM.getDocument', { depth: -1 });
  const summ = await p.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#faq summary' });
  await p.S('DOM.scrollIntoViewIfNeeded', { nodeId: summ.nodeId });
  const box = await p.S('DOM.getBoxModel', { nodeId: summ.nodeId });
  const [x1, y1, , , x3, y3] = box.model.content;
  for (const type of ['mousePressed', 'mouseReleased']) await p.S('Input.dispatchMouseEvent', { type, x: (x1 + x3) / 2, y: (y1 + y3) / 2, button: 'left', clickCount: 1 });
  await sleep(200);
  const det = await p.S('DOM.querySelector', { nodeId: root.nodeId, selector: '#faq details[open]' });
  await p.S('Emulation.setScriptExecutionDisabled', { value: false });
  const nojs = await p.eval(`({ lang: document.documentElement.lang, door: document.documentElement.getAttribute('data-door'), h1: [...document.querySelectorAll('h1')].filter(h => h.getClientRects().length).map(h => h.innerText.trim()), vi: [...document.querySelectorAll('.vi')].some(e => e.getClientRects().length), faded: [...document.querySelectorAll('.rv')].filter(e => getComputedStyle(e).opacity !== '1').length, ucs: [...document.querySelectorAll('.ucs .card')].filter(e => e.getClientRects().length).length, pdf: [...document.querySelectorAll('a[data-pdf]')].map(a => a.getAttribute('href')).join(), sw: [...document.querySelectorAll('.sw')].some(e => e.getClientRects().length) })`);
  ok('no JavaScript: English, the AWS page in full, FAQ answers still open, the English PDF', nojs.lang === 'en' && nojs.door === 'aws' && nojs.h1.join() === H1.en && !nojs.vi && nojs.faded === 0 && nojs.ucs === 9 && det.nodeId > 0 && nojs.pdf === 'coderpush-aws-profile-en.pdf,coderpush-aws-profile-en.pdf' && !nojs.sw, JSON.stringify(nojs));
} finally { await b.close(); }

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} AWS page checks passed`);
process.exit(failed ? 1 : 0);
