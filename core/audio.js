// Live audio -> {bass,mid,high,beat,level} (0..1). Same bands as offline analyze.mjs, with adaptive gain.
export class AudioFeed {
  constructor() {
    this.ctx = null; this.analyser = null; this.f = { bass: 0, mid: 0, high: 0, beat: 0, level: 0 };
    this.agc = { bass: [0, 1], mid: [0, 1], high: [0, 1] }; this.prevBass = 0; this.fluxAvg = 0; this.lastBeat = 0; this.src = null;
    this.taps = []; this.stemState = {}; this.stemHi = -30; this.stemSpHi = 1;   // live per-stem taps (addStem) and the player's faders
    this.external = null; // set when a host app pushes features via postMessage
  }
  _init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.5;
    this.buf = new Float32Array(this.analyser.frequencyBinCount);
    this.an2 = this.ctx.createAnalyser(); this.an2.fftSize = 4096; this.an2.smoothingTimeConstant = 0.3; // finer low end for the spectrum
    this.buf2 = new Float32Array(this.an2.frequencyBinCount); this.tbuf = new Float32Array(this.an2.fftSize);
    const sr = this.ctx.sampleRate; this.edges = Array.from({ length: 65 }, (_, i) => 35 * Math.pow(16000 / 35, i / 64));
    this.sp = new Float32Array(64); this.spLo = new Float32Array(64); this.spHi = new Float32Array(64).fill(1); this.wv = new Float32Array(128); this.wPk = 0.05;
    this.ring = Array.from({ length: 720 }, () => ({ t: -1, s: new Float32Array(64) })); this.ri = 0; this.zero = new Float32Array(64);
  }
  _swap(node, toSpeakers) {
    this._init(); if (this.src) try { this.src.disconnect(); } catch {}
    this.src = node; node.connect(this.analyser); node.connect(this.an2); if (toSpeakers) node.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  fromElement(el) { this._init(); if (!el._mes) el._mes = this.ctx.createMediaElementSource(el); this._swap(el._mes, true); }
  async fromMic() {
    this._init();
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this._swap(this.ctx.createMediaStreamSource(s), false);
  }
  async fromTab() { // Chrome: share a tab/screen and tick "share audio" — works for any player incl. system audio
    this._init();
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!s.getAudioTracks().length) { s.getTracks().forEach(t => t.stop()); throw new Error('No audio shared — tick "Share tab audio"'); }
    s.getVideoTracks().forEach(t => t.stop());
    this._swap(this.ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())), false);
  }
  _spectrum(k, out) { // 64 log bands + 128-sample waveform + history ring for A.past(seconds)
    const n = 4096, sr = this.ctx.sampleRate, bw = sr / n, pw = b => 10 ** (this.buf2[b] / 10);
    this.an2.getFloatFrequencyData(this.buf2); this.an2.getFloatTimeDomainData(this.tbuf);
    const raw = new Float32Array(64); let gHi = 0;
    for (let i = 0; i < 64; i++) {
      const lo = this.edges[i] / bw, hi = this.edges[i + 1] / bw; let e;
      if (hi - lo < 1) { const m = (lo + hi) / 2, b0 = Math.floor(m), fr = m - b0; e = pw(b0) * (1 - fr) + pw(b0 + 1) * fr; }
      else { let sum = 0, c = 0; for (let b = Math.ceil(lo); b <= Math.floor(hi); b++) { sum += pw(b); c++; } e = c ? sum / c : pw(Math.round(lo)); }
      raw[i] = Math.log1p(Math.sqrt(e) * 200);
    }
    for (let i = 0; i < 64; i++) { this.spHi[i] = Math.max(raw[i], this.spHi[i] - (this.spHi[i] - this.spLo[i]) * 0.002 * k); this.spLo[i] = Math.min(raw[i], this.spLo[i] + (this.spHi[i] - this.spLo[i]) * 0.004 * k); gHi = Math.max(gHi, this.spHi[i]); }
    for (let i = 0; i < 64; i++) { const top = Math.max(this.spHi[i], 0.5 * gHi), nn = Math.min(1, Math.max(0, (raw[i] - this.spLo[i]) / (top - this.spLo[i] + 1e-6)));
      const c = 1 - Math.pow(1 - (nn > this.sp[i] ? 0.7 : 0.22), k); this.sp[i] = Math.min(1, Math.max(0, this.sp[i] + (nn - this.sp[i]) * c)); }
    const t = this.tbuf, base = t.length - 1024; let pk = 0;
    for (let j = 0; j < 128; j++) { let m = 0; for (let q = 0; q < 8; q++) m += t[base + j * 8 + q]; this.wv[j] = m / 8; pk = Math.max(pk, Math.abs(this.wv[j])); }
    this.wPk = Math.max(pk, this.wPk * Math.pow(0.995, k), 0.02);
    const wave = Float32Array.from(this.wv, v => Math.max(-1, Math.min(1, v / this.wPk)));
    const now = performance.now() / 1000, slot = this.ring[this.ri = (this.ri + 1) % this.ring.length]; slot.t = now; slot.s.set(this.sp);
    const ring = this.ring, zero = this.zero;
    out.live = true; out.spectrum = Float32Array.from(this.sp); out.wave = wave;
    const memo = new Map(); // packs often ask for the same offsets many times per frame
    out.past = sec => { const key = Math.round(sec * 1000); let v = memo.get(key); if (v) return v; const want = now - sec; let best = null, bd = 1e9; for (const r of ring) { if (r.t < 0) continue; const d = Math.abs(r.t - want); if (d < bd) { bd = d; best = r; } } v = best && bd < 0.2 ? best.s : zero; memo.set(key, v); return v; };
  }
  // Live per-stem analysis (SPEC §2c). node = the AudioNode carrying ONE stem (tap it before/after its fader, as you prefer).
  //   feed.addStem('kick', node, { role: 'kick', label: 'Kick loop 12', gainDb: -0.4 });   feed.stemState.kick = { muted, solo, gainDb }
  addStem(name, node, { role = 'other', label = '', gainDb = 0 } = {}) {
    this._init(); const an = this.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.3; node.connect(an);
    this.taps.push({ name, role, label, gainDb, an, td: new Float32Array(2048), fd: new Float32Array(1024), lv: 0, bt: 0, last: -1e9, prevDb: -120, sp: new Float32Array(16) });
  }
  clearStems() { for (const t of this.taps) try { t.an.disconnect(); } catch {} this.taps = []; this.stemState = {}; }
  _stems(k, now) {
    const NB = 16, sr = this.ctx.sampleRate, edges = this.stemEdges || (this.stemEdges = Array.from({ length: NB + 1 }, (_, i) => 35 * Math.pow(16000 / 35, i / NB)));
    const rows = this.taps.map(t => { t.an.getFloatTimeDomainData(t.td); t.an.getFloatFrequencyData(t.fd); let e = 0; for (let i = 0; i < t.td.length; i++) e += t.td[i] * t.td[i];
      const raw = new Float32Array(NB), bw = sr / t.an.fftSize;
      for (let b = 0; b < NB; b++) { const lo = Math.max(1, Math.round(edges[b] / bw)), hi = Math.max(lo + 1, Math.round(edges[b + 1] / bw)); let s = 0; for (let q = lo; q < hi; q++) s += Math.pow(10, t.fd[q] / 10); raw[b] = Math.log1p(Math.sqrt(s / (hi - lo)) * 200); }
      return { t, raw, db: 10 * Math.log10(e / t.td.length + 1e-12) }; });
    this.stemHi = Math.max(Math.max(...rows.map(r => r.db)), this.stemHi - 0.4 * k);                 // shared level scale: ~12 dB/s fall
    let spMax = 0; for (const r of rows) for (const v of r.raw) spMax = Math.max(spMax, v); this.stemSpHi = Math.max(spMax, this.stemSpHi * Math.pow(0.998, k));
    const lo = this.stemHi - 48, spLo = this.stemSpHi * 0.25, anySolo = Object.values(this.stemState).some(s => s && s.solo), list = [];
    for (const { t, raw, db } of rows) {
      const nrm = Math.min(1, Math.max(0, (db - lo) / 48)); t.lv += (nrm - t.lv) * (1 - Math.pow(1 - (nrm > t.lv ? 0.6 : 0.15), k));
      const flux = db - t.prevDb; t.prevDb = db; t.bt *= Math.pow(0.82, k); if (flux >= 3 && nrm > 0.2 && now - t.last > 100) { t.bt = 1; t.last = now; }
      for (let b = 0; b < NB; b++) { const v = Math.min(1, Math.max(0, (raw[b] - spLo) / (this.stemSpHi - spLo + 1e-6))); t.sp[b] += (v - t.sp[b]) * (1 - Math.pow(1 - (v > t.sp[b] ? 0.7 : 0.22), k)); }
      const st = this.stemState[t.name] || {}, gainDb = st.gainDb ?? t.gainDb;
      list.push({ name: t.name, role: t.role, level: t.lv, beat: t.bt, spectrum: Float32Array.from(t.sp), gainDb, gain: Math.pow(10, gainDb / 20), muted: !!st.muted, audible: !st.muted && (!anySolo || !!st.solo), label: t.label, kit: null, clip: null, estimated: false });
    }
    return list;
  }
  update(dt) { // dt seconds since last call; call once per animation frame
    if (this.external) return (this.f = this.external);
    if (!this.analyser) return this.f;
    this.analyser.getFloatFrequencyData(this.buf); // dB
    const sr = this.ctx.sampleRate, n = this.analyser.fftSize, bin = hz => Math.round(hz * n / sr);
    const band = (lo, hi) => { let e = 0; for (let b = bin(lo); b < bin(hi); b++) e += 10 ** (this.buf[b] / 10); return Math.log1p(Math.sqrt(e / (bin(hi) - bin(lo))) * 200); };
    const raw = { bass: band(30, 150), mid: band(150, 2000), high: band(2000, 12000) };
    const k = Math.min(1, Math.max(0, dt * 60)), out = {};
    const AR = { bass: [.7, .12], mid: [.5, .08], high: [.6, .15] };
    for (const key in raw) {
      const a = this.agc[key], x = raw[key];
      a[1] = Math.max(x, a[1] - (a[1] - a[0]) * 0.002 * k);       // peak follower, slow decay
      a[0] = Math.min(x, a[0] + (a[1] - a[0]) * 0.004 * k);        // floor follower, slow rise
      const nrm = Math.min(1, Math.max(0, (x - a[0]) / (a[1] - a[0] + 1e-6)));
      const [att, rel] = AR[key], c = 1 - Math.pow(1 - (nrm > this.f[key] ? att : rel), k);
      out[key] = Math.min(1, Math.max(0, this.f[key] + (nrm - this.f[key]) * c));
    }
    const flux = Math.max(0, raw.bass - this.prevBass); this.prevBass = raw.bass;
    this.fluxAvg += (flux - this.fluxAvg) * 0.05 * k;
    const now = performance.now(); let beat = this.f.beat * Math.pow(0.82, k);
    if (flux > this.fluxAvg * 2.2 + 0.02 && now - this.lastBeat > 140) { beat = 1; this.lastBeat = now; }
    out.beat = beat; out.level = (out.bass + out.mid + out.high) / 3;
    this._spectrum(k, out);
    if (this.taps.length && window.VisStems) VisStems.attach(out, this._stems(k, performance.now()));   // A.stems from live taps
    return (this.f = out);
  }
}
