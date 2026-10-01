#!/usr/bin/env node
// Makes the poster for the film: one frame of assets/video/banks-film.html, saved as
// assets/video/banks-film-poster.webp. Run it again whenever the film file is replaced:
//
//   node assets/video/prepare.mjs            frame at second 27
//   node assets/video/prepare.mjs 12         another second
//
// Plain Node 22 or newer and a local Chrome, nothing to install. The page build (build.mjs)
// needs neither: it only copies the film and the poster made here.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.join(HERE, 'banks-film.html');
const OUT = path.join(HERE, 'banks-film-poster.webp');
const AT = Number(process.argv[2] ?? 27);      // second of the film used as the poster
const WIDTH = 960, HEIGHT = 540, QUALITY = 0.8;
const PORT = 9377;
const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!fs.existsSync(FILM)) fail(`Missing ${FILM}`);
if (!Number.isFinite(AT) || AT < 0) fail('The second must be a number, for example: node assets/video/prepare.mjs 27');
const chrome = CHROMES.find((p) => p && fs.existsSync(p));
if (!chrome) fail('No Chrome found. Install Google Chrome, or set CHROME_PATH to a Chromium-based browser.');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'film-poster-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(100); }
  }
  if (!target) fail('Chrome did not start.');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to Chrome.')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
    if (!r || r.exceptionDetails) throw new Error(`The film page raised an error: ${r ? r.exceptionDetails.text : 'no answer'}`);
    return r.result.value;
  };

  // autoplay=0 keeps the film on its first frame until it is told where to go.
  await send('Page.navigate', { url: `${pathToFileURL(FILM).href}?autoplay=0` });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) { await sleep(100); try { ready = await evaluate('window.__filmReady === true'); } catch { /* still loading */ } }
  if (!ready) fail('The film did not get ready within 15 seconds. Has its format changed?');
  const length = await evaluate('window.DURATION');
  if (AT >= length) fail(`The film is ${length} seconds long; pick a second below that.`);
  const dataUrl = await evaluate(`(async () => {
    await window.seek(${AT});
    const c = document.createElement('canvas');
    c.width = ${WIDTH}; c.height = ${HEIGHT};
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(document.querySelector('canvas'), 0, 0, ${WIDTH}, ${HEIGHT});
    return c.toDataURL('image/webp', ${QUALITY});
  })()`);
  if (!dataUrl.startsWith('data:image/webp')) fail('This Chrome cannot write WebP.');
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  fs.writeFileSync(OUT, bytes);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: second ${AT} of ${length}, ${WIDTH} by ${HEIGHT}, ${(bytes.length / 1000).toFixed(1)} KB`);
  ws.close();
} finally {
  const gone = new Promise((r) => proc.once('exit', r));
  proc.kill();
  await Promise.race([gone, sleep(3000)]);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the folder is in the temp dir anyway */ }
}
