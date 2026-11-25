// Look/FX passes on a pixel buffer: roto (flat tones, inked edges), glitch bursts, scanlines / CRT / curved CRT.
// CPU reference implementation, a line-for-line port of RiffBox's Rust (tests/fx-reference, MIT, same author), which ported them
// from the racing engine's look shaders. It is the oracle for the WebGL version (fx-gl.js) and fine for offline renders;
// it is far too slow for live 1080p roto (use fx-gl.js there). Conformance: tests/fx.test.mjs checks it against Rust goldens.
//
//   VisFX.lookFilter(src, dst, w, h, rotoMode, glitch, seconds)   rotoMode 0 none | 1 roto | 2 heavy;  glitch 0..1;  seconds = time
//   VisFX.screenFilter(src, dst, w, h, mode, outH)                mode 0 none | 1 scanlines | 2 CRT | 3 curved CRT;  outH = shown height (px)
//   VisFX.apply(src, w, h, fx, seconds, outH) -> RGBA array       the whole chain in the host's order: look pass, then screen pass
// src/dst: RGBA, 8 bits per channel (Uint8Array / Uint8ClampedArray), length w*h*4; alpha is written as 255.
(function (root) {
  const F = Math.fround, TAU = Math.PI * 2;
  // portable integer hash (v1 of the vis FX spec; identical to the Rust reference and the GLSL version): inputs quantised to 1/256, 24-bit output in [0,1)
  function hash(x, y) {
    let h = (Math.imul(Math.floor(F(x) * 256) | 0, 0x9E3779B1) ^ Math.imul(Math.floor(F(y) * 256) | 0, 0x85EBCA6B)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h = (h ^ (h >>> 12)) >>> 0; h = Math.imul(h, 0x297A2D39) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
    return (h >>> 8) / 16777216;
  }
  const luma = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const S = [0, 0, 0];                                   // scratch for sample()
  function sample(src, w, h, u, v, out) {                // nearest pixel, clamped to the picture; floats 0..1 written to `out`
    let x = Math.trunc(F(u * w)), y = Math.trunc(F(v * h));
    x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
    const i = (y * w + x) * 4; out[0] = src[i] / 255; out[1] = src[i + 1] / 255; out[2] = src[i + 2] / 255; return out;
  }
  function put(dst, i, c) {
    dst[i] = Math.floor(clamp01(c[0]) * 255 + 0.5); dst[i + 1] = Math.floor(clamp01(c[1]) * 255 + 0.5); dst[i + 2] = Math.floor(clamp01(c[2]) * 255 + 0.5); dst[i + 3] = 255;
  }
  const T0 = [0, 0, 0];
  // Kuwahara (least-varying quarter of the neighbourhood), light cut into bands with hue kept, edges inked
  function roto(src, w, h, u, v, heavy, out) {
    const st = Math.max(h / 720, 1) * (heavy ? 1.7 : 1), px = st / w, py = st / h;
    let b0 = 0, b1 = 0, b2 = 0, low = 3.4028235e38;
    for (let s = 0; s < 4; s++) {
      const dx = (s & 1) === 0 ? -1 : 1, dy = s < 2 ? -1 : 1;
      let s0 = 0, s1 = 0, s2 = 0, l1 = 0, l2 = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        sample(src, w, h, u + dx * i * px, v + dy * j * py, T0);
        const l = luma(T0[0], T0[1], T0[2]); s0 += T0[0]; s1 += T0[1]; s2 += T0[2]; l1 += l; l2 += l * l;
      }
      const mean = l1 / 9, vr = l2 / 9 - mean * mean;
      if (vr < low) { low = vr; b0 = s0 / 9; b1 = s1 / 9; b2 = s2 / 9; }
    }
    const l = luma(b0, b1, b2), tones = heavy ? 4 : 6, lg = Math.sqrt(Math.min(Math.max(l, 0), 0.999));
    let lq = (Math.floor(lg * tones) + 0.5) / tones; lq = lq * lq;
    const k = lq / Math.max(l, 0.04), f0 = 0.1 * lq + 0.9 * b0 * k, f1 = 0.1 * lq + 0.9 * b1 * k, f2 = 0.1 * lq + 0.9 * b2 * k;
    const e = (heavy ? 2 : 1.2) * st, qx = e / w, qy = e / h;
    const at = (a, b) => { sample(src, w, h, u + a * qx, v + b * qy, T0); return luma(T0[0], T0[1], T0[2]); };
    const tl = at(-1, -1), tc = at(0, -1), tr = at(1, -1), ml = at(-1, 0), mr = at(1, 0), bl = at(-1, 1), bc = at(0, 1), br = at(1, 1);
    const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl), gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
    const e0 = heavy ? 0.22 : 0.30, e1 = heavy ? 0.40 : 0.50, g = Math.sqrt(gx * gx + gy * gy), x = clamp01((g - e0) / (e1 - e0)), edge = x * x * (3 - 2 * x) * 0.85;
    out[0] = f0 + (0.085 - f0) * edge; out[1] = f1 + (0.06 - f1) * edge; out[2] = f2 + (0.05 - f2) * edge; return out;
  }
  const P0 = [0, 0, 0], P1 = [0, 0, 0], P2 = [0, 0, 0], C = [0, 0, 0];
  function lookFilter(src, dst, w, h, rotoMode, glitch, seconds) {
    const picture = (u, v, out) => rotoMode > 0 ? roto(src, w, h, u, v, rotoMode >= 2, out) : sample(src, w, h, u, v, out);
    const g32 = F(glitch), t = Math.floor(F(F(seconds) * 11)), C13 = F(1.3);   // inputs to hash() must be float32 too (it amplifies 1 ulp ×43758)
    const burst = glitch > 0 && hash(t, 1.7) >= F(1 - F(F(0.30) * g32)) ? 1 : 0, rows = F(12 + F(F(44 - 12) * hash(t, 3.1)));
    for (let y = 0; y < h; y++) {
      const v = F(F(y + 0.5) / h);
      for (let x = 0; x < w; x++) {
        const u = F(F(x + 0.5) / w);
        if (glitch > 0) {
          const rid = Math.floor(F(v * rows)), on = burst * (hash(rid, t) >= F(0.55) ? 1 : 0);
          let uu0 = u + on * (hash(rid, t + 9) - 0.5) * 0.14 * glitch, uu1 = v;
          const c0 = Math.floor(F(u * 22)), c1 = Math.floor(F(v * 13)), tc = F(t * C13), block = burst * (hash(F(c0 + tc), F(c1 + tc)) >= F(1 - F(F(0.07) * g32)) ? 1 : 0);
          if (block > 0) { uu0 = (Math.floor(u * 88) + 0.5) / 88; uu1 = (Math.floor(v * 52) + 0.5) / 52; }
          const split = (on * 0.008 + burst * 0.0016) * glitch;
          if (split > 0) { C[0] = picture(uu0 + split, uu1, P0)[0]; C[1] = picture(uu0, uu1, P1)[1]; C[2] = picture(uu0 - split, uu1, P2)[2]; }
          else { picture(uu0, uu1, P0); C[0] = P0[0]; C[1] = P0[1]; C[2] = P0[2]; }
        } else { picture(u, v, P0); C[0] = P0[0]; C[1] = P0[1]; C[2] = P0[2]; }
        put(dst, (y * w + x) * 4, C);
      }
    }
  }
  const A = [0, 0, 0], B = [0, 0, 0], Cc = [0, 0, 0], RGB = [0, 0, 0];
  function screenFilter(src, dst, w, h, mode, outH) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let u = (x + 0.5) / w, v = (y + 0.5) / h, inside = 1;
      if (mode === 3) {   // barrel distortion: corners pull in; rounded corners, black outside
        let cx = u * 2 - 1, cy = v * 2 - 1; const ox = cx, oy = cy;
        cx *= 1 + 0.03 * oy * oy; cy *= 1 + 0.045 * ox * ox; u = cx * 0.5 + 0.5; v = cy * 0.5 + 0.5;
        const d = Math.sqrt(Math.pow(Math.max(Math.abs(cx) - 0.94, 0) / 0.06, 2) + Math.pow(Math.max(Math.abs(cy) - 0.94, 0) / 0.06, 2)), s = clamp01((d - 0.85) / 0.15);
        inside = 1 - s * s * (3 - 2 * s);
        if (Math.abs(cx) > 1 || Math.abs(cy) > 1) inside = 0;
      }
      let r, g, b;
      if (mode >= 2) {
        const dx = 0.35 / (224 * w / h); sample(src, w, h, u - dx, v, A); sample(src, w, h, u, v, B); sample(src, w, h, u + dx, v, Cc);
        r = 0.25 * A[0] + 0.5 * B[0] + 0.25 * Cc[0]; g = 0.25 * A[1] + 0.5 * B[1] + 0.25 * Cc[1]; b = 0.25 * A[2] + 0.5 * B[2] + 0.25 * Cc[2];
      } else { sample(src, w, h, u, v, A); r = A[0]; g = A[1]; b = A[2]; }
      if (mode >= 1) {    // 224 lines, bright at their middle, dark between, averaged over the shown pixel
        const lines = v * 224, span = 224 / Math.max(outH, 1) * (mode === 3 ? 1.1 : 1);
        const l0 = TAU * (lines - 0.5 * span - 0.5), l1 = TAU * (lines + 0.5 * span - 0.5);
        const beam = Math.abs(l1 - l0) > 1e-6 ? (Math.sin(l1) - Math.sin(l0)) / (l1 - l0) : Math.cos(l0);
        const depth = (mode >= 2 ? 0.55 : 0.45) * (1 - 0.45 * luma(r, g, b)), k = (1 - depth * (0.5 - 0.5 * beam)) / (1 - depth * 0.5);
        r *= k; g *= k; b *= k;
      }
      if (mode >= 2) {    // aperture grille, darker corners
        const q = x % 3, m0 = q === 0 ? 1 : 0.72, m1 = q === 1 ? 1 : 0.72, m2 = q === 2 ? 1 : 0.72, n = 3 / (1 + 2 * 0.72);
        const ex = u * 2 - 1, ey = v * 2 - 1, corner = 1 - 0.09 * (ex * ex + ey * ey) * (ex * ex + ey * ey);
        r = r * m0 * n * corner; g = g * m1 * n * corner; b = b * m2 * n * corner;
      }
      RGB[0] = r * inside; RGB[1] = g * inside; RGB[2] = b * inside; put(dst, (y * w + x) * 4, RGB);
    }
  }
  // the host's order: look pass (roto, glitch) then screen pass (scanlines/CRT). fx = {roto, glitch, screen}
  function apply(src, w, h, fx, seconds, outH) {
    let cur = src;
    if ((fx.roto | 0) > 0 || fx.glitch > 0) { const d = new Uint8ClampedArray(w * h * 4); lookFilter(cur, d, w, h, fx.roto | 0, fx.glitch || 0, seconds); cur = d; }
    if ((fx.screen | 0) > 0) { const d = new Uint8ClampedArray(w * h * 4); screenFilter(cur, d, w, h, fx.screen | 0, outH || h); cur = d; }
    return cur;
  }
  const api = { hash, lookFilter, screenFilter, apply, version: 1 };
  root.VisFX = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
