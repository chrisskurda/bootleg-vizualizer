#!/usr/bin/env node
// Automated acceptance check for packs (SPEC §10).   node bin/check.mjs [--packs a,b] [--fps] [--audio file]
//   static   manifest valid · no forbidden APIs (random/clock/network) · no third-party fonts/images/code
//   dynamic  renders idle / audio / silence · no errors · not blank · stateless (frame A, frame B, frame A again == same)
//            every param option renders · long + empty metadata ok · loop seam continuous (idle)
//   --fps    also runs bin/measure.mjs and requires >= 55 fps (the host display's refresh may cap this)
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { analyzeCached } from './analyze.mjs';
import { analyzeStemsCached } from './stems.mjs';
import { ensureTestMusic } from './testaudio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf('--' + k); return i < 0 ? undefined : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[i + 1]); };
const all = fs.readdirSync(path.join(root, 'packs')).filter(n => fs.existsSync(path.join(root, 'packs', n, 'pack.json')));
const packs = (arg('packs') ?? all.filter(n => !n.startsWith('_')).join(',')).split(',');
const cache = path.join(root, 'cache'); fs.mkdirSync(cache, { recursive: true });

// ---- synthetic test audio (beaty track + digital silence), so the check needs no external files
const sh = (...a) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const music = arg('audio') ? path.resolve(arg('audio')) : path.join(cache, 'check_music.wav'), silence = path.join(cache, 'check_silence.wav');
if (!arg('audio')) ensureTestMusic(cache);
if (!fs.existsSync(silence)) sh('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '4', silence);
const F = analyzeCached(music, 30, cache), FS = analyzeCached(silence, 30, cache);

const KIT_PALETTES = [...fs.readFileSync(path.join(root, 'core/pack-runtime.js'), 'utf8').match(/PALETTES = \{([\s\S]*?)\};/)[1].matchAll(/(\w+):\s*\[/g)].map(m => m[1]);
// synthetic render folder with stems (tests/make-fixture.mjs) so stem-aware packs get real per-stem data
const fixtureDir = path.join(cache, 'fixture-render'); if (!fs.existsSync(path.join(fixtureDir, 'stems/kick.flac'))) spawnSync('node', [path.join(root, 'tests/make-fixture.mjs'), fixtureDir]);
const STEMS = analyzeStemsCached(fixtureDir, 30, cache);
const results = {}; const rec = (p, name, status, note = '') => ((results[p] ||= []).push({ name, status, note }));

// ---------------------------------------------------------------- static checks
const FORBIDDEN = [[/Math\.random\s*\(/, 'Math.random (use K.rng)'], [/Date\.now\s*\(|new Date\s*\(/, 'wall clock'], [/performance\.now\s*\(/, 'performance.now'],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, 'network access'], [/https?:\/\//, 'external URL'], [/@import|@font-face|new FontFace/, 'bundled/web font'],
  [/<img\b|new Image\s*\(|\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)\b/i, 'image/font asset'], [/\bimport\s*\(|<link\b/, 'dynamic import / link tag'],
  [/localStorage|sessionStorage|indexedDB/, 'persistent state']];
const SYSTEM_FONTS = /^(system-ui|ui-monospace|ui-sans-serif|ui-serif|monospace|sans-serif|serif|-apple-system|sfmono-regular|menlo|consolas|segoe ui|helvetica neue|dejavu sans mono|arial|helvetica|courier|courier new|cursive|fantasy|emoji|math|ui-rounded)$/i;
function staticChecks(id) {
  const dir = path.join(root, 'packs', id); let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch (e) { rec(id, 'manifest', 'FAIL', 'pack.json unreadable: ' + e.message); return null; }
  const bad = [];
  if (m.type !== 'native') bad.push('type must be "native"');
  m.page ||= 'index.html';
  if (!m.name) bad.push('missing name');
  for (const k of ['width', 'height', 'loopSeconds']) if (!(m[k] > 0)) bad.push(k + ' must be > 0');
  if (m.page && !fs.existsSync(path.join(dir, m.page))) bad.push('page file missing');
  const P = m.params || {};
  for (const [k, d] of Object.entries(P)) {
    if (!['number', 'color', 'select', 'bool', 'multi'].includes(d.type)) bad.push(`${k}: bad type ${d.type}`);
    if (d.type === 'multi' && !(Array.isArray(d.options) && d.options.length && Array.isArray(d.default) && d.default.every(x => d.options.includes(x)))) bad.push(`${k}: multi needs options[] and a default[] that is a subset of them`);
    if (d.default === undefined) bad.push(`${k}: no default`);
    if (d.type === 'select' && !(d.options || []).includes(d.default)) bad.push(`${k}: default not in options`);
    if (d.type === 'number' && !(d.min <= d.default && d.default <= d.max && d.step > 0)) bad.push(`${k}: default outside min/max or bad step`);
    if (d.type === 'color' && !/^#[0-9a-f]{6}$/i.test(d.default)) bad.push(`${k}: color must be #rrggbb`);
  }
  rec(id, 'manifest', bad.length ? 'FAIL' : 'PASS', bad.join('; '));
  const ownPalette = !!(P.palette && !(P.palette.options || []).every(o => KIT_PALETTES.includes(o)));  // pack defines its own themes (colors live in its palette table)
  const missing = ['palette', 'bg'].filter(k => !P[k] && !(ownPalette && k === 'bg')); rec(id, 'palette+bg params', missing.length ? 'WARN' : 'PASS', missing.length ? 'missing: ' + missing.join(', ') : '');
  if (P.scenes || P.scene || P.cycle || P.sceneBeats) { const need = ['cycle', 'sceneBeats', 'scenes'].filter(k => !P[k]); rec(id, 'multi-scene params (§2a)', need.length ? 'FAIL' : P.scenes.type !== 'multi' ? 'FAIL' : 'PASS', need.length ? 'missing: ' + need.join(', ') : P.scenes.type !== 'multi' ? '`scenes` must be a multi param (pick a subset; one = hold it)' : ''); }
  // scan every text file in the pack
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => /\.(html|js|css)$/.test(f)); let hits = [], colors = 0, palCalls = 0, fonts = new Set(), src = '', portable = new Set();
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8'); src += raw;
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // strip comments
    for (const [re, why] of FORBIDDEN) if (re.test(code)) hits.push(`${f}: ${why}`);
    colors += (code.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) || []).length; palCalls += (code.match(/\bK\.(css|pal)\s*\(|P\.palette|P\.bg\b/g) || []).length;
    for (const [re, why] of [[/shadowBlur|shadowColor|shadowOffset/, 'shadowBlur (use K.softShadow)'], [/\.filter\s*=/, 'ctx.filter'], [/getImageData|putImageData|createImageData/, 'pixel access'], [/createPattern/, 'createPattern'], [/createConicGradient/, 'conic gradient'],
      [/globalCompositeOperation\s*=\s*['"`](?!source-over|lighter)/, 'composite mode other than source-over/lighter']]) if (re.test(code)) portable.add(why);
    const famList = list => { for (const fam of list.split(',')) { const n = fam.replace(/["'`\\]/g, '').replace(/^\s*(\d+px\s+|\d{3}\s+)+/, '').trim(); if (n && !SYSTEM_FONTS.test(n) && n.length < 30 && /^[A-Za-z][A-Za-z ]*$/.test(n)) fonts.add(n); } };
    for (const g of code.matchAll(/[^\n;{}]{0,200}\b(?:sans-serif|monospace|serif)\b/g)) { // any font stack / family list ending in a generic family
      const toks = g[0].split(','), t0 = toks[0]; toks[0] = t0.slice(Math.max(t0.lastIndexOf('='), t0.lastIndexOf(':'), t0.lastIndexOf("'"), t0.lastIndexOf('"'), t0.lastIndexOf('`')) + 1); famList(toks.join(',')); }
    for (const g of code.matchAll(/\d+px\s+((?:"[^"]*"|[^'"`;}\n])+)/g)) famList(g[1]);                    // '20px "Name"' with no generic fallback
  }
  rec(id, 'no forbidden APIs / assets', hits.length ? 'FAIL' : 'PASS', [...new Set(hits)].join('; '));
  rec(id, 'system fonts only', fonts.size ? 'WARN' : 'PASS', fonts.size ? 'named fonts: ' + [...fonts].join(', ') : '');
  const heavy = !ownPalette && colors > 14 && colors > 2 * palCalls;
  rec(id, 'authored colors in code', heavy ? 'WARN' : 'PASS', ownPalette ? 'pack-defined palette table' : `${colors} literal colors vs ${palCalls} palette/param uses${heavy ? ' — prefer palette/params so themes apply' : ''}`);
  { const abs = fs.readdirSync(dir).filter(f => f.endsWith('.html')).filter(f => /(?:src|href)=["']\/(?!\/)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))); rec(id, 'relative asset paths (portable)', abs.length ? 'FAIL' : 'PASS', abs.length ? abs.join(', ') + ' — use ../../core/… not /core/… (packs must load from any host path)' : ''); }
  rec(id, 'portable canvas subset (§9)', portable.size ? 'WARN' : 'PASS', portable.size ? [...portable].join(', ') + ' — not supported by a native/headless host' : '');
  m.__usesImage = /\bK\.image\s*\(/.test(src);
  return m;
}

// ---------------------------------------------------------------- dynamic checks
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const browser = await chromium.launch({ channel: 'chrome' });
const LONG = { title: 'An Extremely Long Song Title That Keeps Going '.repeat(8), artist: 'Artist With A Very Long Name '.repeat(6), album: 'Album '.repeat(30), bpm: 133, key: 'F# minor', duration: 15,
  sections: [{ name: 'intro', start: 0, end: 4 }, { name: 'a-very-long-section-name-indeed', start: 4, end: 9 }, { name: 'hook', start: 9, end: 15 }], tracks: [{ start: 0, title: 'one', bpm: 120, key: 'Am' }] };

async function dynamic(id, m) {
  const ctx = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 1 }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', e => e.type() === 'error' && !/404/.test(e.text()) && errs.push(e.text()));
  for (const f of ['feed-offline.js', 'meta.js', 'stems.js']) await pg.addInitScript(fs.readFileSync(path.join(root, 'core', f), 'utf8'));
  await pg.goto(`http://127.0.0.1:${server.address().port}/packs/${id}/${encodeURI(m.page)}?render=1`);
  try { await pg.waitForFunction(() => document.documentElement.dataset.packReady === '1', null, { timeout: 8000 }); } catch { rec(id, 'loads', 'FAIL', 'pack never became ready: ' + (errs[0] || 'no error')); await ctx.close(); return; }
  await pg.waitForTimeout(300);
  // helpers run inside the page
  await pg.evaluate(() => {
    window.__snap = () => { const c = document.getElementById('stage'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261, s = 0, s2 = 0, n = 0, nan = 0;
      for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] + d[i + 1] * 3 + d[i + 2] * 7; h = Math.imul(h ^ v, 16777619); s += v; s2 += v * v; n++; }
      const mean = s / n; return { hash: h >>> 0, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) }; };
    window.__drawIdle = (t, P) => { window.__PARAMS = P || {}; window.__AUDIO = null; window.__seek(t); return window.__snap(); };
    window.__drawAudio = (t, P) => { window.__PARAMS = P || {}; window.__setFrame(Math.round(t * 30)); window.__seek(t); return window.__snap(); };
  });
  const loop = m.loopSeconds, ok = (cond, note) => ({ pass: !!cond, note });
  const idle = t => pg.evaluate(([t]) => window.__drawIdle(t), [t]), aud = t => pg.evaluate(([t]) => window.__drawAudio(t), [t]);
  const sec = async fn => { const e0 = errs.length; let r; try { r = await fn(); } catch (e) { errs.push(String(e.message).split('\n')[0]); } return { r, err: errs.slice(e0) }; };

  // idle
  let r = await sec(async () => { const a = []; for (const t of [loop * 0.0571, loop * 0.4137, loop * 0.7724]) a.push(await idle(t)); /* off the round numbers where scene cuts/wipes happen */ return a; });
  rec(id, 'renders idle (no audio)', r.err.length ? 'FAIL' : r.r.every(s => s.std > 2) ? 'PASS' : 'WARN', r.err[0] || (r.r.every(s => s.std > 2) ? '' : 'frame looks blank/flat'));
  // audio
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, { title: 'Test Song', artist: 'Tester', bpm: 120, key: 'Am', duration: 12, sections: [{ name: 'intro', start: 0, end: 4 }, { name: 'verse', start: 4, end: 8 }, { name: 'hook', start: 8, end: 12 }] }]);
  r = await sec(async () => { const a = []; for (const t of [1, 3, 5, 7, 9, 11]) a.push(await aud(t)); return a; });
  rec(id, 'renders with audio', r.err.length ? 'FAIL' : r.r.every(s => s.std > 2) ? 'PASS' : 'WARN', r.err[0] || (r.r.every(s => s.std > 2) ? '' : 'blank frame(s)'));
  // with real per-stem data (A.stems filled, clip labels, mute/solo-able): packs must keep working, stem-aware or not
  r = await sec(async () => { await pg.evaluate(([F, M, S]) => window.__loadFeatures(F, M, S), [F, { title: 'Stem Test', bpm: 120, duration: 12 }, STEMS]); const a = []; for (const t of [1, 4, 7, 10]) a.push(await aud(t)); return a; });
  rec(id, 'renders with stems (A.stems present)', r.err.length ? 'FAIL' : r.r.every(s => s.std > 2) ? 'PASS' : 'WARN', r.err[0] || (r.r.every(s => s.std > 2) ? '' : 'blank frame(s)'));
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, { title: 'Test Song', artist: 'Tester', bpm: 120, key: 'Am', duration: 12, sections: [{ name: 'intro', start: 0, end: 4 }, { name: 'verse', start: 4, end: 8 }, { name: 'hook', start: 8, end: 12 }] }]);
  // stateless: A, B, A again
  r = await sec(async () => ({ a1: await aud(2.0), b: await aud(6.5), c: await idle(33), a2: await aud(2.0), i1: await idle(4.2), i2: (await idle(9.1), await idle(4.2)) }));
  rec(id, 'stateless (A,B,A same)', r.err.length ? 'FAIL' : (r.r.a1.hash === r.r.a2.hash && r.r.i1.hash === r.r.i2.hash) ? 'PASS' : 'FAIL', r.err[0] || ((r.r.a1.hash === r.r.a2.hash && r.r.i1.hash === r.r.i2.hash) ? '' : 'a frame depends on earlier frames (hidden state / randomness / clock)'));
  // silence + long/empty metadata
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [FS, {}]);
  r = await sec(async () => { for (const t of [0.2, 1.5, 3]) await aud(t); });
  rec(id, 'silence (A.live, zeros)', r.err.length ? 'FAIL' : 'PASS', r.err[0] || '');
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, LONG]);
  r = await sec(async () => { for (const t of [1, 6, 10]) await aud(t); });
  rec(id, 'long metadata', r.err.length ? 'FAIL' : 'PASS', r.err[0] || '');
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, undefined]);
  r = await sec(async () => { for (const t of [1, 6]) await aud(t); });
  rec(id, 'empty metadata', r.err.length ? 'FAIL' : 'PASS', r.err[0] || '');
  // every param option
  await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, LONG]); const bad = [];
  for (const [k, d] of Object.entries(m.params || {})) {
    const vals = d.type === 'select' ? d.options : d.type === 'multi' ? [...d.options.map(o => [o]), d.options.slice(0, 2), [], d.options] : d.type === 'bool' ? [true, false] : d.type === 'number' ? [d.min, d.max] : ['#000000', '#ffffff'];   // multi: each option alone, a pair, none, all
    for (const v of vals) { let s; try { s = await pg.evaluate(([t, P]) => window.__drawAudio(t, P), [5, { [k]: v }]); } catch (e) { bad.push(`${k}=${v}: ${String(e.message).split('\n')[0]}`); continue; } if (!(s.std >= 0)) bad.push(`${k}=${v}: NaN output`); }
  }
  rec(id, 'all param options render', bad.length ? 'FAIL' : 'PASS', bad.slice(0, 3).join('; '));
  // look/FX passes (roto + glitch + curved CRT) run on top of every pack: must not error, and must really change the picture
  r = await sec(async () => { await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, LONG]);
    const shot = () => pg.evaluate(() => { const f = document.getElementById('fxstage'); if (!f || f.style.display === 'none') return null; const g = document.createElement('canvas'); g.width = 64; g.height = 36; const x = g.getContext('2d'); x.drawImage(f, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; });
    await pg.evaluate(() => { window.__FX = null; }); await aud(5);
    await pg.evaluate(() => { window.__FX = { roto: 1, glitch: 1, screen: 3 }; }); await aud(5); const a = await shot(); await aud(6.3); const b = await shot();
    await pg.evaluate(() => { window.__FX = null; }); await aud(5); return { a, b }; });
  rec(id, 'renders under FX (roto+glitch+CRT)', r.err.length ? 'FAIL' : (r.r && r.r.a != null) ? 'PASS' : 'WARN', r.err[0] || ((r.r && r.r.a != null) ? '' : 'FX stage never appeared (WebGL2 unavailable?)'));
  if (m.__usesImage) { // pack uses K.image(): draw with a supplied image, then without
    await pg.evaluate(([F, M]) => window.__loadFeatures(F, M), [F, LONG]);
    r = await sec(async () => { await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 800, 500); g.fillStyle = '#39f'; g.fillRect(100, 100, 300, 200); window.__IMAGE_URL = c.toDataURL('image/png'); return window.__whenImage(); }); for (const t of [1, 6]) await aud(t); await pg.evaluate(() => { delete window.__IMAGE_URL; }); });
    rec(id, 'renders with user image (K.image)', r.err.length ? 'FAIL' : 'PASS', r.err[0] || '');
  }
  // loop seam (idle): frames just before the loop end vs start should differ about as much as any two neighbours
  r = await sec(async () => { const grab = async t => pg.evaluate(([t]) => { window.__AUDIO = null; window.__PARAMS = {}; window.__seek(t); const c = document.getElementById('stage'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height, {}).data.filter((_, i) => i % 4 === 1 && (i >> 2) % 29 === 0)); }, [t]);
    const dt = 1 / 30, dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    const seam = dist(await grab(loop - dt), await grab(0)), base = []; for (const t of [loop * 0.17, loop * 0.41, loop * 0.63, loop * 0.86]) base.push(dist(await grab(t), await grab(t + dt)));
    return { seam, base: Math.max(...base) }; });
  const seamOK = r.r && r.r.seam <= Math.max(3 * r.r.base, 4);
  rec(id, 'loop seam continuous (idle)', r.err.length ? 'FAIL' : seamOK ? 'PASS' : 'WARN', r.err[0] || (seamOK ? '' : `seam jump ${r.r.seam.toFixed(1)} vs typical ${r.r.base.toFixed(1)} — motion isn't periodic over loopSeconds. See SPEC §4a: drive loop motion from T with K.phase / K.drift / K.tri / K.progress (never A.t), wrap travel = whole laps of the wrap span`));
  await ctx.close();
}

