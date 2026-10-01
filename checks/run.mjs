#!/usr/bin/env node
// Runs every check against dist/. Build first, then:
//
//   node build.mjs && node checks/run.mjs
//
// Needs Node 22 or newer and a local Chrome. It serves dist/ on two local ports (with and without
// gzip), opens the page in headless Chrome, and prints one PASS or FAIL line per check.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');
const GZIP = 8791, PLAIN = 8792;
if (!fs.existsSync(path.join(DIST, 'banks.html'))) {
  console.error('dist/banks.html is missing. Run: node build.mjs');
  process.exit(1);
}
const servers = [await serve(DIST, GZIP), await serve(DIST, PLAIN, { gzip: false })];
const run = (file, args = []) => new Promise((resolve) => {
  console.log(`\n== ${file} ${args.slice(2).join(' ')}`.trimEnd());
  spawn(process.execPath, [path.join(HERE, file), ...args], { stdio: 'inherit' }).once('exit', (code) => resolve(code === 0));
});
const fileUrl = pathToFileURL(path.join(DIST, 'banks.html')).href;
const results = [];
results.push(['copy', await run('copy.mjs')]);
results.push(['page', await run('page.mjs', [`http://127.0.0.1:${GZIP}/banks/`, fileUrl, `http://127.0.0.1:${PLAIN}/banks.html`])]);
if (fs.existsSync(path.join(DIST, 'banks-film.html'))) {
  results.push(['film', await run('film.mjs', [`http://127.0.0.1:${GZIP}`, fileUrl])]);
  results.push(['film, sound refused', await run('film.mjs', [`http://127.0.0.1:${GZIP}`, fileUrl, 'user-gesture-required'])]);
} else {
  console.log('\nfilm checks skipped: dist/ has no film (flags.videoReady is off)');
}
for (const s of servers) s.close();
console.log(`\n${results.map(([name, ok]) => `${ok ? 'ok  ' : 'FAIL'}  ${name}`).join('\n')}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
