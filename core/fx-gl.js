// WebGL2 version of the Look/FX passes (roto, glitch bursts, scanlines/CRT/curved CRT): real time at 1080p and above.
// A direct translation of core/fx.js (itself a port of the Rust reference in tests/fx-reference): same maths, same portable
// integer hash, so a given (seconds, glitch, roto, screen) gives the same picture on every implementation.
// Conformance: tests/fx-gl.test.mjs checks it against the Rust goldens.
//
//   const fx = VisFXGL.create(outCanvas);                     // outCanvas gets the filtered picture (it is resized to the source)
//   fx.apply(source, { roto, glitch, screen }, seconds, outH) // source: <canvas> | {data: RGBA bytes, width, height}
//                                                             // roto 0|1|2, glitch 0..1, screen 0|1|2|3, outH = shown height in px
//   fx.readPixels() -> Uint8Array RGBA, top row first         // for tests / video export
//   VisFXGL.supported() -> bool
(function (root) {
  const HEAD = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc; uniform vec2 uSize; uniform float uFlip;   // uFlip: 1 when drawing to the canvas (rows count from the bottom), 0 into an intermediate texture
out vec4 o;
vec3 smp(float u, float v) {  // nearest pixel, clamped (as the reference's sample())
  ivec2 p = ivec2(clamp(int(u * uSize.x), 0, int(uSize.x) - 1), clamp(int(v * uSize.y), 0, int(uSize.y) - 1));
  return texelFetch(uSrc, p, 0).rgb;
}
float luma(vec3 c) { return c.r * 0.299 + c.g * 0.587 + c.b * 0.114; }
vec2 pixel() { return vec2(gl_FragCoord.x, uFlip > 0.5 ? uSize.y - gl_FragCoord.y : gl_FragCoord.y); }   // (x + .5, y + .5), top row first
`;
  const VERT = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const LOOK = HEAD + `
uniform int uRoto; uniform float uGlitch, uSeconds;
uint ihash(float x, float y) {  // portable integer hash: 1/256 quantisation, wrapping 32-bit multiplies
  uint xi = uint(int(floor(x * 256.0))), yi = uint(int(floor(y * 256.0)));
  uint h = (xi * 0x9E3779B1u) ^ (yi * 0x85EBCA6Bu);
  h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u; return h;
}
float hash(float x, float y) { return float(ihash(x, y) >> 8u) / 16777216.0; }
vec3 roto(float u, float v, bool heavy) {
  float st = max(uSize.y / 720.0, 1.0) * (heavy ? 1.7 : 1.0), px = st / uSize.x, py = st / uSize.y;
  vec3 best = vec3(0.0); float low = 3.4028235e38;
  for (int s = 0; s < 4; s++) {
    float dx = ((s & 1) == 0) ? -1.0 : 1.0, dy = s < 2 ? -1.0 : 1.0;
    vec3 sum = vec3(0.0); float l1 = 0.0, l2 = 0.0;
    for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) { vec3 c = smp(u + dx * float(i) * px, v + dy * float(j) * py); float l = luma(c); sum += c; l1 += l; l2 += l * l; }
    float mean = l1 / 9.0, vr = l2 / 9.0 - mean * mean;
    if (vr < low) { low = vr; best = sum / 9.0; }
  }
  float l = luma(best), tones = heavy ? 4.0 : 6.0, lg = sqrt(clamp(l, 0.0, 0.999));
  float lq = (floor(lg * tones) + 0.5) / tones; lq = lq * lq;
  float k = lq / max(l, 0.04); vec3 flat_ = 0.1 * lq + 0.9 * best * k;
  float e = (heavy ? 2.0 : 1.2) * st, qx = e / uSize.x, qy = e / uSize.y;
  float tl = luma(smp(u - qx, v - qy)), tc = luma(smp(u, v - qy)), tr = luma(smp(u + qx, v - qy)), ml = luma(smp(u - qx, v)), mr = luma(smp(u + qx, v));
  float bl = luma(smp(u - qx, v + qy)), bc = luma(smp(u, v + qy)), br = luma(smp(u + qx, v + qy));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  float e0 = heavy ? 0.22 : 0.30, e1 = heavy ? 0.40 : 0.50, g = sqrt(gx * gx + gy * gy), x = clamp((g - e0) / (e1 - e0), 0.0, 1.0), edge = x * x * (3.0 - 2.0 * x) * 0.85;
  return mix(flat_, vec3(0.085, 0.06, 0.05), edge);
}
vec3 picture(float u, float v) { return uRoto > 0 ? roto(u, v, uRoto >= 2) : smp(u, v); }
void main() {
  vec2 pix = pixel(); float u = pix.x / uSize.x, v = pix.y / uSize.y; vec3 c;
  if (uGlitch > 0.0) {
    float t = floor(uSeconds * 11.0), burst = hash(t, 1.7) >= 1.0 - 0.30 * uGlitch ? 1.0 : 0.0, rows = 12.0 + (44.0 - 12.0) * hash(t, 3.1);
    float rid = floor(v * rows), on = burst * (hash(rid, t) >= 0.55 ? 1.0 : 0.0);
    vec2 uu = vec2(u + on * (hash(rid, t + 9.0) - 0.5) * 0.14 * uGlitch, v);
    vec2 cell = vec2(floor(u * 22.0), floor(v * 13.0));
    float block = burst * (hash(cell.x + t * 1.3, cell.y + t * 1.3) >= 1.0 - 0.07 * uGlitch ? 1.0 : 0.0);
    if (block > 0.0) uu = vec2((floor(u * 88.0) + 0.5) / 88.0, (floor(v * 52.0) + 0.5) / 52.0);
    float split = (on * 0.008 + burst * 0.0016) * uGlitch;
    if (split > 0.0) c = vec3(picture(uu.x + split, uu.y).r, picture(uu.x, uu.y).g, picture(uu.x - split, uu.y).b); else c = picture(uu.x, uu.y);
  } else c = picture(u, v);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
  const SCREEN = HEAD + `
uniform int uMode; uniform float uOutH;
void main() {
  vec2 pix = pixel(); float u = pix.x / uSize.x, v = pix.y / uSize.y, inside = 1.0;
  if (uMode == 3) {   // barrel distortion: corners pull in; rounded corners, black outside
    float cx = u * 2.0 - 1.0, cy = v * 2.0 - 1.0, ox = cx, oy = cy;
    cx *= 1.0 + 0.03 * oy * oy; cy *= 1.0 + 0.045 * ox * ox; u = cx * 0.5 + 0.5; v = cy * 0.5 + 0.5;
    float d = sqrt(pow(max(abs(cx) - 0.94, 0.0) / 0.06, 2.0) + pow(max(abs(cy) - 0.94, 0.0) / 0.06, 2.0)), s = clamp((d - 0.85) / 0.15, 0.0, 1.0);
    inside = 1.0 - s * s * (3.0 - 2.0 * s); if (abs(cx) > 1.0 || abs(cy) > 1.0) inside = 0.0;
  }
  vec3 rgb;
  if (uMode >= 2) { float dx = 0.35 / (224.0 * uSize.x / uSize.y); rgb = 0.25 * smp(u - dx, v) + 0.5 * smp(u, v) + 0.25 * smp(u + dx, v); } else rgb = smp(u, v);
  if (uMode >= 1) {   // 224 lines, bright at their middle, dark between, averaged over the shown pixel
    float lines = v * 224.0, span = 224.0 / max(uOutH, 1.0) * (uMode == 3 ? 1.1 : 1.0), tau = 6.28318530718;
    float l0 = tau * (lines - 0.5 * span - 0.5), l1 = tau * (lines + 0.5 * span - 0.5);
    float beam = abs(l1 - l0) > 1e-6 ? (sin(l1) - sin(l0)) / (l1 - l0) : cos(l0);
    float depth = (uMode >= 2 ? 0.55 : 0.45) * (1.0 - 0.45 * luma(rgb)), k = (1.0 - depth * (0.5 - 0.5 * beam)) / (1.0 - depth * 0.5);
    rgb *= k;
  }
  if (uMode >= 2) {   // aperture grille, darker corners
    int xm = int(gl_FragCoord.x) % 3; vec3 m = xm == 0 ? vec3(1.0, 0.72, 0.72) : xm == 1 ? vec3(0.72, 1.0, 0.72) : vec3(0.72, 0.72, 1.0);
    float n = 3.0 / (1.0 + 2.0 * 0.72), ex = u * 2.0 - 1.0, ey = v * 2.0 - 1.0, corner = 1.0 - 0.09 * (ex * ex + ey * ey) * (ex * ex + ey * ey);
    rgb = rgb * m * n * corner;
  }
  o = vec4(clamp(rgb * inside, 0.0, 1.0), 1.0);
}`;

  function supported() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }
  function create(canvas) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    const prog = src => { const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, src)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); } return { p, u }; };
    const look = prog(LOOK), screen = prog(SCREEN), vao = gl.createVertexArray();
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const tSrc = tex(), tMid = tex(), fbo = gl.createFramebuffer(); let mw = 0, mh = 0;
    function run(p, w, h, texture, uniforms, toScreen) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : fbo); if (!toScreen) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tMid, 0);
      gl.viewport(0, 0, w, h); gl.useProgram(p.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(p.u.uSrc, 0); gl.uniform2f(p.u.uSize, w, h); gl.uniform1f(p.u.uFlip, toScreen ? 1 : 0);
      for (const [k, [kind, v]] of Object.entries(uniforms)) gl[kind === 'i' ? 'uniform1i' : 'uniform1f'](p.u[k], v);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return {
      apply(source, fx, seconds, outH) {
        const w = source.width, h = source.height; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.bindTexture(gl.TEXTURE_2D, tSrc);
        if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const doLook = (fx.roto | 0) > 0 || fx.glitch > 0, doScreen = (fx.screen | 0) > 0;
        if (doLook && doScreen) { if (mw !== w || mh !== h) { gl.bindTexture(gl.TEXTURE_2D, tMid); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); mw = w; mh = h; } }
        const lk = { uRoto: ['i', fx.roto | 0], uGlitch: ['f', fx.glitch || 0], uSeconds: ['f', seconds || 0] }, sc = { uMode: ['i', fx.screen | 0], uOutH: ['f', outH || h] };
        if (doLook && doScreen) { run(look, w, h, tSrc, lk, false); run(screen, w, h, tMid, sc, true); }
        else if (doLook) run(look, w, h, tSrc, lk, true);
        else if (doScreen) run(screen, w, h, tSrc, sc, true);
        else { // nothing to do: show the source as it is
          const id = { uRoto: ['i', 0], uGlitch: ['f', 0], uSeconds: ['f', 0] }; run(look, w, h, tSrc, id, true); }
      },
      readPixels() { const w = canvas.width, h = canvas.height, buf = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const out = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); return out; },
    };
  }
  root.VisFXGL = { create, supported, version: 1 };
})(typeof window !== 'undefined' ? window : globalThis);
