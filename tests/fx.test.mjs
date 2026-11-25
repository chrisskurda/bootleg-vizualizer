// Conformance: core/fx.js (CPU reference port) must reproduce the Rust goldens (tests/golden/fx, made by tests/fx-reference).
//   node tests/fx.test.mjs            [--verbose]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
await import('../core/fx.js');                       // classic script: publishes globalThis.VisFX
const here = path.dirname(fileURLToPath(import.meta.url)), FX = globalThis.VisFX;
const dir = path.join(here, 'golden/fx'), man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), { width: w, height: h } = man;
const input = new Uint8Array(fs.readFileSync(path.join(dir, 'input.rgba'))); const verbose = process.argv.includes('--verbose');
// tolerance: float rounding may move a value by a level or two, and rarely flips a band edge; anything beyond that is a real mismatch
const TOL = { maxOff: 0.5 /* % of pixels allowed to be off by >2 levels */, mean: 0.35 /* mean abs level error */ };
let bad = 0;
// 1) the noise function must be bit-exact (it decides which rows tear)
const hv = JSON.parse(fs.readFileSync(path.join(dir, 'hash.json'), 'utf8')); let hbad = 0;
for (const [x, y, want] of hv) if (Math.round(FX.hash(x, y) * 16777216) !== want) hbad++;
console.log(`${hbad ? 'FAIL' : 'PASS'}  hash           ${hv.length} vectors, ${hbad} mismatches (must be 0: bit-exact)`); if (hbad) bad++;
// 2) the passes, pixel by pixel
for (const c of man.cases) {
  const gold = new Uint8Array(fs.readFileSync(path.join(dir, c.name + '.rgba'))), out = new Uint8ClampedArray(w * h * 4);
  if (c.kind === 'look') FX.lookFilter(input, out, w, h, c.roto, c.glitch, c.seconds); else if (c.kind === 'screen') FX.screenFilter(input, out, w, h, c.mode, c.outH);
  else out.set(FX.apply(input, w, h, { roto: c.roto, glitch: c.glitch, screen: c.mode }, c.seconds, c.outH));
  let sum = 0, off = 0, mx = 0, changed = 0;
  for (let i = 0; i < out.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(out[i] - gold[i]); sum += d; if (d > 2) off++; if (d > mx) mx = d; if (gold[i] !== input[i]) changed++; }
  const n = w * h * 3, meanErr = sum / n, offPct = 100 * off / n, nontrivial = 100 * changed / n;
  const ok = offPct <= TOL.maxOff && meanErr <= TOL.mean;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)} mean err ${meanErr.toFixed(3)}  >2 off ${offPct.toFixed(2)}%  max ${mx}   (golden differs from input on ${nontrivial.toFixed(0)}% of values)`);
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${man.cases.length} cases match the Rust reference`); process.exit(bad ? 1 : 0);
