// Host-level "look": color grading / filters applied on top of ANY pack, live and offline, from one function.
//   look = { roto, glitch, screen,  hue, sat, bright, contrast, blur, invert, sepia, gray, hueDrift, hueBeat, brightBass, satMid }
//   hue (deg), sat/bright/contrast (1 = unchanged), blur (px), invert/sepia/gray (0..1)
//   audio-linked: hueDrift (deg/sec), hueBeat (deg added per unit beat), brightBass (+brightness per unit bass), satMid
window.LOOK_DEFAULTS = { roto: 0, glitch: 0, screen: 0, hue: 0, sat: 1, bright: 1, contrast: 1, blur: 0, invert: 0, sepia: 0, gray: 0, hueDrift: 0, hueBeat: 0, brightBass: 0, satMid: 0 };
// pixel passes (core/fx-gl.js), run by the pack runtime: roto 0|1|2 (flat tones, inked edges), glitch 0..1 (torn rows, RGB split, blocks), screen 0|1|2|3 (scanlines, CRT, curved CRT)
window.lookFx = function (look) { const L = { ...window.LOOK_DEFAULTS, ...(look || {}) }; return { roto: L.roto | 0, glitch: +L.glitch || 0, screen: L.screen | 0 }; };
window.lookToCss = function (look, A, t) {
  const L = { ...window.LOOK_DEFAULTS, ...(look || {}) }; A = A || { bass: 0, mid: 0, beat: 0 };
  const hue = L.hue + L.hueDrift * t + L.hueBeat * A.beat, sat = L.sat + L.satMid * A.mid, br = L.bright + L.brightBass * A.bass;
  const f = [];
  if (hue % 360) f.push(`hue-rotate(${hue.toFixed(2)}deg)`);
  if (sat !== 1) f.push(`saturate(${Math.max(0, sat).toFixed(3)})`);
  if (br !== 1) f.push(`brightness(${Math.max(0, br).toFixed(3)})`);
  if (L.contrast !== 1) f.push(`contrast(${L.contrast})`);
  if (L.sepia) f.push(`sepia(${L.sepia})`); if (L.gray) f.push(`grayscale(${L.gray})`); if (L.invert) f.push(`invert(${L.invert})`);
  if (L.blur) f.push(`blur(${L.blur}px)`);
  return f.join(' ') || 'none';
};
