#!/usr/bin/env node
// Stills of packs, driven by a synthetic (deterministic-ish) audio signal — no audio file needed.
//   node bin/screenshots.mjs [--packs a,b,c | all] [--out docs/screenshots] [--size 1280x720] [--sheet sheet.png] [--wait 2600] [--image cover.jpg]
// --image: art for cover-art packs (served as the user image, so K.coverArt / K.image see it)
// With --sheet, also writes a numbered contact sheet (needs ImageMagick) so you can pick which packs to feature.
import { chromium } from 'playwright-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', 'docs/screenshots')), [W, H] = arg('size', '1280x720').split('x').map(Number), wait = +arg('wait', 2600), sheet = arg('sheet', ''), image = arg('image', '') && path.resolve(arg('image'));
const all = fs.readdirSync(path.join(root, 'packs')).filter(n => !n.startsWith('_') && fs.existsSync(path.join(root, 'packs', n, 'pack.json'))), want = arg('packs', 'all') === 'all' ? all : arg('packs').split(',');
fs.mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { if (image && q.url === '/__image') { r.writeHead(200, { 'content-type': MIME[path.extname(image).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(image).pipe(r); } const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); const port = srv.address().port;

// A synthetic track: 118 bpm, kick on the beat, a bass line, moving mid formants, bright hats on the off-beat.
const synth = () => {
  const N = 64, clamp = v => Math.max(0, Math.min(1, v)), BPM = 118, SPB = 60 / BPM;
  const env = t => { const ph = (t % SPB) / SPB; return Math.exp(-ph * 5.5); };
  const spec = t => { const e = env(t), off = Math.exp(-(((t + SPB / 2) % SPB) / SPB) * 7), s = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = i / N, low = Math.exp(-i / 9) * (0.55 + 0.45 * e), mid = Math.exp(-(((i - (22 + 8 * Math.sin(t * 0.6))) / 7) ** 2)) * (0.5 + 0.2 * Math.sin(t * 1.7 + i)), hi = Math.exp(-(((i - 52) / 9) ** 2)) * (0.15 + 0.55 * off) * (0.7 + 0.3 * Math.sin(t * 9 + i * 2.1)); s[i] = clamp(low * 0.95 + mid * 0.6 + hi + 0.03 * Math.sin(t * 3 + i * 0.7) + 0.02); } return s; };
  const wave = t => { const w = new Float32Array(128), e = env(t); for (let i = 0; i < 128; i++) { const p = t * 55 + i / 128 * 6.28 * 2; w[i] = 0.5 * Math.sin(p) * (0.4 + e * 0.6) + 0.22 * Math.sin(p * 3.01 + t) + 0.1 * Math.sin(p * 7.3); } return w; };
  window.__synth = true; window.__PARAMS = {}; window.__META = { title: 'Night Garden', artist: 'Static Orchard', album: 'Slow Currents', bpm: BPM, key: 'Am', duration: 214, sections: [] };
  const t0 = performance.now(); (function tick() {
    const t = 12 + (performance.now() - t0) / 1000, s = spec(t), e = env(t), bass = clamp(s.slice(0, 8).reduce((a, b) => a + b, 0) / 8 * 1.15), mid = clamp(s.slice(10, 34).reduce((a, b) => a + b, 0) / 24 * 1.5), high = clamp(s.slice(44).reduce((a, b) => a + b, 0) / 20 * 2);
    window.__AUDIO = { live: true, t, duration: 214, spectrum: s, wave: wave(t), bass, mid, high, beat: e > 0.85 ? 1 : e * 0.6, level: (bass + mid + high) / 3, past: sec => spec(t - sec), meta: window.__META, section: { name: 'chorus', index: 1, progress: 0.4 }, text: 'Night Garden — Static Orchard' };
    requestAnimationFrame(tick); })();
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage(), shots = [];
await page.addInitScript(synth); if (image) await page.addInitScript(() => { window.__IMAGE_URL = '/__image'; });
for (const id of want) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'packs', id, 'pack.json'), 'utf8')); await page.goto(`http://127.0.0.1:${port}/packs/${id}/${m.page || 'index.html'}`); await page.waitForTimeout(wait);
  const f = path.join(out, id + '.png'); await page.screenshot({ path: f }); shots.push(f); console.log('shot', id);
}
await browser.close(); srv.close();
// the sheet is row-major in the order printed above (no labels, so no font is needed)
if (sheet) { const args = [...shots, '-tile', '7x', '-geometry', '280x158+3+3', '-background', '#111', path.resolve(sheet)]; console.log(spawnSync('montage', args).status === 0 ? 'sheet ' + sheet : 'montage failed (is ImageMagick installed?)'); }
