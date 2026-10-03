// Checks of the film player: poster, loading on demand, start with sound, closing, keyboard, phone sizes, disk.
// run.mjs starts the server and calls this. On its own: node checks/film.mjs <httpOrigin> <fileUrl> [policy]
// policy is Chrome's autoplay policy: document-user-activation-required (the desktop default), or
// user-gesture-required, which stands in for browsers that refuse sound until the film itself is pressed.
import { launch, sleep } from './cdp.mjs';
const [WEB, FILE, policy = 'document-user-activation-required'] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
const INIT = `(() => {
  const A = window.Audio; window.__audios = [];
  window.Audio = function (...a) { const x = new A(...a); window.__audios.push(x); return x; };
  window.Audio.prototype = A.prototype;
  window.va = function () { (window.__ev = window.__ev || []).push(JSON.stringify(arguments[1])); };
})();`;
const FILM_STATE = `(() => { const a = window.__audios[0], g = (i) => document.getElementById(i); return {
  audios: window.__audios.length, paused: a.paused, muted: a.muted, t: a.currentTime,
  time: g('time').textContent, soundHidden: g('sound').hidden, bigHidden: g('big').hidden,
  pp: g('pp').getAttribute('aria-label'), active: document.activeElement ? document.activeElement.id : null,
  cta: g('hot-cta').getAttribute('href'), ctaTarget: g('hot-cta').getAttribute('target'), w: innerWidth, h: innerHeight }; })()`;
const PAGE_STATE = `(() => { const d = document.getElementById('vid'), s = d.querySelector('.vs'), f = s.querySelector('iframe'), r = s.getBoundingClientRect(), dr = d.getBoundingClientRect(); return {
  open: d.open, frames: document.querySelectorAll('iframe').length, src: f ? f.getAttribute('src') : null, title: f ? f.title : null,
  on: s.classList.contains('on'), opacity: f ? getComputedStyle(f).opacity : null, stage: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
  dialog: [Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)], vw: innerWidth, vh: innerHeight,
  scrollW: document.documentElement.scrollWidth, active: document.activeElement ? (document.activeElement.tagName + (document.activeElement.hasAttribute('data-close') ? '[close]' : '')) : null,
  ev: (window.__ev || []).slice() }; })()`;
const secs = (st) => { const m = /^(\d+):(\d+)/.exec(st.time); return m ? +m[1] * 60 + +m[2] : -1; };
const filmReqs = (p) => p.requests.filter((u) => u.includes('banks-film.html')).length;
async function until(fn, ms = 8000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch {} await sleep(100); } return v; }

