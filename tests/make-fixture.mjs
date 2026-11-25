// Builds a small synthetic bootleg stem set (manifest.json, clips.json, stems/*.flac, mix.flac) for stem tests.
//   node tests/make-fixture.mjs [outdir]    (default: cache/fixture-render)
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2] || path.join(root, 'cache/fixture-render')), D = 12, BPM = 120;
fs.mkdirSync(path.join(out, 'stems'), { recursive: true });
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...a]); if (r.status) throw new Error(r.stderr.toString()); };
const beat = 60 / BPM;  // 0.5 s; kick on every beat, snare on 2 and 4, hats on 8ths, bass note held, keys chord
const stems = {
  kick:  `sine=f=55:d=${D},volume='if(lt(mod(t,${beat}),0.12),1,0)':eval=frame`,
  snare: `anoisesrc=d=${D}:a=0.5:c=pink,bandpass=f=1800:w=1500,volume='if(lt(mod(t-${beat},${beat * 2}),0.1),1,0)':eval=frame`,
  hats:  `anoisesrc=d=${D}:a=0.3:c=white,highpass=f=7000,volume='if(lt(mod(t,${beat / 2}),0.04),0.8,0)':eval=frame`,
  sub:   `sine=f=41:d=${D},volume=0.8`,
  keys:  `sine=f=330:d=${D},tremolo=f=0.5:d=0.6,volume=0.3`,
};
for (const [n, src] of Object.entries(stems)) ff('-f', 'lavfi', '-i', src, '-ac', '1', '-ar', '44100', '-c:a', 'flac', path.join(out, 'stems', n + '.flac'));
ff(...Object.keys(stems).flatMap(n => ['-i', path.join(out, 'stems', n + '.flac')]), '-filter_complex', `amix=inputs=${Object.keys(stems).length}:normalize=0`, '-c:a', 'flac', path.join(out, 'mix.flac'));
const bar = 4 * beat;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ name: 'fixture_render', bpm: BPM, key: 'am', key_label: 'A minor', seconds: D, stems_gain_db: { kick: -0.4, snare: -5.6, hats: -7.7, sub: -3.2, keys: -2.3 },
  sections: [{ name: 'intro', start_s: 0, end_s: 4 * bar }, { name: 'hook', start_s: 4 * bar, end_s: 6 * bar }] }, null, 1));
fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify({ version: 1, bpm: BPM, key: 'am', clips: [
  { kind: 'loop', stem: 'kick', file: 'Drums/Kick_Loop_120_A.wav', kit: 'Test Kit One', start_bar: 0, bars: 6 },
  { kind: 'loop', stem: 'hats', file: 'Drums/Hats_Closed_120.wav', kit: 'Test Kit One', start_bar: 0, bars: 3 },
  { kind: 'loop', stem: 'hats', file: 'Drums/Hats_Open_Shuffle_120.wav', kit: 'Test Kit Two', start_bar: 3, bars: 3 },
  { kind: 'loop', stem: 'keys', file: 'Keys/Rhodes_Am_Chords_120.wav', kit: 'Test Kit Two', start_bar: 0, bars: 6 },
  { kind: 'hit', stem: 'snare', file: 'Hits/Snare_Tight_01.wav', kit: 'Test Kit One', start_s: 1.0, length_s: 0.4 },
] }, null, 1));
console.log('fixture:', out);
