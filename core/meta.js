// Time-aware metadata lookup, shared by live host and offline harness (so packs see identical A.section / A.track).
window.metaAt = function (meta, t) {
  const out = { section: null, track: null };
  if (!meta) return out;
  const S = meta.sections || [];
  for (let i = 0; i < S.length; i++) if (t >= S[i].start && (t < S[i].end || i === S.length - 1)) {
    out.section = { name: S[i].name, index: i, count: S.length, start: S[i].start, end: S[i].end, progress: Math.max(0, Math.min(1, (t - S[i].start) / Math.max(0.001, S[i].end - S[i].start))) }; break; }
  const T = meta.tracks || [];
  for (let i = T.length - 1; i >= 0; i--) if (t >= T[i].start) { out.track = { ...T[i], index: i, count: T.length, end: T[i + 1] ? T[i + 1].start : meta.duration, progress: T[i + 1] ? Math.max(0, Math.min(1, (t - T[i].start) / (T[i + 1].start - T[i].start))) : 0 }; break; }
  return out;
};