const b = await launch(9351, [`--autoplay-policy=${policy}`]);
try {
  // ---------- 1. served page, desktop ----------
  const p = await b.newPage();
  await p.init(INIT);
  await p.viewport(1280, 800);
  await p.goto(`${WEB}/banks/?lang=en`);
  const hero = await p.eval(`(() => { const a = document.querySelector('.vp'), i = a.querySelector('img'), r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), img: i.currentSrc || i.src, nw: i.naturalWidth, time: a.querySelector('.vp-time').textContent, w: Math.round(r.width), h: Math.round(r.height), btn: document.querySelector('.btn[data-video]').getAttribute('href') }; })()`);
  check('poster card shows the film frame and its length', hero.nw === 960 && hero.time === '1:10' && /banks-film-poster\.webp$/.test(hero.img), JSON.stringify(hero));
  check('poster and button link to the film file', hero.href === 'banks-film.html' && hero.btn === 'banks-film.html');
  check('nothing of the film is fetched before a click', filmReqs(p) === 0 && (await p.eval(PAGE_STATE)).frames === 0, `requests ${filmReqs(p)}`);

  await p.click('.vp', 8);   // with the meta key: must not open the player (headless opens no tab either)
  await sleep(300);
  check('a click with a modifier key leaves the player closed', (await p.eval(PAGE_STATE)).open === false);

  await p.click('.vp');
  const opened = await until(async () => { const s = await p.eval(PAGE_STATE); return s.open && s.frames === 1 ? s : null; });
  check('a click on the poster opens the player with the film in a frame', !!opened && opened.src === 'banks-film.html?autoplay=0', JSON.stringify(opened && { src: opened.src, title: opened.title }));
  check('the frame is named from the copy', !!opened && opened.title === 'Watch the 90-second overview', opened && opened.title);
  const shown = await until(async () => { const s = await p.eval(PAGE_STATE); return s.on && s.opacity === '1' ? s : null; });
  check('the film is revealed once it says it is ready', !!shown, JSON.stringify(shown && { on: shown.on, opacity: shown.opacity }));
  check('the film file was fetched once', filmReqs(p) === 1, `requests ${filmReqs(p)}`);
  const playing = await until(async () => { const s = await p.frameEval('banks-film', FILM_STATE); return !s.paused && s.t > 0.5 ? s : null; });
  const st = playing || await p.frameEval('banks-film', FILM_STATE);
  if (policy === 'document-user-activation-required') {
    check('the film starts by itself, with sound', !!playing && st.muted === false && st.soundHidden === true && st.bigHidden === true, JSON.stringify(st));
  } else {
    check('where sound is not allowed, the film starts muted and shows its sound button', st.muted === true && st.bigHidden === true && st.soundHidden === false, JSON.stringify(st));
  }
  check('the keyboard is inside the film', st.active === 'film', st.active);
  check("the film's button carries the page's booking link", st.cta === await p.eval(`document.querySelector('[data-cta="faq-intro"].en').getAttribute('href')`), st.cta);
  check('inside the player, a booking page opens in a new tab and an email does not', /^https?:/.test(st.cta) ? st.ctaTarget === '_blank' : st.ctaTarget === null, `${st.cta} target ${st.ctaTarget}`);
  const t1 = (await p.frameEval('banks-film', FILM_STATE)).time; await sleep(1500); const t2 = (await p.frameEval('banks-film', FILM_STATE)).time;
  check('the picture runs', t1 !== t2, `${t1} then ${t2}`);
  const geo = await p.eval(PAGE_STATE);
  check('the stage is 16 by 9 and inside the screen', Math.abs(geo.stage[2] / geo.stage[3] - 16 / 9) < 0.02 && geo.dialog[1] >= 0 && geo.dialog[1] + geo.dialog[3] <= geo.vh, JSON.stringify({ stage: geo.stage, dialog: geo.dialog, vh: geo.vh }));

  // space pauses, through the film's own keyboard handling
  await p.key(' ', 'Space', 32);
  await sleep(300);
  const paused = await p.frameEval('banks-film', FILM_STATE);
  check('Space pauses the film', paused.pp === 'Play' && paused.paused === true, JSON.stringify({ pp: paused.pp, paused: paused.paused }));
  await p.key(' ', 'Space', 32);
  await sleep(300);

  // the film's own booking link is counted on the page
  await p.frameEval('banks-film', `document.getElementById('hot-cta').addEventListener('click', (e) => e.preventDefault()), document.getElementById('hot-cta').click(), 1`);
  await sleep(300);
  const ev = (await p.eval(PAGE_STATE)).ev;
  check('opening and the film button are counted as cta_click', ev.some((e) => e.includes('poster-video')) && ev.some((e) => e.includes('film-book')), ev.join(' '));

  // Esc while the keyboard is in the film
  await p.key('Escape', 'Escape', 27);
  const closed = await until(async () => { const s = await p.eval(PAGE_STATE); return !s.open && s.frames === 0 ? s : null; }, 3000);
  check('Esc closes the player from inside the film', !!closed && closed.frames === 0, JSON.stringify(closed && { open: closed.open, frames: closed.frames }));
  check('closing removes the film, so it cannot keep playing', !!closed && closed.frames === 0 && closed.on === false);
  const focusBack = await p.eval(`document.activeElement && document.activeElement.className`);
  check('focus returns to the poster', /\bvp\b/.test(focusBack || ''), focusBack);

  // open from the button, close with Close, then with a click outside
  await p.click('.btn[data-video]');
  let s2 = await until(async () => { const s = await p.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  check('the button opens the player again, from the start', !!s2 && filmReqs(p) === 2, `requests ${filmReqs(p)}`);
  const again = await until(async () => { const s = await p.frameEval('banks-film', FILM_STATE); return secs(s) >= 1 && secs(s) < 8 ? s : null; });
  check('the film starts again at the beginning', !!again, JSON.stringify(again && { t: again.t, time: again.time }));
  await p.click('#vid [data-close]');
  await sleep(300);
  check('Close closes the player', (await p.eval(PAGE_STATE)).open === false);
  await p.click('.vp');
  await until(async () => (await p.eval(PAGE_STATE)).open);
  await p.clickAt(8, 8);
  await sleep(300);
  check('a click outside closes the player', (await p.eval(PAGE_STATE)).open === false);
  check('no console errors on the served page', p.logs.length === 0, p.logs.join(' | ').slice(0, 300));

  // keyboard only
  const k = await b.newPage();
  await k.init(INIT);
  await k.viewport(1280, 800);
  await k.goto(`${WEB}/banks/?lang=vi`);
  await k.eval(`document.querySelector('.btn[data-video]').focus(), 1`);
  await k.key('Enter', 'Enter', 13);
  const kOpen = await until(async () => { const s = await k.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  check('Enter on the button opens the player, with the Vietnamese name', !!kOpen && kOpen.title === 'Xem video 90 giây', kOpen && kOpen.title);
  const kPlay = await until(async () => { const s = await k.frameEval('banks-film', FILM_STATE); return secs(s) >= 1 ? s : null; });
  check('opened by keyboard, the film plays', !!kPlay, JSON.stringify(kPlay && { muted: kPlay.muted, t: kPlay.t }));
  await k.close();

  // ---------- 2. /banks without the trailing slash ----------
  const n = await b.newPage();
  await n.init(INIT);
  await n.viewport(1280, 800);
  await n.goto(`${WEB}/banks?lang=en`);
  await n.click('.vp');
  const ns = await until(async () => { const s = await n.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  check('at /banks without the slash the film is found at /banks/', !!ns && ns.src === '/banks/banks-film.html?autoplay=0', ns && ns.src);
  await n.close();

  // ---------- 3. phone, upright and on its side ----------
  const m = await b.newPage();
  await m.init(INIT);
  await m.viewport(360, 740, true);
  await m.goto(`${WEB}/banks/?lang=vi`);
  check('360 px: no sideways scroll with the poster', (await m.eval('document.documentElement.scrollWidth')) <= 360);
  await m.click('.vp');
  const ms = await until(async () => { const s = await m.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  check('360 px: the player fits the screen', !!ms && ms.dialog[0] >= 0 && ms.dialog[0] + ms.dialog[2] <= 360 && ms.scrollW <= 360 && ms.stage[2] >= 320, JSON.stringify(ms && { stage: ms.stage, dialog: ms.dialog }));
  await m.viewport(740, 360, true);
  await sleep(500);
  const ls = await m.eval(PAGE_STATE);
  const closeBox = await m.eval(`(() => { const r = document.querySelector('#vid [data-close]').getBoundingClientRect(); const a = document.querySelector('#vid .vd-bar a.vi'); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), book: getComputedStyle(a).display }; })()`);
  check('phone on its side: the film fills the height, Close stays in the corner', ls.stage[3] === 360 && Math.abs(ls.stage[2] - 640) <= 1 && closeBox.w > 0 && closeBox.y < 60 && closeBox.book === 'none', JSON.stringify({ stage: ls.stage, dialog: ls.dialog, closeBox }));
  await m.click('#vid [data-close]');
  await sleep(300);
  check('phone on its side: Close works', (await m.eval(PAGE_STATE)).open === false);
  check('no console errors on the phone', m.logs.length === 0, m.logs.join(' | ').slice(0, 300));
  await m.close();

  // ---------- 4. reduced motion ----------
  const r = await b.newPage();
  await r.init(INIT);
  await r.viewport(1280, 800);
  await r.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await r.goto(`${WEB}/banks/?lang=en`);
  await r.click('.vp');
  await until(async () => { const s = await r.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  await sleep(1200);
  const rs = await r.frameEval('banks-film', FILM_STATE);
  check('reduced motion: the film waits for its own play button', rs.paused === true && rs.bigHidden === false && rs.time.startsWith('0:00'), JSON.stringify({ paused: rs.paused, bigHidden: rs.bigHidden, time: rs.time }));
  const dot = await r.eval(`getComputedStyle(document.querySelector('.vs'), '::after').animationName`);
  check('reduced motion: no looping dot', dot === 'none', dot);
  await r.close();

  // ---------- 5. the film opened on its own ----------
  const o = await b.newPage();
  await o.init(INIT);
  await o.viewport(1280, 720);
  await o.goto(`${WEB}/banks/banks-film.html?autoplay=0`);
  await until(async () => o.eval('window.__filmReady === true'));
  await sleep(600);
  const os = await o.eval(FILM_STATE);
  check('opened on its own, the film is left as delivered (no start, no new tab rule)', os.paused === true && os.bigHidden === false && os.audios === 1 && os.ctaTarget === null, JSON.stringify(os));
  check('no console errors in the film on its own', o.logs.length === 0, o.logs.join(' | ').slice(0, 300));
  await o.close();
  await p.close();
} finally { await b.close(); }

// ---------- 6. from disk, without the file-access flag ----------
const bd = await launch(9352, [`--autoplay-policy=${policy}`, '--strict-files']);
try {
  const d = await bd.newPage();
  await d.init(INIT);
  await d.viewport(1280, 800);
  await d.goto(`${FILE}?lang=en`);
  const img = await d.eval(`document.querySelector('.vp img').naturalWidth`);
  check('from disk: the poster shows', img === 960, String(img));
  await d.click('.vp');
  const ds = await until(async () => { const s = await d.eval(PAGE_STATE); return s.open && s.on ? s : null; });
  check('from disk: the player opens and the film reports ready', !!ds && ds.src === 'banks-film.html?autoplay=0', JSON.stringify(ds && { on: ds.on, src: ds.src }));
  const dp = await until(async () => { const s = await d.frameEval('banks-film', FILM_STATE); return secs(s) >= 1 ? s : null; });
  const dst = dp || await d.frameEval('banks-film', FILM_STATE).catch((e) => ({ error: e.message }));
  if (policy === 'document-user-activation-required') check('from disk: the film plays, with sound', !!dp && dst.muted === false, JSON.stringify(dst));
  else check('from disk: the film plays, muted, with its sound button', !!dp && dst.muted === true && dst.soundHidden === false, JSON.stringify(dst));
  await d.key('Escape', 'Escape', 27);
  const dc = await until(async () => { const s = await d.eval(PAGE_STATE); return !s.open && s.frames === 0 ? s : null; }, 3000);
  check('from disk: Esc closes the player', !!dc && dc.frames === 0);
  check('from disk: no console errors', d.logs.length === 0, d.logs.join(' | ').slice(0, 300));
  await d.close();
} finally { await bd.close(); }

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} of ${results.length} film checks passed (autoplay policy: ${policy})`);
process.exit(failed ? 1 : 0);
