// The pack kit (K) must keep every member the spec documents — packs call them, and a missing one only fails at draw time.   node tests/kit.test.mjs
global.window = {}; global.document = { addEventListener() {}, body: null, currentScript: null }; global.addEventListener = () => {};
const fs = await import('node:fs'); new Function(fs.readFileSync(new URL('../core/pack-runtime.js', import.meta.url).pathname, 'utf8'))();
const K = window.kit, spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url).pathname, 'utf8');
// members listed in SPEC §2 "K — kit", plus the ones documented elsewhere in the spec
const MEMBERS = ['TAU', 'mix', 'clamp', 'pal', 'rgba', 'css', 'rng', 'smooth', 'fmtTime', 'text', 'peak', 'palettes', 'PALETTES', 'addPalette', 'scenes', 'sceneIndices', 'phase', 'drift', 'tri', 'progress', 'ema', 'softShadow', 'image', 'cover'];
let bad = 0; for (const m of MEMBERS) { const ok = K[m] !== undefined, inSpec = spec.includes('K.' + m) || spec.includes('`' + m + '`') || ['TAU', 'mix', 'clamp', 'rgba', 'rng', 'PALETTES', 'palettes'].includes(m); if (!ok || !inSpec) { console.log(`FAIL  K.${m}  ${!ok ? 'missing from the runtime' : 'not documented in SPEC.md'}`); bad++; } }
console.log(bad ? `\n${bad} FAILED` : `PASS  kit has all ${MEMBERS.length} documented members`); process.exit(bad ? 1 : 0);
