// Native pack runtime. A pack = pack.json + index.html + draw(ctx, T, A, P).
//   definePack({ draw(ctx, T, A, P, K), init?(ctx, K) })
// Size / loop length / params come from the pack's own pack.json (single source of truth).
//   T  seconds into the loop        A  audio features (see SPEC.md)        P  resolved params (pack.json defaults + overrides)
// draw() must depend ONLY on (T, A, P): that is what makes offline renders identical to live and repeatable.
(function () {
  const TAU = Math.PI * 2, BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');
  const PALETTES = {
    aurora: ['#0b1d3a', '#1fa3a0', '#4be0a8', '#8a7bff', '#e5a0ff'],
    sunset: ['#2b0f3a', '#8c1f5e', '#ff4f6d', '#ff9a4d', '#ffe27a'],
    neon:   ['#00e5ff', '#3d7bff', '#9b4dff', '#ff3df0', '#ff7ad9'],
    ember:  ['#2a0a05', '#8a1c0a', '#ff4a12', '#ffa11f', '#fff1b0'],
    ocean:  ['#02142b', '#0a4f8f', '#1fa3d6', '#6fe0f0', '#e8ffff'],
    mono:   ['#3a3f55', '#7b84a6', '#b5bdd8', '#e4e9fb', '#ffffff'],
    candy:  ['#ff6ad5', '#c774e8', '#ad8cff', '#8795e8', '#94d0ff'],
  };
  const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const RGB = {}, rgbOf = name => RGB[name] || (RGB[name] = (PALETTES[name] || []).map(hex));
  const kit = {
    TAU, PALETTES, palettes: Object.keys(PALETTES),
    mix: (a, b, t) => a + (b - a) * t,
    clamp: (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v)),
    // palette lookup, u in 0..1 -> rgb array (cheap; pass alpha via kit.rgba). Built-ins are hex lists; packs add their own with K.addPalette.
    pal(name, u) {
      const p = (rgbOf(name).length ? rgbOf(name) : kit.custom[name] || (Array.isArray(kit.palettes[name]) ? kit.palettes[name] : null)) || rgbOf('aurora');   // kit.palettes[name] = [[r,g,b]..] also works (older packs)
      const x = Math.min(0.9999, Math.max(0, u)) * (p.length - 1), i = Math.floor(x), f = x - i, a = p[i], b = p[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },
    // register a pack-defined palette (call in init): colors = ['#rrggbb', …] or [[r,g,b], …]; list its name in the `palette` param's options
    addPalette(name, colors) { kit.custom[name] = colors.map(c => typeof c === 'string' ? hex(c) : c); if (!kit.palettes.includes(name)) kit.palettes.push(name); },
    custom: {},
    rgba: (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`,
    css: (name, u, a = 1) => kit.rgba(kit.pal(name, u), a),
    rng: seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    // Catmull-Rom through points -> canvas path (call ctx.beginPath() first; continues from pts[0])
    smooth(ctx, pts, moveTo = true) {
      if (moveTo) ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
    },
    fmtTime: s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
    // single-line text, shrunk to fit maxW. opts: {font:'700 40px ...', color, align, alpha, upper}
    text(ctx, str, x, y, { font = '500 28px system-ui, sans-serif', color = '#fff', align = 'left', alpha = 1, maxW = 0, upper = false } = {}) {
      if (str == null || str === '') return; str = String(str); if (upper) str = str.toUpperCase();
      ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.globalAlpha *= alpha; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      if (maxW) { const w = ctx.measureText(str).width; if (w > maxW) { const m = /(\d+)px/.exec(font); ctx.font = font.replace(/\d+px/, Math.max(8, Math.floor(m[1] * maxW / w)) + 'px'); } }
      ctx.fillText(str, x, y); ctx.restore();
    },
    // Scene scheduler for multi-scene packs. Returns {idx, local, len}: which scene (0..count-1), seconds into it, its length.
    //   o = { count, mode:'auto'|'fixed'|'beats'|'sections', beats:16, bpm:112 (fallback), loop, durs:[...] (fixed schedule) }
    //   sections: a scene change at every song section start (long sections are split into ~`beats`-beat chunks)
    //   beats:    a change every `beats` beats at the track's BPM (A.meta.bpm)
    //   fixed:    fixed schedule from loop time T (durs, or loop/count each)
    //   auto:     sections if the track has them, else beats if it has a BPM, else fixed
    scenes(T, A, o) {
      const n = o.count, bpm = (A.meta && A.meta.bpm) || o.bpm || 112, chunk = (o.beats || 16) * 60 / bpm;
      let mode = o.mode || 'auto'; if (mode === 'auto') mode = A.section ? 'sections' : (A.meta && A.meta.bpm) ? 'beats' : 'fixed';
      if (mode === 'sections' && A.section) {
        const sec = A.section, span = Math.max(0.001, sec.end - sec.start), k = Math.max(1, Math.round(span / chunk)), cl = span / k, within = Math.max(0, A.t - sec.start), c = Math.min(k - 1, Math.floor(within / cl));
        return { idx: (sec.index * 3 + c) % n, local: within - c * cl, len: cl };
      }
      if (mode === 'beats') { const c = Math.floor(A.t / chunk); return { idx: c % n, local: A.t - c * chunk, len: chunk }; }
      const durs = o.durs || Array(n).fill(o.loop / n), loop = durs.reduce((a, b) => a + b, 0), t = ((T % loop) + loop) % loop; let acc = 0;
      for (let i = 0; i < n; i++) { if (t < acc + durs[i] || i === n - 1) return { idx: i, local: t - acc, len: durs[i] }; acc += durs[i]; }
    },
    // ---- loop-safe motion (SPEC §4a): anything that moves with T must return to where it started after `loop` seconds.
    //   phase(T, loop, cycles)  0..1 sawtooth that repeats `cycles` (whole number, >=1) times per loop   -> angles, blinks, wraps
    //   drift(T, loop, laps, span)  0..span, advancing exactly `laps` full spans per loop               -> scrolling/falling things that wrap at `span`
    //   tri(T, loop)  0..1..0 over one loop (ping-pong, no jump)                                         -> idle versions of "progress"
    phase: (T, loop, cycles = 1) => (((T / loop) * Math.max(1, Math.round(cycles))) % 1 + 1) % 1,
    drift: (T, loop, laps, span) => (((T / loop) * Math.max(1, Math.round(laps))) % 1 + 1) % 1 * span,
    tri: (T, loop) => { const u = (((T / loop) % 1) + 1) % 1; return 1 - Math.abs(1 - 2 * u); },
    // song progress 0..1 while a track plays; with no track, a seamless ping-pong over the loop (so idle has no seam)
    progress: (A, T, loop) => A.duration ? Math.min(1, Math.max(0, A.t / A.duration)) : kit.tri(T, loop),
    // "stateful" smoothing without state: exponential average of f(spectrum) over the recent past (VU needles, easing).
    //   f(spectrum, k) -> number; weights decay with time constant tau (s) over `taps` samples spaced `step` (s) apart
    ema(A, f, { tau = 0.1, step = 1 / 30, taps = 8 } = {}) { let sum = 0, w = 0; for (let k = 0; k < taps; k++) { const wk = Math.exp(-k * step / tau); sum += wk * f(A.past(k * step), k); w += wk; } return sum / w; },
    // soft drop shadow for a rounded rect with no shadowBlur (portable): layered translucent rounded rects
    softShadow(ctx, x, y, w, h, r, { blur = 40, dy = 0, alpha = 0.5, color = '0,0,0' } = {}) {
      const n = 14; ctx.save();
      for (let i = n; i >= 1; i--) { const g = blur * i / n; ctx.fillStyle = `rgba(${color},${(alpha * 1.6 / n * (1 - (i - 1) / n)).toFixed(4)})`; ctx.beginPath(); ctx.roundRect(x - g, y - g + dy, w + 2 * g, h + 2 * g, r + g); ctx.fill(); }
      ctx.restore();
    },
    peak(A, i, hold = 0.6, fall = 0.7, step = 0.04) { let m = 0; for (let t = 0; t <= hold; t += step) m = Math.max(m, A.past(t)[i] - fall * t); return Math.max(0, m); },
  };
  // cover art: kit.cover(A) -> HTMLImageElement once loaded (else null). Loaded lazily; the offline harness awaits it before frame 0.
  const covers = {};
  const loadCover = u => covers[u] || (() => { const e = covers[u] = { img: new Image(), ok: false }; e.img.onload = () => { e.ok = true; }; e.img.src = u; return e; })();
  kit.cover = A => { const u = A && A.meta && A.meta.cover; if (!u) return null; const e = loadCover(u); return e.ok ? e.img : null; };
  window.__whenCover = () => { const u = window.__META && window.__META.cover; if (!u) return; const e = loadCover(u); return e.ok ? 0 : new Promise(r => { e.img.addEventListener('load', r); e.img.addEventListener('error', r); }); };
  // user image (the host supplies it: drop on the preview, ?image=URL, --image FILE): kit.image() -> HTMLImageElement or null.
  kit.image = () => { const u = window.__IMAGE_URL; if (!u) return null; const e = loadCover(u); return e.ok ? e.img : null; };
  window.__whenImage = () => { const u = window.__IMAGE_URL; if (!u) return; const e = loadCover(u); return e.ok ? 0 : new Promise(r => { e.img.addEventListener('load', r); e.img.addEventListener('error', r); }); };
  window.kit = kit;

  window.definePack = async function (cfg) {
    if (!document.body) await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    const meta = await (await fetch('pack.json')).json();
    const { width, height } = meta, loop = meta.loopSeconds || 60, render = new URLSearchParams(location.search).has('render');
    const defaults = {}; for (const [k, d] of Object.entries(meta.params || {})) defaults[k] = d.default;
    const bg = cfg.bg || defaults.bg || '#000';
    // look/FX passes (roto, glitch, scanlines/CRT) are optional: fx-gl.js sits next to this file
    for (const f of ['fx-gl.js', 'stems.js']) if (BASE && !window[f === 'fx-gl.js' ? 'VisFXGL' : 'VisStems']) await new Promise(r => { const sc = document.createElement('script'); sc.src = BASE + f; sc.onload = sc.onerror = r; document.head.appendChild(sc); });
    const dpr = () => window.devicePixelRatio || 1;
    // Backing store resolution. Render: exactly the output pixels (the render scale), so 4K output is really drawn at 4K.
    // Live: design size x how much it is scaled to fit x devicePixelRatio, between 1x and 2x. Packs always draw in design units.
    let k = 1; const wantK = () => render ? dpr() : Math.max(1, Math.min(2, dpr() * Math.min(innerWidth / width, innerHeight / height)));
    const c = document.createElement('canvas'); c.id = 'stage'; let fxc = null, fxApi = null, fxFailed = false;
    Object.assign(document.documentElement.style, { background: bg, margin: 0, height: '100%' });
    Object.assign(document.body.style, { margin: 0, height: '100%', overflow: 'hidden', background: bg });
    const place = el => Object.assign(el.style, { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', width: width + 'px', height: height + 'px' });
    place(c); document.body.appendChild(c);
    const ctx = c.getContext('2d'); if (cfg.init) cfg.init(ctx, kit);
    if (!render) { // dropping an image on the preview hands it to the host (live player) or uses it directly (standalone page)
      addEventListener('dragover', e => e.preventDefault());
      addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f || !/^image\//.test(f.type)) return;
        if (window.parent !== window) window.parent.postMessage({ type: 'viz-image-file', file: f }, '*'); else window.__IMAGE_URL = URL.createObjectURL(f); });
    }
    const fit = () => { if (render) return; const s = Math.min(innerWidth / width, innerHeight / height), tf = `translate(${(innerWidth - width * s) / 2}px,${(innerHeight - height * s) / 2}px) scale(${s})`; c.style.transform = tf; if (fxc) fxc.style.transform = tf; };
    addEventListener('resize', fit); fit();
    const sizeBacking = () => { k = wantK(); const bw = Math.round(width * k), bh = Math.round(height * k); if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; } };
    const Z = { live: false, bass: 0, mid: 0, high: 0, beat: 0, level: 0, t: 0, duration: 0, meta: {}, section: null, track: null, spectrum: new Float32Array(64), wave: new Float32Array(128), past: () => Z.spectrum };
    window.__seek = t => {
      sizeBacking();
      const P = Object.assign({}, defaults, window.__PARAMS || {});
      // every frame starts from a brand-new context (lineWidth, dash, font, clip, fillStyle… back to defaults), so no frame can depend on the last
      if (ctx.reset) ctx.reset(); else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.shadowBlur = 0; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.font = '10px sans-serif'; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      if (!window.__AUDIO) Z.t = t; // no audio: A.t falls back to elapsed time
      const A = window.__AUDIO || Z; if (!A.stem && window.VisStems) VisStems.attach(A);   // A.stem(nameOrRole) always exists (estimated from the mix when there are no stems)
      cfg.draw(ctx, ((t % loop) + loop) % loop, A, P, kit);
      // Look/FX passes requested by the host (window.__FX = {roto, glitch, screen}): run on the finished picture, shown on a canvas over this one
      const fx = window.__FX, on = !!(fx && window.VisFXGL && !fxFailed && ((fx.roto | 0) > 0 || fx.glitch > 0 || (fx.screen | 0) > 0));
      if (on) {
        try {
          if (!fxc) { fxc = document.createElement('canvas'); fxc.id = 'fxstage'; place(fxc); document.body.appendChild(fxc); fit(); fxApi = VisFXGL.create(fxc); }
          fxApi.apply(c, fx, A.t || 0, c.getBoundingClientRect().height * dpr());
        } catch (e) { fxFailed = true; console.error('FX disabled:', e.message); }
      }
      const showFx = on && !fxFailed; c.style.visibility = showFx ? 'hidden' : 'visible'; if (fxc) fxc.style.display = showFx ? 'block' : 'none';
    };
    document.documentElement.dataset.packReady = '1';
    if (!render) { const t0 = performance.now(); const tick = () => { window.__seek((performance.now() - t0) / 1000); requestAnimationFrame(tick); }; tick(); }
  };
})();
