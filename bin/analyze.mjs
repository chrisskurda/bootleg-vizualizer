// Offline audio -> per-frame features {bass,mid,high,beat} (0..1). Importable + CLI.
// CLI: node bin/analyze.mjs song.flac features.json [--fps 30]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SR = 44100, N = 2048, NS = 4096, NB = 64, NW = 128; // N: band/beat FFT, NS: spectrum FFT (finer low end)
export function makeFFT(N) {
  const cosT = new Float32Array(N / 2), sinT = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); }
  return (re, im) => {
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) { const step = N / len;
      for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
        const wr = cosT[k * step], wi = -sinT[k * step], a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  };
}
export function analyze(file, fps = 30) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(r.stderr.toString());
  const pcm = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
  const frames = Math.floor(pcm.length / SR * fps);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const fft = makeFFT(N);
  // ---- spectrum (64 log bands 35Hz..16kHz) + waveform (128 samples) per frame
  const FS = makeFFT(NS), winS = Float32Array.from({ length: NS }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NS));
  const edges = Array.from({ length: NB + 1 }, (_, i) => 35 * Math.pow(16000 / 35, i / NB));
  const rawS = new Float32Array(frames * NB), wave = new Float32Array(frames * NW);
  { const sre = new Float64Array(NS), sim = new Float64Array(NS), pw = new Float64Array(NS / 2);
    for (let f = 0; f < frames; f++) {
      const c = Math.floor((f + 0.5) / fps * SR) - NS / 2;
      for (let i = 0; i < NS; i++) { sre[i] = (pcm[c + i] || 0) * winS[i]; sim[i] = 0; }
      FS(sre, sim); for (let b = 0; b < NS / 2; b++) pw[b] = sre[b] ** 2 + sim[b] ** 2;
      for (let i = 0; i < NB; i++) {
        const lo = edges[i] * NS / SR, hi = edges[i + 1] * NS / SR; let e;
        if (hi - lo < 1) { const m = (lo + hi) / 2, b0 = Math.floor(m), fr = m - b0; e = pw[b0] * (1 - fr) + pw[b0 + 1] * fr; }
        else { let sum = 0, n = 0; for (let b = Math.ceil(lo); b <= Math.floor(hi); b++) { sum += pw[b]; n++; } e = n ? sum / n : pw[Math.round(lo)]; }
        rawS[f * NB + i] = Math.log1p(Math.sqrt(e) * 20);
      }
      for (let j = 0; j < NW; j++) { let m = 0; for (let k = 0; k < 8; k++) m += pcm[Math.floor((f + 0.5) / fps * SR) - 512 + j * 8 + k] || 0; wave[f * NW + j] = m / 8; }
    } }
  const bin = hz => Math.round(hz * N / SR);
  const bands = { bass: [bin(30), bin(150)], mid: [bin(150), bin(2000)], high: [bin(2000), bin(12000)] };
  const raw = { bass: [], mid: [], high: [] }, flux = [];
  let prev = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const c = Math.floor((f + 0.5) / fps * SR) - N / 2;
    for (let i = 0; i < N; i++) { re[i] = (pcm[c + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (const [k, [lo, hi]] of Object.entries(bands)) {
      let e = 0; for (let b = lo; b < hi; b++) e += re[b] ** 2 + im[b] ** 2;
      raw[k].push(Math.log1p(Math.sqrt(e / (hi - lo)) * 20));
    }
    flux.push(Math.max(0, raw.bass[f] - prev)); prev = raw.bass[f];
  }
  const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)] || 1e-6;
  const shape = (a, attack, release) => { const lo = pct(a, .05), hi = pct(a, .97); let v = 0;
    return a.map(x => { const n = Math.min(1, Math.max(0, (x - lo) / (hi - lo + 1e-9))); v += (n - v) * (n > v ? attack : release); return +v.toFixed(4); }); };
  const th = pct(flux, .9), beat = []; let b = 0;
  for (let f = 0; f < frames; f++) { b = flux[f] >= th ? 1 : b * 0.82; beat.push(+b.toFixed(4)); }
  // spectrum: per-band floor (5th pct); ceiling = max(band 97th pct, 0.5 * global 97th) so quiet highs don't get over-boosted
  const lo = new Float32Array(NB), hi = new Float32Array(NB), all = [];
  for (let i = 0; i < NB; i++) { const col = []; for (let f = 0; f < frames; f++) col.push(rawS[f * NB + i]); lo[i] = pct(col, .05); hi[i] = pct(col, .97); all.push(hi[i]); }
  const gHi = pct(all, .9), spec = new Uint8Array(frames * NB), st = new Float32Array(NB);
  for (let f = 0; f < frames; f++) for (let i = 0; i < NB; i++) {
    const top = Math.max(hi[i], 0.5 * gHi), n = Math.min(1, Math.max(0, (rawS[f * NB + i] - lo[i]) / (top - lo[i] + 1e-9)));
    st[i] += (n - st[i]) * (n > st[i] ? 0.7 : 0.22); spec[f * NB + i] = Math.round(st[i] * 255);
  }
  const wa = []; for (let k = 0; k < wave.length; k += 7) wa.push(Math.abs(wave[k])); const wn = pct(wa, .99) || 1, wq = new Uint8Array(wave.length);
  for (let k = 0; k < wave.length; k++) wq[k] = Math.round((Math.max(-1, Math.min(1, wave[k] / wn)) * 0.5 + 0.5) * 255);
  return { v: 2, fps, frames, nb: NB, nw: NW, spec: Buffer.from(spec).toString('base64'), wave: Buffer.from(wq).toString('base64'), bass: shape(raw.bass, .7, .12), mid: shape(raw.mid, .5, .08), high: shape(raw.high, .6, .15), beat };
}
// cached by file path+mtime+fps so repeated renders skip analysis
export function analyzeCached(file, fps, cacheDir) {
  const st = fs.statSync(file);
  const key = crypto.createHash('md5').update(`v2|${path.resolve(file)}|${st.mtimeMs}|${st.size}|${fps}`).digest('hex');
  const f = path.join(cacheDir, key + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = analyze(file, fps); fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out)); return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inp, outp] = process.argv.slice(2), fi = process.argv.indexOf('--fps');
  const o = analyze(inp, fi > 0 ? +process.argv[fi + 1] : 30); fs.writeFileSync(outp, JSON.stringify(o));
  console.log(`${o.frames} frames -> ${outp}`);
}
