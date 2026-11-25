// Per-stem analysis for a MusicGen-style render folder:  <dir>/stems/<name>.flac|wav  (+ manifest.json, clips.json)
// -> per stem: level, onset pulse, 16-band spectrum (shared scale across stems, so a quiet hat stem stays quieter than the kick),
//    its role, its mix gain, and a timeline of the loops/hits placed on it (text: what sample is playing when).
//   node bin/stems.mjs <render-dir> [out.json] [--fps 30]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { makeFFT } from './analyze.mjs';
await import('../core/stems.js');                  // classic script: publishes globalThis.VisStems (the role table lives there, shared with browsers)
export const roleOf = name => globalThis.VisStems.roleOf(name);

const SR = 44100, N = 2048, NB = 16;
// stem name -> role vocabulary (SPEC §2c). Unknown names are 'other'.
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const cleanName = f => String(f || '').split('/').pop().replace(/\.(wav|flac|mp3|aif+|ogg|caf)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(r.stderr.toString()); return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
}
const pct = (a, p) => { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const b64 = u8 => Buffer.from(u8).toString('base64');

export function analyzeStems(dir, fps = 30) {
  const sd = path.join(dir, 'stems'); if (!fs.existsSync(sd)) return null;
  const files = fs.readdirSync(sd).filter(f => /\.(flac|wav)$/i.test(f)).sort(); if (!files.length) return null;
  const man = readJson(path.join(dir, 'manifest.json')) || {}, clipsDoc = readJson(path.join(dir, 'clips.json')) || {}, bpm = man.bpm || clipsDoc.bpm || 120, barS = 4 * 60 / bpm;
  const fft = makeFFT(N), win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const edges = Array.from({ length: NB + 1 }, (_, i) => 35 * Math.pow(16000 / 35, i / NB));
  const re = new Float64Array(N), im = new Float64Array(N);
  const raw = files.map(f => {
    const x = pcm(path.join(sd, f)), frames = Math.floor(x.length / SR * fps), db = new Float32Array(frames), sp = new Float32Array(frames * NB);
    for (let k = 0; k < frames; k++) {
      const c = Math.floor((k + 0.5) / fps * SR) - N / 2; let e = 0;
      for (let i = 0; i < N; i++) { const v = (x[c + i] || 0) * win[i]; re[i] = v; im[i] = 0; e += v * v; }
      db[k] = 10 * Math.log10(e / N + 1e-12); fft(re, im);
      for (let b = 0; b < NB; b++) { const lo = Math.max(1, Math.round(edges[b] * N / SR)), hi = Math.max(lo + 1, Math.round(edges[b + 1] * N / SR)); let s = 0; for (let q = lo; q < hi; q++) s += re[q] ** 2 + im[q] ** 2; sp[k * NB + b] = Math.log1p(Math.sqrt(s / (hi - lo)) * 20); }
    }
    return { name: f.replace(/\.[^.]+$/, ''), db, sp, frames };
  });
  const frames = Math.max(...raw.map(r => r.frames));
  // shared scales across all stems
  const dbHi = Math.max(...raw.map(r => pct(r.db, 0.99))), dbLo = dbHi - 48, allSp = raw.flatMap(r => Array.from(r.sp)), spLo = pct(allSp, 0.25), spHi = pct(allSp, 0.995);
  // timeline of what is playing on each stem (text): loops are placed in bars, hits in seconds
  const byStem = {}; for (const c of clipsDoc.clips || []) {
    const start = c.kind === 'hit' ? c.start_s : c.start_bar * barS, end = c.kind === 'hit' ? c.start_s + (c.length_s || 0.5) : (c.start_bar + c.bars) * barS;
    (byStem[c.stem] ||= []).push({ start: +start.toFixed(3), end: +end.toFixed(3), kind: c.kind, label: cleanName(c.file), kit: c.kit ?? null, file: c.file ?? null });
  }
  const stems = raw.map(r => {
    const level = new Uint8Array(frames), beat = new Uint8Array(frames), spec = new Uint8Array(frames * NB), st = new Float32Array(NB);
    let lv = 0, bt = 0, last = -9; const diffs = []; for (let k = 1; k < r.frames; k++) diffs.push(Math.max(0, r.db[k] - r.db[k - 1]));
    const th = Math.max(3, 0.35 * pct(diffs, 0.995));   // relative to this stem's strongest onsets (a percentile of ALL diffs would cap dense patterns at that fraction of frames)
    for (let k = 0; k < frames; k++) {
      const d = k < r.frames ? r.db[k] : -120, nrm = Math.min(1, Math.max(0, (d - dbLo) / (dbHi - dbLo)));
      lv += (nrm - lv) * (nrm > lv ? 0.6 : 0.15); level[k] = Math.round(lv * 255);
      const flux = k > 0 && k < r.frames ? r.db[k] - r.db[k - 1] : 0; if (flux >= th && k - last >= 3 && nrm > 0.2) { bt = 1; last = k; } else bt *= 0.82; beat[k] = Math.round(bt * 255);
      for (let b = 0; b < NB; b++) { const v = k < r.frames ? Math.min(1, Math.max(0, (r.sp[k * NB + b] - spLo) / (spHi - spLo))) : 0; st[b] += (v - st[b]) * (v > st[b] ? 0.7 : 0.22); spec[k * NB + b] = Math.round(st[b] * 255); }
    }
    return { name: r.name, role: roleOf(r.name), gainDb: man.stems_gain_db?.[r.name] ?? 0, level: b64(level), beat: b64(beat), spec: b64(spec), clips: (byStem[r.name] || []).sort((a, b) => a.start - b.start) };
  });
  return { v: 1, fps, frames, nb: NB, bpm, duration: man.seconds || frames / fps, stems };
}
export function analyzeStemsCached(dir, fps, cacheDir) {
  const sd = path.join(dir, 'stems'); if (!fs.existsSync(sd)) return null;
  const sig = fs.readdirSync(sd).sort().map(f => { const st = fs.statSync(path.join(sd, f)); return `${f}:${st.size}:${st.mtimeMs}`; }).join('|') + '|' + [fs.existsSync(path.join(dir, 'clips.json')) ? fs.statSync(path.join(dir, 'clips.json')).mtimeMs : 0, fs.existsSync(path.join(dir, 'manifest.json')) ? fs.statSync(path.join(dir, 'manifest.json')).mtimeMs : 0].join(',');
  const f = path.join(cacheDir, 'stems-' + crypto.createHash('md5').update(`s1|${path.resolve(dir)}|${fps}|${sig}`).digest('hex') + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = analyzeStems(dir, fps); if (out) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out)); } return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, outp] = process.argv.slice(2).filter(a => !a.startsWith('--')), fi = process.argv.indexOf('--fps'), o = analyzeStems(path.resolve(dir), fi > 0 ? +process.argv[fi + 1] : 30);
  if (!o) { console.error('no stems/ folder with .flac/.wav files in', dir); process.exit(1); }
  if (outp) fs.writeFileSync(outp, JSON.stringify(o)); console.log(`${o.stems.length} stems, ${o.frames} frames: ${o.stems.map(s => `${s.name}(${s.role},${s.clips.length} clips)`).join(' ')}`);
}
