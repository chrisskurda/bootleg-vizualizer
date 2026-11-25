#!/usr/bin/env node
// node bin/server.mjs [--port 8080] [--media /path/to/music]   (repeat --media for several dirs)
import http from 'node:http'; import os from 'node:os'; import { execFile } from 'node:child_process'; import { analyzeStemsCached } from './stems.mjs'; import { readMeta } from './meta.mjs'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = k => args.flatMap((v, i) => v === '--' + k ? [args[i + 1]] : []);
const port = +(opt('port')[0] ?? 8080), media = opt('media').map(p => path.resolve(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
const AUDIO = /\.(mp3|wav|flac|m4a|ogg)$/i;
function send(res, file, req) {
  const st = fs.statSync(file), type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) { const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 }); fs.createReadStream(file, { start: s, end: e }).pipe(res); }
  else { res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res); }
}
function walk(dir, depth, out) { if (depth < 0 || out.length > 5000) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, depth - 1, out); else if (AUDIO.test(e.name)) out.push(p); } }
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (p === '/api/packs') { const d = path.join(root, 'packs'), list = fs.readdirSync(d).filter(n => fs.existsSync(path.join(d, n, 'pack.json')))
    .map(n => ((m => ({ id: n, ...m, page: m.page || 'index.html' }))(JSON.parse(fs.readFileSync(path.join(d, n, 'pack.json'), 'utf8'))))); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(list)); }
  if (p === '/api/media') { const out = []; media.forEach((m, i) => { const l = []; walk(m, 2, l); l.forEach(f => out.push({ name: path.relative(m, f), url: `/media/${i}/${path.relative(m, f).split(path.sep).map(encodeURIComponent).join('/')}` })); });
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out)); }
  if (p === '/api/stems') { // per-stem analysis of the stems/ folder next to a media file (cached; first call can take a while)
    const done = j => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const mu = /^\/media\/(\d+)\/(.*)$/.exec(decodeURIComponent(u.searchParams.get('url') || '')); const f = mu && media[+mu[1]] ? path.join(media[+mu[1]], mu[2]) : null;
    if (!f || !f.startsWith(media[+mu[1]]) || !fs.existsSync(path.join(path.dirname(f), 'stems'))) return done({});
    const cache = path.join(root, 'cache'), dir = path.dirname(f);
    execFile(process.execPath, ['--input-type=module', '-e', `import('${new URL('./stems.mjs', import.meta.url).href}').then(m => m.analyzeStemsCached(${JSON.stringify(dir)}, 30, ${JSON.stringify(cache)}))`], { maxBuffer: 1 << 26, timeout: 600000 }, err => { try { done(err ? {} : analyzeStemsCached(dir, 30, cache) || {}); } catch { done({}); } }); return; }
  if (p === '/api/meta') { // GET ?url=/media/0/...  or  POST (raw audio bytes, ?name=song.flac) from the file picker
    const done = j => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method === 'POST') { const name = path.basename(u.searchParams.get('name') || 'upload.audio'), tmp = path.join(os.tmpdir(), 'viz-' + Date.now() + '-' + name), ws = fs.createWriteStream(tmp); let n = 0;
      req.on('data', c => { n += c.length; if (n > 500 << 20) req.destroy(); }); req.pipe(ws);
      ws.on('finish', () => { try { const m = readMeta(tmp); if (m.title === path.basename(tmp, path.extname(tmp))) m.title = path.basename(name, path.extname(name)); done(m); } catch { done({}); } fs.rm(tmp, () => {}); }); return; }
    const mu = /^\/media\/(\d+)\/(.*)$/.exec(decodeURIComponent(u.searchParams.get('url') || '')); let f = mu && media[+mu[1]] ? path.join(media[+mu[1]], mu[2]) : null;
    if (!f || !f.startsWith(media[+mu[1]]) || !fs.existsSync(f)) return done({}); try { return done(readMeta(f)); } catch { return done({}); } }
  let file = null; const mm = /^\/media\/(\d+)\/(.*)$/.exec(p);
  if (mm && media[+mm[1]]) { file = path.join(media[+mm[1]], mm[2]); if (!file.startsWith(media[+mm[1]])) file = null; }
  else { file = path.join(root, p === '/' ? 'core/live.html' : p); if (!file.startsWith(root)) file = null; }
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  send(res, file, req);
}).listen(port, '127.0.0.1', () => console.log(`visualizer: http://localhost:${port}/core/live.html   media dirs: ${media.join(', ') || '(none; use --media DIR)'}`));
