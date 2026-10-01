// A small Chrome DevTools Protocol driver for the checks. Node 22 or newer (built-in WebSocket), no dependencies.
// Set CHROME_PATH to use another Chromium-based browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port = 9333, extra = []) {
  if (!CHROME) throw new Error('No Chrome found. Install Google Chrome, or set CHROME_PATH.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', ...(extra.includes('--strict-files') ? [] : ['--allow-file-access-from-files']), ...extra.filter((f) => f !== '--strict-files'), 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  async function newPage() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    const logs = [];
    const waiters = [];
    const contexts = new Map();   // execution context id -> { frameId, isDefault }
    const requests = [];
    listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      const p = msg.params || {};
      if (msg.method === 'Runtime.executionContextCreated') contexts.set(p.context.id, { frameId: p.context.auxData && p.context.auxData.frameId, isDefault: p.context.auxData && p.context.auxData.isDefault });
      if (msg.method === 'Runtime.executionContextDestroyed') contexts.delete(p.executionContextId);
      if (msg.method === 'Runtime.executionContextsCleared') contexts.clear();
      if (msg.method === 'Network.requestWillBeSent') requests.push(p.request.url);
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type)) logs.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (msg.method === 'Runtime.exceptionThrown') logs.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`);
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) logs.push(`log.${p.entry.level}: ${p.entry.text} ${p.entry.url || ''}`);
      for (const w of waiters.slice()) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(p); }
    });
    const once = (method, timeout = 30000) => new Promise((resolve, reject) => {
      const w = { method, resolve }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i > -1) { waiters.splice(i, 1); reject(new Error(`timeout waiting for ${method}`)); } }, timeout);
    });
    await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable'); await S('Network.enable'); await S('DOM.enable'); await S('CSS.enable');
    const page = {
      S, logs, requests,
      // Evaluate inside the first child frame whose URL contains the given text.
      async frameEval(urlPart, expr) {
        const tree = (await S('Page.getFrameTree')).frameTree;
        const walk = (n, out = []) => { out.push(n.frame); (n.childFrames || []).forEach((c) => walk(c, out)); return out; };
        const fr = walk(tree).find((f) => f.id !== tree.frame.id && f.url.includes(urlPart));
        if (!fr) throw new Error(`no frame with ${urlPart}`);
        const ctx = [...contexts.entries()].find(([, c]) => c.frameId === fr.id && c.isDefault);
        if (!ctx) throw new Error(`no context for frame ${fr.url.slice(0, 80)}`);
        const r = await S('Runtime.evaluate', { expression: expr, contextId: ctx[0], awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`frame eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      },
      async init(source) { await S('Page.addScriptToEvaluateOnNewDocument', { source }); },
      // A real click at the centre of the element (counts as a user gesture).
      async click(selector, modifiers = 0) {
        const r = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
        if (!r) throw new Error(`nothing to click: ${selector}`);
        await page.clickAt(r.x, r.y, modifiers);
      },
      async clickAt(x, y, modifiers = 0) {
        await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
        await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, modifiers });
        await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, modifiers });
      },
      async goto(url, { settle = 600 } = {}) {
        const loaded = once('Page.loadEventFired');
        await S('Page.navigate', { url });
        await loaded;
        await page.eval('document.fonts.ready.then(() => 1)');
        await sleep(settle);
      },
      async eval(expr) {
        const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr.slice(0, 200)}`);
        return r.result.value;
      },
      async viewport(width, height, mobile = false) {
        await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      },
      async shot(file, full = true) {
        if (!full) { const r = await S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return; }
        const vp = await page.eval('({ w: innerWidth, h: innerHeight })');
        const h = await page.eval('document.documentElement.scrollHeight');
        await S('Emulation.setDeviceMetricsOverride', { width: vp.w, height: h, deviceScaleFactor: 1, mobile: vp.w < 700 });
        await sleep(400);
        const r = await S('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        await S('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.w < 700 ? 2 : 1, mobile: vp.w < 700 });
      },
      async key(key, code, keyCode, modifiers = 0) {
        // No nativeVirtualKeyCode: on a Mac the Windows codes mean other keys (27 is Minus), and Chrome then repeats that key.
        await S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
        if (key === 'Enter' || key === ' ') await S('Input.dispatchKeyEvent', { type: 'char', text: key === 'Enter' ? '\r' : ' ', modifiers });
        await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
      },
      async close() { await send('Target.closeTarget', { targetId }); },
    };
    return page;
  }
  return { send, newPage, async close() { try { await send('Browser.close'); } catch {} const gone = new Promise((r) => proc.once('exit', r)); proc.kill(); await Promise.race([gone, sleep(3000)]); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}
export { sleep };
