// K.scenes subset selection (SPEC §2a): cycling only chosen scenes, holding one, loop-safe schedule.   node tests/scenes.test.mjs
global.window = {}; global.document = { addEventListener(){}, body: null, currentScript: null }; global.addEventListener = () => {};
const fs = await import('node:fs'); new Function(fs.readFileSync(new URL("../core/pack-runtime.js", import.meta.url).pathname, 'utf8'))(); const K = window.kit; let ok = true; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; };
const A0 = { t: 0, meta: {}, section: null };
// fixed mode, all scenes: unchanged (10 scenes over 90 s)
t('all scenes: scene 3 at 30 s', K.scenes(30, A0, { count: 10, loop: 90 }).idx === 3 && !K.scenes(30, A0, { count: 10, loop: 90 }).held);
// subset: 3 chosen scenes share the loop
const only = [1, 4, 7], at = T => K.scenes(T, A0, { count: 10, loop: 90, only });
t('subset cycles only the chosen scenes', [0, 31, 61].map(T => at(T).idx).join() === '1,4,7');
t('subset fills the loop exactly (seam stays seamless)', at(89.99).idx === 7 && at(0).idx === 1 && Math.abs(at(30).local) < 1e-9 && Math.abs(at(30).len - 30) < 1e-9);
t('subset with per-scene durations stretches to the loop', (() => { const r = K.scenes(5, A0, { count: 3, loop: 60, only: [0, 2], durs: [10, 99, 30] }); return r.idx === 0 && Math.abs(r.len - 15) < 1e-9; })());
// one scene -> held
const one = K.scenes(12.5, A0, { count: 10, loop: 90, only: [6] }); t('one scene is held', one.held === true && one.idx === 6 && Math.abs(one.local - 12.5) < 1e-9);
// beats / sections modes only pick from the subset
const seen = new Set(); for (let b = 0; b < 40; b++) seen.add(K.scenes(0, { t: b * 8, meta: { bpm: 120 }, section: null }, { count: 10, mode: 'beats', beats: 16, only }).idx); t('beats mode stays inside the subset', [...seen].every(i => only.includes(i)) && seen.size === 3);
const seen2 = new Set(); for (let i = 0; i < 12; i++) seen2.add(K.scenes(0, { t: i * 10 + 1, meta: {}, section: { index: i, start: i * 10, end: i * 10 + 10 } }, { count: 10, mode: 'sections', beats: 16, bpm: 120, only }).idx); t('sections mode stays inside the subset', [...seen2].every(i => only.includes(i)));
// sceneIndices
const N = ['A', 'B', 'C', 'D']; t('sceneIndices: an explicit legacy `scene` beats the multi default (old presets keep working)', K.sceneIndices(N, N, 'C').join() === '2' && K.sceneIndices(N, N, '(cycle)') === undefined && K.sceneIndices(['A', 'B'], N, undefined).join() === '0,1'); t('sceneIndices: array -> sorted indices', K.sceneIndices(['C', 'A'], N).join() === '0,2');
t('sceneIndices: legacy single name', K.sceneIndices('B', N).join() === '1'); t('sceneIndices: legacy "cycle"/empty/all -> undefined', K.sceneIndices('(cycle)', N) === undefined && K.sceneIndices([], N) === undefined && K.sceneIndices(N, N) === undefined && K.sceneIndices(undefined, N) === undefined);
process.exit(ok ? 0 : 1);
