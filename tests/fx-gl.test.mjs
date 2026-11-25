// Conformance: core/fx-gl.js (WebGL2) must reproduce the Rust goldens, and agree with core/fx.js (CPU reference).
//   node tests/fx-gl.test.mjs      (needs Chrome via playwright-core)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, 'golden/fx'), root = path.join(here, '..');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), { width: w, height: h } = man;
const b64 = f => fs.readFileSync(f).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' }), page = await (await browser.newContext()).newPage(); const errs = [];
page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.setContent('<canvas id=c></canvas>');
await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'core/fx-gl.js'), 'utf8') });
const info = await page.evaluate(() => ({ ok: VisFXGL.supported(), r: (() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }));
if (!info.ok) { console.error('WebGL2 not available in this Chrome'); process.exit(2); }
console.log('renderer:', info.r);
const gl = await page.evaluate(async ([cases, w, h, inputB64]) => {
  const fx = VisFXGL.create(document.getElementById('c')), input = Uint8Array.from(atob(inputB64), c => c.charCodeAt(0)), out = {};
  for (const c of cases) { fx.apply({ data: input, width: w, height: h }, c.kind === 'look' ? { roto: c.roto, glitch: c.glitch, screen: 0 } : c.kind === 'screen' ? { roto: 0, glitch: 0, screen: c.mode } : { roto: c.roto, glitch: c.glitch, screen: c.mode }, c.seconds || 0, c.outH || h); out[c.name] = Array.from(fx.readPixels()); }
  return out; }, [man.cases, w, h, b64(path.join(dir, 'input.rgba'))]);
// GPU maths (sin, float rounding) can differ from the CPU by a level or two, and rarely flips a band edge
const TOL = { maxOff: 1.0, mean: 0.8 }; let bad = 0;
for (const c of man.cases) {
  const gold = new Uint8Array(fs.readFileSync(path.join(dir, c.name + '.rgba'))), got = gl[c.name]; let sum = 0, off = 0, mx = 0;
  for (let i = 0; i < gold.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(got[i] - gold[i]); sum += d; if (d > 2) off++; if (d > mx) mx = d; }
  const n = w * h * 3, mean = sum / n, offPct = 100 * off / n, ok = offPct <= TOL.maxOff && mean <= TOL.mean; if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} mean err ${mean.toFixed(3)}  >2 off ${offPct.toFixed(2)}%  max ${mx}`);
}
if (errs.length) { console.log('page errors:', [...new Set(errs)].slice(0, 3)); bad++; }
await browser.close(); console.log(bad ? `\n${bad} FAILED` : `\nall ${man.cases.length} cases match the Rust reference on the GPU path`); process.exit(bad ? 1 : 0);
