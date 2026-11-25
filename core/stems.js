// Stems for packs (SPEC §2c). One shape everywhere: A.stems = [stem], A.stem(nameOrRole) -> stem (never undefined).
//   stem = { name, role, level 0..1, beat 0..1 (onset pulse), spectrum Float32Array(16), gainDb, gain (linear), muted, audible,
//            label, kit, clip: {label, kit, kind, start, end, progress} | null, estimated }
// Sources, in order of preference: precomputed analysis of a render's stems/ folder (bin/stems.mjs; offline + reference host),
// live per-stem taps (core/audio.js addStem; the player), else an ESTIMATE from the mix (role-shaped bands), flagged estimated:true.
// Roles: kick snare hats perc drums bass keys lead pad sample vocals fx other.
(function (root) {
  const ROLE = { kick: 'kick', bd: 'kick', snare: 'snare', sd: 'snare', clap: 'snare', hats: 'hats', hat: 'hats', hh: 'hats', perc: 'perc', percussion: 'perc', drums: 'drums', drum: 'drums',
    sub: 'bass', bass: 'bass', '808': 'bass', keys: 'keys', piano: 'keys', rhodes: 'keys', lead: 'lead', arp: 'lead', pad: 'pad', strings: 'pad', colour: 'pad', color: 'pad', sample: 'sample',
    vocals: 'vocals', vox: 'vocals', crash: 'fx', fx: 'fx', riser: 'fx' };
  const roleOf = name => ROLE[String(name).toLowerCase().replace(/[^a-z0-9]/g, '')] || 'other';   // stem file name -> role (SPEC §2c)
  const NB = 16, dec = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ZERO = new Float32Array(NB), clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  // decode the analysis once (bin/stems.mjs JSON) -> a handle for at()
  function prepare(data) { if (!data) return null; return { fps: data.fps, frames: data.frames, nb: data.nb || NB, stems: data.stems.map(s => ({ ...s, _level: dec(s.level), _beat: dec(s.beat), _spec: dec(s.spec) })) }; }
  const clipAt = (clips, t) => { for (const c of clips || []) if (t >= c.start && t < c.end) return { label: c.label, kit: c.kit, kind: c.kind, start: c.start, end: c.end, progress: clamp01((t - c.start) / Math.max(1e-6, c.end - c.start)) }; return null; };
  // the stems at song time t. state = { [name]: {muted, solo, gainDb} } from a player's faders (optional)
  function at(P, t, state) {
    if (!P) return [];
    const fi = Math.max(0, Math.min(P.frames - 1, Math.round(t * P.fps))), anySolo = state && Object.values(state).some(s => s && s.solo);
    return P.stems.map(s => {
      const sp = new Float32Array(P.nb); for (let b = 0; b < P.nb; b++) sp[b] = s._spec[fi * P.nb + b] / 255;
      const st = (state && state[s.name]) || {}, clip = clipAt(s.clips, t), gainDb = st.gainDb ?? s.gainDb ?? 0;
      return { name: s.name, role: s.role, level: s._level[fi] / 255, beat: s._beat[fi] / 255, spectrum: sp, gainDb, gain: Math.pow(10, gainDb / 20), muted: !!st.muted, audible: !st.muted && (!anySolo || !!st.solo),
        label: clip ? clip.label : '', kit: clip ? clip.kit : null, clip, estimated: false };
    });
  }
  // a plausible stem for `role`, from the mix's own bands (so stem-aware packs still work on any track)
  function estimate(A, role) {
    const sp = new Float32Array(NB); if (A.spectrum) for (let b = 0; b < NB; b++) sp[b] = (A.spectrum[b * 4] + A.spectrum[b * 4 + 1] + A.spectrum[b * 4 + 2] + A.spectrum[b * 4 + 3]) / 4;
    const by = { kick: [A.bass, A.beat], snare: [A.mid * 0.8, A.beat * 0.6], hats: [A.high, 0], bass: [A.bass, 0], perc: [A.high * 0.8, A.beat * 0.5], drums: [A.level, A.beat], keys: [A.mid, 0], lead: [A.mid, 0], pad: [A.mid * 0.7, 0], sample: [A.mid, 0], vocals: [A.mid, 0] };
    const [level, beat] = by[role] || [A.level, 0];
    return { name: role, role, level: clamp01(level || 0), beat: clamp01(beat || 0), spectrum: sp, gainDb: 0, gain: 1, muted: false, audible: true, label: '', kit: null, clip: null, estimated: true };
  }
  // give a frame's A the accessor. list = real stems for this frame (possibly empty)
  function attach(A, list) {
    A.stems = list || A.stems || [];
    const cache = {};
    A.stem = key => {
      key = String(key).toLowerCase(); if (cache[key]) return cache[key];
      const s = A.stems.find(x => x.name.toLowerCase() === key) || A.stems.find(x => x.role === key);
      return (cache[key] = s || estimate(A, key));
    };
    return A;
  }
  // A render's clips.json -> { stemName: [{start, end, kind, label, kit, file}] } (loops are placed in bars of 4 beats, hits in seconds). Same as bin/stems.mjs.
  const cleanName = f => String(f || '').split('/').pop().replace(/\.(wav|flac|mp3|aif+|ogg|caf)$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  function clipsFromDoc(doc, bpm) {
    const barS = 4 * 60 / ((doc && doc.bpm) || bpm || 120), out = {};
    for (const c of (doc && doc.clips) || []) {
      const start = c.kind === 'hit' ? c.start_s : c.start_bar * barS, end = c.kind === 'hit' ? c.start_s + (c.length_s || 0.5) : (c.start_bar + c.bars) * barS;
      (out[c.stem] ||= []).push({ start: +start.toFixed(3), end: +end.toFixed(3), kind: c.kind, label: cleanName(c.file), kit: c.kit ?? null, file: c.file ?? null });
    }
    for (const k in out) out[k].sort((a, b) => a.start - b.start);
    return out;
  }
  // fill label / kit / clip on live stems (core/audio.js taps) from that timeline, at song time t
  function applyClips(list, clips, t) {
    for (const s of list) { const c = clipAt(clips && clips[s.name], t); s.clip = c; s.label = c ? c.label : s.label || ''; s.kit = c ? c.kit : null; }
    return list;
  }
  root.VisStems = { prepare, at, attach, estimate, clipsFromDoc, applyClips, roleOf, NB };
})(typeof window !== 'undefined' ? window : globalThis);
