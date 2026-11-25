#!/usr/bin/env node
// Live performance probe: opens each pack in a (headed) Chrome window playing a track, reports fps.
//   node bin/measure.mjs [--audio path/to/track] [--packs a,b] [--size 1920x1080] [--secs 8]
import { chromium } from 'playwright-core'; import { ensureTestMusic } from './testaudio.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), a = Object.fromEntries(argv.flatMap((v, i) => v.startsWith('--') ? [[v.slice(2), argv[i + 1]]] : []));
const audio = path.resolve(a.audio ?? ensureTestMusic(path.join(root, 'cache')));
const [W, H] = (a.size ?? '1920x1080').split('x').map(Number), secs = +(a.secs ?? 8), port = 8790 + Math.floor(Math.random() * 100);
const srv = spawn('node', [path.join(root, 'bin/server.mjs'), '--port', String(port), '--media', path.dirname(audio)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const packs = (a.packs ?? fs.readdirSync(path.join(root, 'packs')).filter(n => fs.existsSync(path.join(root, 'packs', n, 'pack.json'))).join(',')).split(',');
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H + 100}`] });
for (const id of packs) {
  const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  p.on('console', m => m.type() === 'error' && console.log('  page:', m.text())); p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.goto(`http://127.0.0.1:${port}/core/live.html?pack=${id}&ui=0${a.look ? '&look=' + encodeURIComponent(a.look) : ''}&audio=${encodeURIComponent('/media/0/' + path.basename(audio))}`);
  await p.waitForTimeout(4000);
  const s = [], fr = p.frames().find(f => f !== p.mainFrame());
  const inner = async () => fr.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); })(); }));
  const innerFps = await inner();
  for (let i = 0; i < secs; i++) { await p.waitForTimeout(1000); s.push(await p.evaluate(() => ({ fps: __vizStats.fps, worst: __vizStats.worst, bass: __vizStats.A.bass, mid: __vizStats.A.mid }))); }
  const avg = k => s.reduce((x, y) => x + y[k], 0) / s.length;
  console.log(`${id.padEnd(16)} ${W}x${H}  host ${avg('fps').toFixed(1)} fps  pack-frame rAF ${innerFps.toFixed(1)} fps  worst-frame ${Math.max(...s.map(x => x.worst)).toFixed(0)} ms  audio levels bass ${avg('bass').toFixed(2)} mid ${avg('mid').toFixed(2)}`);
  await p.context().close();
}
await b.close(); srv.kill();
