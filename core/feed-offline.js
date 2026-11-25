// Render-mode feed: loads the analysis JSON once, then __setFrame(i) builds window.__AUDIO exactly like the live feed does.
window.__loadFeatures = function (F, meta, stemsData) {
  window.__META = meta || {};
  const SP = window.VisStems && stemsData ? VisStems.prepare(stemsData) : null;   // per-stem analysis of the render's stems/ (optional)
  const dec = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const spec = dec(F.spec), wave = dec(F.wave), NB = F.nb, NW = F.nw, zero = new Float32Array(NB);
  const sAt = i => { const o = Math.max(0, Math.min(F.frames - 1, i)) * NB, a = new Float32Array(NB); for (let k = 0; k < NB; k++) a[k] = spec[o + k] / 255; return a; };
  window.__setFrame = function (fi) {
    const A = { bass: F.bass[fi] ?? 0, mid: F.mid[fi] ?? 0, high: F.high[fi] ?? 0, beat: F.beat[fi] ?? 0 };
    A.live = true; A.level = (A.bass + A.mid + A.high) / 3; A.spectrum = sAt(fi);
    A.wave = new Float32Array(NW); for (let j = 0; j < NW; j++) A.wave[j] = (wave[fi * NW + j] / 255 - 0.5) * 2;
    A.past = sec => fi - Math.round(sec * F.fps) < 0 ? zero : sAt(fi - Math.round(sec * F.fps));
    A.t = fi / F.fps; A.duration = (meta && meta.duration) || F.frames / F.fps; A.meta = meta || {};
    Object.assign(A, window.metaAt ? window.metaAt(meta, A.t) : {});
    if (window.VisStems) VisStems.attach(A, SP ? VisStems.at(SP, A.t) : []);
    window.__AUDIO = A;
  };
};