for (const id of packs) { const m = staticChecks(id); if (m) await dynamic(id, m); }
await browser.close(); server.close();

// ---------------------------------------------------------------- fps (optional)
if (arg('fps')) {
  const r = spawnSync('node', [path.join(root, 'bin/measure.mjs'), '--packs', packs.join(','), '--secs', '4', '--audio', music], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const seen = new Set();
  for (const line of (r.stdout || '').split('\n')) { const g = /^(\S+)\s+\d+x\d+\s+host ([\d.]+) fps\s+pack-frame rAF ([\d.]+) fps/.exec(line); if (g) { const f = +g[3]; seen.add(g[1]); rec(g[1], 'live fps', f >= 55 ? 'PASS' : f >= 30 ? 'WARN' : 'FAIL', `${f.toFixed(0)} fps`); } }
  for (const id of packs) if (!seen.has(id)) rec(id, 'live fps', 'FAIL', `not measured (measure.mjs exit ${r.status}${r.error ? ', ' + r.error.message : ''}${(r.stderr || '').trim() ? ': ' + ((r.stderr.split('\n').find(l => /Error|error:/.test(l) && !/404/.test(l))) || r.stderr.trim().split('\n').slice(-2).join(' | ')).trim().slice(0, 200) : ''})`);
}

// ---------------------------------------------------------------- report
const ICON = { PASS: '✓', WARN: '!', FAIL: '✗' }; let fails = 0, warns = 0;
for (const id of packs) {
  const rs = results[id] || [], f = rs.filter(x => x.status === 'FAIL').length, w = rs.filter(x => x.status === 'WARN').length; fails += f; warns += w;
  console.log(`\n${f ? '✗' : w ? '!' : '✓'} ${id}  (${rs.filter(x => x.status === 'PASS').length}/${rs.length} pass${w ? `, ${w} warn` : ''}${f ? `, ${f} FAIL` : ''})`);
  for (const x of rs) if (x.status !== 'PASS') console.log(`    ${ICON[x.status]} ${x.name}${x.note ? ' — ' + x.note : ''}`);
}
console.log(`\n${packs.length} packs: ${fails ? fails + ' failing checks' : 'no failures'}, ${warns} warnings`);
process.exit(fails ? 1 : 0);
