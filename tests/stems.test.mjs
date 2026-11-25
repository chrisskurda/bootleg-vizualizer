// Stems (SPEC §2c): analysis of a render folder, the A.stems / A.stem() frame shape, and live per-stem taps.
//   node tests/stems.test.mjs        (live-tap part needs Chrome via playwright-core)
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), fixture = path.join(root, 'cache/fixture-render');
if (!fs.existsSync(path.join(fixture, 'stems/kick.flac'))) spawnSync('node', [path.join(here, 'make-fixture.mjs')], { stdio: 'inherit' });
const { analyzeStems, roleOf } = await import('../bin/stems.mjs'); await import('../core/stems.js'); const VS = globalThis.VisStems;
let bad = 0; const t = (name, cond, note = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? '   ' + note : ''}`); if (!cond) bad++; };
const dec = b64 => Uint8Array.from(Buffer.from(b64, 'base64')), rises = (u8, hi = 200, lo = 100) => { let n = 0, armed = true; for (const v of u8) { if (armed && v >= hi) { n++; armed = false; } else if (v < lo) armed = true; } return n; };
const mean = u8 => u8.reduce((a, b) => a + b, 0) / u8.length / 255;

console.log('--- analysis (bin/stems.mjs) on the synthetic render (120 BPM, kick every beat, hats every 8th, 12 s)');
const D = analyzeStems(fixture, 30), S = Object.fromEntries(D.stems.map(s => [s.name, s]));
t('finds all 5 stems', D.stems.length === 5 && ['kick', 'snare', 'hats', 'sub', 'keys'].every(n => S[n]));
t('roles: sub -> bass, colour -> pad, 808 -> bass, unknown -> other', roleOf('sub') === 'bass' && roleOf('colour') === 'pad' && roleOf('808') === 'bass' && roleOf('zzz') === 'other');
const kb = rises(dec(S.kick.beat)), hb = rises(dec(S.hats.beat)), sb = rises(dec(S.sub.beat));
t('kick onsets ≈ one per beat (24 in 12 s)', Math.abs(kb - 24) <= 3, `got ${kb}`);
t('hat onsets ≈ one per 8th (48)', Math.abs(hb - 48) <= 8, `got ${hb}`);
t('steady sub tone has almost no onsets', sb <= 2, `got ${sb}`);
t('shared level scale: steady loud sub > sparse hats', mean(dec(S.sub.level)) > mean(dec(S.hats.level)), `sub ${mean(dec(S.sub.level)).toFixed(2)} vs hats ${mean(dec(S.hats.level)).toFixed(2)}`);
const bandMass = (s, lo, hi) => { const sp = dec(s.spec); let m = 0; for (let f = 0; f < D.frames; f++) for (let b = lo; b < hi; b++) m += sp[f * 16 + b]; return m; };
t('spectra differ by stem: hats high, sub low', bandMass(S.hats, 10, 16) > bandMass(S.hats, 0, 6) && bandMass(S.sub, 0, 6) > bandMass(S.sub, 10, 16));
t('mix gain from manifest', Math.abs(S.snare.gainDb + 5.6) < 1e-6);
t('clip timeline for text: hats has 2 loops with cleaned labels + kits', S.hats.clips.length === 2 && S.hats.clips[0].label === 'Hats Closed 120' && S.hats.clips[1].kit === 'Test Kit Two');
t('hits get a time span from start_s/length_s', S.snare.clips.length === 1 && Math.abs(S.snare.clips[0].start - 1) < 1e-6 && Math.abs(S.snare.clips[0].end - 1.4) < 1e-6);
t('loops are placed from bars (3 bars @120 = 6 s)', Math.abs(S.hats.clips[0].end - 6) < 1e-3 && Math.abs(S.hats.clips[1].start - 6) < 1e-3);

console.log('--- frame shape (core/stems.js)');
const P = VS.prepare(D), A1 = VS.attach({ bass: 0.7, mid: 0.2, high: 0.1, beat: 0.9, level: 0.4 }, VS.at(P, 1.0)), A2 = VS.attach({ bass: 0.7, mid: 0.2, high: 0.1, beat: 0.9, level: 0.4 }, VS.at(P, 7.0));
t('label follows the clip timeline (1 s vs 7 s)', A1.stem('hats').label === 'Hats Closed 120' && A2.stem('hats').label === 'Hats Open Shuffle 120' && A2.stem('hats').kit === 'Test Kit Two');
t('clip progress advances within a loop', A1.stem('hats').clip.progress > 0 && A1.stem('hats').clip.progress < 0.5 && VS.at(P, 5.0).find(s => s.name === 'hats').clip.progress > 0.8);
t('lookup by name and by role; real stems are not estimated', A1.stem('kick').estimated === false && A1.stem('bass').name === 'sub' && A1.stem('SUB').role === 'bass');
t('a missing role falls back to an ESTIMATE from the mix (never undefined)', A1.stem('vocals').estimated === true && A1.stem('vocals').level >= 0 && A1.stem('vocals').spectrum.length === 16);
const none = VS.attach({ bass: 0.7, mid: 0.2, high: 0.1, beat: 0.9, level: 0.4, spectrum: new Float32Array(64).fill(0.5) }, []);
t('no stems at all: kick ≈ bass+beat, hats ≈ high', none.stems.length === 0 && none.stem('kick').estimated && Math.abs(none.stem('kick').level - 0.7) < 1e-6 && none.stem('kick').beat === 0.9 && Math.abs(none.stem('hats').level - 0.1) < 1e-6);
const solo = VS.at(P, 1, { kick: { solo: true } }), mute = VS.at(P, 1, { hats: { muted: true, gainDb: -12 } });
t('solo: only the soloed stem is audible', solo.find(s => s.name === 'kick').audible && !solo.find(s => s.name === 'hats').audible);
t('mute + fader gain are reflected', mute.find(s => s.name === 'hats').muted && !mute.find(s => s.name === 'hats').audible && Math.abs(mute.find(s => s.name === 'hats').gain - Math.pow(10, -0.6)) < 1e-9);

console.log('--- live per-stem taps (core/audio.js addStem) in Chrome');
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }), page = await browser.newPage(), errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/core/stems.js`); // any same-origin page; we build our own below
await page.setContent('<script src="/core/stems.js"></script>', { waitUntil: 'load' }).catch(() => {});
const live = await page.evaluate(async () => {
  const { AudioFeed } = await import('/core/audio.js'); await new Promise(r => { const s = document.createElement('script'); s.src = '/core/stems.js'; s.onload = r; document.head.appendChild(s); });
  const feed = new AudioFeed(); feed._init(); const ctx = feed.ctx; await ctx.resume();
  const tone = ctx.createOscillator(); tone.frequency.value = 440; const tg = ctx.createGain(); tg.gain.value = 0.4; tone.connect(tg);
  const pulse = ctx.createOscillator(); pulse.frequency.value = 110; const pg = ctx.createGain(); pg.gain.value = 0; pulse.connect(pg);
  const t0 = ctx.currentTime + 0.1; for (let k = 0; k < 40; k++) { pg.gain.setValueAtTime(0.9, t0 + k * 0.25); pg.gain.setValueAtTime(0, t0 + k * 0.25 + 0.06); }
  tone.start(); pulse.start(); feed.addStem('tone', tg, { role: 'keys', label: 'Sine 440' }); feed.addStem('pulse', pg, { role: 'kick', gainDb: -3 });
  let maxBeat = { tone: 0, pulse: 0 }, lastA = null, n = 0, tEnd = performance.now() + 2500;
  await new Promise(res => { const tick = () => { const A = feed.update(1 / 60); lastA = A; n++; if (A.stems && performance.now() > tEnd - 1800) for (const s of A.stems) maxBeat[s.name] = Math.max(maxBeat[s.name], s.beat); /* after warm-up: the tone's own start is a real onset */ if (performance.now() < tEnd) requestAnimationFrame(tick); else res(); }; tick(); });
  const A = lastA, p = A.stem('pulse'), tn = A.stem('tone'); feed.stemState.pulse = { muted: true }; const B = feed.update(1 / 60);
  return { count: A.stems.length, hasAccessor: typeof A.stem === 'function', toneLevel: tn.level, pulseRole: p.role, pulseGain: p.gainDb, maxBeat, spec: tn.spectrum.length, label: tn.label,
    specPeakBand: Array.from(tn.spectrum).indexOf(Math.max(...tn.spectrum)), mutedAudible: B.stem('pulse').audible, toneAudible: B.stem('tone').audible, frames: n };
});
t('two live taps produce A.stems and A.stem()', live.count === 2 && live.hasAccessor, `frames ${live.frames}`);
t('steady tone: level well above zero, but no onsets', live.toneLevel > 0.3 && live.maxBeat.tone < 0.6, `level ${live.toneLevel.toFixed(2)}, max beat ${live.maxBeat.tone.toFixed(2)}`);
t('gated stem: onset pulses fire', live.maxBeat.pulse > 0.9, `max beat ${live.maxBeat.pulse.toFixed(2)}`);
t('role, label and gain pass through', live.pulseRole === 'kick' && live.pulseGain === -3 && live.label === 'Sine 440');
t('16-band spectrum per stem, peak where the tone is (440 Hz ≈ band 6-8)', live.spec === 16 && live.specPeakBand >= 5 && live.specPeakBand <= 9, `peak band ${live.specPeakBand}`);
t('player faders: muting one stem makes it inaudible, others stay audible', live.mutedAudible === false && live.toneAudible === true);
if (errs.length) { console.log('page errors:', [...new Set(errs)].slice(0, 3)); bad++; }
await browser.close(); srv.close(); console.log(bad ? `\n${bad} FAILED` : '\nall stem tests pass'); process.exit(bad ? 1 : 0);
