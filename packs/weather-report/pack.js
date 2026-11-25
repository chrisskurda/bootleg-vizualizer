// Weather Report — native pack (spec v0.3). draw depends only on (T, A, P).
// History comes from A.past(); ambient motion uses integer cycles per LOOP.
(function () {
  const N = 64, W = 1920, H = 1080, LOOP = 90, PI = Math.PI, TAU = PI * 2; // LOOP must equal pack.json loopSeconds
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const DISP = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  // c runs hot -> cold
  const PAL = {
    Broadcast: { paper: '#E8EEF2', ink: '#0E1B2C', c: ['#E63946', '#F4873F', '#F2C230', '#2A9D8F', '#3A86FF'] },
    Radar: { paper: '#E9F0E6', ink: '#0B1410', c: ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#0A84FF'] },
    Almanac: { paper: '#F3ECDD', ink: '#23303B', c: ['#C8553D', '#E09F3E', '#DDB967', '#588B8B', '#4A7C99'] },
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const enter = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const ease = (p) => { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const env = (t, d) => Math.exp(-t / d);
  const gauss = (i, c, w) => Math.exp(-((i - c) * (i - c)) / (2 * w * w));
  const avg = (s, a, b) => { let x = 0; for (let i = a; i < b; i++) x += s[i]; return x / (b - a); };
  const heat = (v) => 4 - Math.min(4, Math.floor(v * 6));

  // Idle demo: a 112 BPM groove as a pure function of time (used only when A.live is false).
  const BEAT = 60 / 112, BASS = [3, 0, 0, 5, 0, 3, 0, 0, 6, 0, 4, 0, 0, 5, 7, 0];
  function demo(time, out) {
    const t = ((time % LOOP) + LOOP) % LOOP, b = t / BEAT, six = (b * 4) % 1, step = Math.floor(b * 4) % 16;
    const kick = env((b % 1) * BEAT, 0.12), snare = env(((b + 1) % 2) * BEAT, 0.16);
    const hat = env(six * BEAT / 4, 0.045) * (0.45 + 0.55 * hash(step));
    const bassOn = BASS[step], bassEnv = bassOn ? env(six * BEAT / 4, 0.11) : 0;
    const mel = 30 + 9 * Math.sin(TAU * 7 * t / LOOP) + 6 * Math.sin(TAU * 23 * t / LOOP + 1);
    const lead = 0.55 + 0.45 * Math.sin(TAU * 41 * t / LOOP), sb = Math.floor(b);
    for (let i = 0; i < N; i++) {
      const wob = 0.5 + 0.5 * Math.sin(TAU * (20 + Math.floor(hash(i) * 60)) * t / LOOP + hash(i + 99) * TAU);
      out[i] = 0.08 + 0.26 * (0.6 - 0.3 * i / 63) * wob + kick * gauss(i, 2, 3.5) * 0.85
        + bassEnv * gauss(i, 3 + bassOn, 2.2) * 0.65 + snare * (gauss(i, 22, 9) * 0.55 + 0.14 * hash(i + sb * 7))
        + hat * gauss(i, 54, 8) * 0.55 + lead * gauss(i, mel, 3) * 0.55;
    }
    return out;
  }

  // Scratch buffers (overwritten every frame; never read across frames).
  const POOL = Array.from({ length: 12 }, () => new Float32Array(N)), TMP = new Float32Array(N);
  let pool = 0;

  let ctx; // set per draw call
  const sector = (cx, cy, r1, r2, a0, a1, color, alpha) => {
    ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = color; ctx.beginPath();
    ctx.arc(cx, cy, r2, a0, a1); ctx.arc(cx, cy, r1, a1, a0, true); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  };
  const line = (x1, y1, x2, y2, color, w, alpha, cap) => {
    ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = cap || 'butt';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
  };
  const rect = (x, y, w, h, r, color, alpha) => {
    ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = color; ctx.beginPath();
    r = Math.min(r, w / 2, h / 2);
    if (r > 0) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.globalAlpha = 1;
  };
  const disc = (x, y, r, color, alpha) => { ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; };
  const ring = (x, y, r, color, w, alpha) => { ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; };
  const txt = (str, x, y, font, color, align, alpha) => {
    ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y); ctx.globalAlpha = 1;
  };
  const smooth = (p, closed) => {
    const n = p.length; ctx.beginPath();
    if (closed) ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2); else ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) { const q = p[(i + 1) % n]; ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + q[0]) / 2, (p[i][1] + q[1]) / 2); }
    if (closed) ctx.closePath(); else ctx.lineTo(p[n - 1][0], p[n - 1][1]);
  };
  const grid = (fg) => {
    for (let k = 0; k <= 4; k++) {
      const y = 950 - k * 160;
      line(140, y, 1780, y, fg, k ? 2 : 4, k ? 0.16 : 0.7);
      txt(Math.round(k * 27.5) + '°', 120, y + 8, '24px ' + MONO, fg, 'right', 0.7);
    }
  };
  const PTS = Array.from({ length: N }, () => [0, 0]), PTS2 = Array.from({ length: N }, () => [0, 0]);

  function outlook({ s, at, fg, C }) {
    grid(fg);
    const taps = [at(0.07), at(0.14), at(0.21), at(0.28)];
    for (let i = 0; i < N; i++) {
      let lo = s[i], hi = s[i];
      for (let j = 0; j < 4; j++) { lo = Math.min(lo, taps[j][i]); hi = Math.max(hi, taps[j][i]); }
      const h = Math.max(18, (hi - lo) * 640);
      rect(144 + i * 25.6, Math.min(950 - hi * 640, 950 - h), 18, h, 9, C[heat(hi)]);
    }
  }
  function radar({ s, local, fg, C }) {
    const cx = 960, cy = 610, sw = local * TAU * 24 / LOOP - PI / 2;
    for (let r = 100; r <= 400; r += 100) ring(cx, cy, r, fg, 2, 0.22);
    line(cx - 400, cy, cx + 400, cy, fg, 2, 0.22); line(cx, cy - 400, cx, cy + 400, fg, 2, 0.22);
    for (let i = 0; i < N; i++) {
      const v = s[i];
      sector(cx, cy, 36, 46 + v * 350, (i + 0.1) * TAU / N - PI / 2, (i + 0.9) * TAU / N - PI / 2, C[v > 0.5 ? 0 : v > 0.3 ? 2 : 3], 0.9);
    }
    sector(cx, cy, 1, 400, sw - 0.6, sw, fg, 0.14);
    line(cx, cy, cx + 400 * Math.cos(sw), cy + 400 * Math.sin(sw), fg, 5, 1, 'round');
    disc(cx, cy, 12, fg);
  }
  function wind({ s, fg, C }) {
    for (let i = 0; i < N; i++) {
      const v = s[i], L = 34 + v * 66, col = C[heat(v)];
      ctx.save(); ctx.translate(180 + (i % 16) * 104, 330 + Math.floor(i / 16) * 190); ctx.rotate((30 - v * 150) * PI / 180);
      line(-L / 2, 0, L / 2 - 8, 0, col, 9, 1, 'round');
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(L / 2 + 10, 0); ctx.lineTo(L / 2 - 14, -15); ctx.lineTo(L / 2 - 14, 15); ctx.closePath(); ctx.fill();
      disc(-L / 2, 0, 7, fg);
      ctx.restore();
    }
  }
  function isobars({ at, fg, C }) {
    const cx = 960, cy = 615;
    for (let k = 1; k <= 7; k++) {
      const a = at(k * 0.045), base = 48 + k * 46, bold = k % 3 === 0;
      for (let i = 0; i < N; i++) { const r = base + (a[i] - 0.25) * k * 15, ang = i / N * TAU - PI / 2; PTS[i][0] = cx + r * Math.cos(ang); PTS[i][1] = cy + r * Math.sin(ang); }
      smooth(PTS, true);
      ctx.globalAlpha = bold ? 1 : 0.6; ctx.strokeStyle = bold ? C[4] : fg; ctx.lineWidth = bold ? 6 : 3; ctx.stroke(); ctx.globalAlpha = 1;
    }
    txt('L', cx, cy + 34, '800 100px ' + DISP, C[0], 'center');
  }
  function rain({ s, local, fg, C }) {
    rect(130, 236, 1660, 26, 13, fg);
    ctx.lineCap = 'round'; ctx.lineWidth = 10; ctx.setLineDash([24, 20]);
    for (let i = 0; i < N; i++) {
      const v = s[i], x = 153 + i * 25.6;
      ctx.strokeStyle = C[v > 0.45 ? 4 : 3]; ctx.lineDashOffset = -((local * 352 + i * 17) % 44); // 352 px/s = 720 dash cycles per loop
      ctx.beginPath(); ctx.moveTo(x, 286); ctx.lineTo(x, 286 + v * 650); ctx.stroke();
      ctx.fillStyle = C[4]; ctx.beginPath(); ctx.ellipse(x, 952, 3 + v * 12, 5, 0, 0, TAU); ctx.fill();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    line(140, 960, 1780, 960, fg, 4);
  }
  function heatMap({ s, fg, C, ink }) {
    let hi = 0, lo = 1;
    for (let i = 0; i < N; i++) { hi = Math.max(hi, s[i]); lo = Math.min(lo, s[i]); }
    txt('HIGH', 144, 330, '28px ' + MONO, fg, 'left', 0.75); txt(Math.round(hi * 110) + '°', 136, 540, '800 220px ' + DISP, C[0]);
    txt('LOW', 144, 680, '28px ' + MONO, fg, 'left', 0.75); txt(Math.round(lo * 110) + '°', 136, 890, '800 220px ' + DISP, C[4]);
    for (let i = 0; i < N; i++) {
      const x = 1010 + (i % 8) * 90, y = 262 + Math.floor(i / 8) * 90;
      rect(x, y, 82, 82, 8, C[heat(s[i])]);
      txt(String(Math.round(s[i] * 110)), x + 41, y + 50, '500 24px ' + MONO, ink, 'center');
    }
  }
  function sunrise({ s, fg, C }) {
    const cx = 960, cy = 950;
    for (let i = 0; i < N; i++) {
      const a = PI + (i + 0.5) / N * PI, c = Math.cos(a), sn = Math.sin(a), r2 = 215 + s[i] * 500;
      line(cx + 190 * c, cy + 190 * sn, cx + r2 * c, cy + r2 * sn, C[Math.min(2, heat(s[i]))], 13, 1, 'round');
    }
    sector(cx, cy, 1, 150 + avg(s, 0, 8) * 30, PI, TAU, C[2]);
    line(140, cy, 1780, cy, fg, 4);
    txt('SUNRISE · 35 Hz', 150, 996, '24px ' + MONO, fg, 'left', 0.75);
    txt('16 kHz · SUNSET', 1770, 996, '24px ' + MONO, fg, 'right', 0.75);
  }
  function fronts({ s, at, C }) {
    const w = at(0.2);
    for (let i = 0; i < N; i++) { const x = 153 + i * 25.6; PTS[i][0] = x; PTS[i][1] = 610 - s[i] * 340; PTS2[i][0] = x; PTS2[i][1] = 950 - w[N - 1 - i] * 300; }
    ctx.lineCap = 'round'; ctx.lineWidth = 8; ctx.setLineDash([]);
    smooth(PTS); ctx.strokeStyle = C[4]; ctx.stroke();
    ctx.fillStyle = C[4];
    for (let i = 2; i < N; i += 4) { const p = PTS[i]; ctx.beginPath(); ctx.moveTo(p[0] - 24, p[1]); ctx.lineTo(p[0], p[1] - 40); ctx.lineTo(p[0] + 24, p[1]); ctx.closePath(); ctx.fill(); }
    smooth(PTS2); ctx.strokeStyle = C[0]; ctx.stroke();
    for (let i = 0; i < N; i += 4) sector(PTS2[i][0], PTS2[i][1], 1, 24, PI, TAU, C[0]);
  }
  const DEPTS = ['SUB', 'BASS', 'LOW MID', 'MID', 'HI MID', 'PRESENCE', 'BRILLIANCE', 'AIR'];
  function thermo({ s, fg, bg, C }) {
    for (let g = 0; g < 8; g++) {
      const x = 230 + g * 203, a = clamp(avg(s, g * 8, g * 8 + 8) * 1.7, 0, 1), c = C[heat(a * 0.85)];
      for (let j = 0; j < 8; j++) rect(x + 36, 800 - j * 68, 10 + s[g * 8 + j] * 64, 10, 5, fg, 0.8);
      rect(x - 26, 268, 52, 604, 26, fg); disc(x, 872, 56, fg);
      rect(x - 22, 272, 44, 596, 22, bg); disc(x, 872, 52, bg);
      disc(x, 872, 40, c); rect(x - 11, 850 - a * 540, 22, a * 540 + 10, 11, c);
      txt(DEPTS[g], x + 10, 986, '24px ' + MONO, fg, 'center', 0.8);
    }
  }
  function hurricane({ s, local, fg, C }) {
    const cx = 960, cy = 620;
    for (let i = 0; i < N; i++) {
      const k = Math.floor(i / 4), a = (i % 4) * TAU / 4 + k * 0.25 - local * TAU * 8 / LOOP, r = 62 + k * 21, v = s[i];
      disc(cx + r * Math.cos(a), cy + r * Math.sin(a), 5 + v * 27 + k * 0.5, v < 0.17 ? fg : C[heat(v)]);
    }
    ring(cx, cy, 34, fg, 6);
  }

  const SCENES = [
    ['Outlook', '64-Band Outlook', outlook, 0], ['Radar', 'Doppler Low End', radar, 1], ['Wind', 'Prevailing Grooves', wind, 0],
    ['Isobars', 'Low Pressure System', isobars, 1], ['Rain', 'Chance of Hi-Hats', rain, 0], ['HeatMap', 'Heat Index by Band', heatMap, 1],
    ['Sunrise', 'Daylight Hours', sunrise, 0], ['Fronts', 'Cold Front Advancing', fronts, 1], ['Thermometers', 'Eight-Octave Forecast', thermo, 0],
    ['Hurricane', 'Category 5 Groove', hurricane, 1],
  ];

  function draw(c, T, A, P, K) {
    ctx = c; pool = 0;
    const k0 = c.canvas.width / W;
    c.setTransform(k0, 0, 0, k0, 0, 0);
    const th = PAL[P.palette] || PAL.Broadcast, C = th.c, gain = P.gain == null ? 1 : P.gain;
    const pl0 = K.scenes(T, A, { count: SCENES.length, mode: P.cycle, beats: P.sceneBeats, loop: LOOP, only: K.sceneIndices(P.scenes, SCENES.map((d) => d[0]), P.scene) });
    const locked = pl0.held, pl = locked ? { idx: pl0.idx, local: T, len: LOOP / SCENES.length } : pl0;   // one scene chosen: hold it
    const idx = pl.idx, local = pl.local, len = pl.len;
    const def = SCENES[idx], fg = def[3] ? th.paper : th.ink, bg = def[3] ? th.ink : th.paper;
    const at = (dt) => {
      const out = POOL[pool++ % POOL.length];
      const src = A.live ? (dt > 0 ? A.past(dt) : A.spectrum) : (P.demo === false ? null : demo(A.t - dt, TMP));
      for (let i = 0; i < N; i++) out[i] = src ? clamp(src[i] * gain, 0, 1) * (locked ? 1 : enter((local - dt - 0.2 - i * 0.006) / 0.45)) : 0;
      return out;
    };
    const s = at(0);

    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const zoom = 1 + 0.0225 * (1 - Math.cos(TAU * local / len));
    c.save(); c.translate(960, 600); c.scale(zoom, zoom); c.translate(-960, -600);
    def[2]({ s, at, T, local, fg, bg, C, ink: th.ink });
    c.restore();

    if (P.labels !== false) {
      const tIn = locked ? 1 : enter((local - 0.15) / 0.5), dy = (1 - tIn) * 28, m = A.meta || {};
      txt('FORECAST ' + String(idx + 1).padStart(2, '0') + '/10' + (A.section ? '  ·  ' + A.section.name.toUpperCase() : ''), 96, 84 + dy, '26px ' + MONO, fg, 'left', 0.75 * tIn);
      txt(def[1].toUpperCase(), 94, 160 + dy, '800 68px ' + DISP, fg, 'left', tIn);
      txt('CURRENT TEMP', 1824, 84 + dy, '26px ' + MONO, fg, 'right', 0.75 * tIn);
      txt(Math.round(avg(s, 0, N) * 110) + '°', 1826, 160 + dy, '800 68px ' + DISP, C[idx % 2 ? 2 : 0], 'right', tIn);
      if (m.title) {
        K.text(c, (m.artist ? m.artist + ' — ' : '') + m.title, 96, 1044 + dy, { font: '24px ' + MONO, color: fg, alpha: 0.7 * tIn, maxW: 900, upper: true });
        K.text(c, K.fmtTime(A.t) + (A.duration ? ' / ' + K.fmtTime(A.duration) : '') + (m.bpm ? '  ·  ' + Math.round(m.bpm) + ' BPM' : '') + (m.key ? '  ·  ' + String(m.key).toUpperCase() : ''), 1824, 1044 + dy, { font: '24px ' + MONO, color: fg, align: 'right', alpha: 0.7 * tIn });
      } else K.text(c, '64 BANDS · 35 Hz – 16 kHz', 1824, 1044 + dy, { font: '24px ' + MONO, color: fg, align: 'right', alpha: 0.7 * tIn, upper: true });
    }

    if (!locked) { // colour-slab wipes at the start and end of every scene (incl. the loop seam)
      const slab = (dt, k, win, color) => {
        const p = dt / win; if (p <= -1 || p >= 1) return;
        const a = p < 0 ? 0 : ease(p), b = p < 0 ? ease(1 + p) : 1; c.fillStyle = color;
        if (k % 2 === 0) c.fillRect(a * W, 0, (b - a) * W + 1, H); else c.fillRect(0, a * H, W, (b - a) * H + 1);
      };
      for (const [k, dt] of [[idx, local], [idx + 1, local - len]]) { const j = k % SCENES.length; slab(dt, k, 0.42, C[(j + 2) % 5]); slab(dt, k, 0.28, C[(j % 2) * 4]); }
    }
  }

  definePack({ draw: draw, bg: PAL.Broadcast.ink });
})();
