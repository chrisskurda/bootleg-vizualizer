// Song metadata resolver -> one normalized object, used by the offline renderer and the live server.
//
// Priority per field:  explicit overrides  >  embedded tags (ID3 / Vorbis / MP4, via ffprobe)  >  sidecar JSON  >  filename
// Structure that tags can't carry (sections, setlist tracks) comes from sidecars:
//   <name>.meta.json or manifest.json (bootleg stem format: name,bpm,key_label,seconds,sections[{name,start_s,end_s}])
//   tracklist.txt   ("00:03:02  name  (style, 146 BPM, D# minor)")
//
//   { title, artist, albumArtist, album, year, genre, track, trackTotal, disc, composer, label, copyright, isrc,
//     comment, lyrics, mood, bpm, key, duration, cover, sections:[{name,start,end}], tracks:[{start,title,bpm,key,style}] }
//   cover = URL path of extracted artwork (served from /cache/covers/) when the file has embedded art.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = v => { if (v === undefined || v === null || v === '') return undefined; const n = parseFloat(String(v)); return isNaN(n) ? undefined : n; };
const first = (...v) => v.find(x => x !== undefined && x !== null && x !== '' && !(typeof x === 'number' && isNaN(x)));
// "3/12" -> [3, 12]
const ofTotal = v => { const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(String(v ?? '')); return m ? [+m[1], m[2] ? +m[2] : undefined] : [undefined, undefined]; };

export function readMeta(file, overrides = {}) {
  const dir = path.dirname(file), base = path.basename(file, path.extname(file));

  // ---- embedded tags: merge format-level and stream-level tags (Ogg keeps them on the stream), lowercase keys
  const t = {}; let duration, coverStream = false;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:format_tags:stream_tags:stream=codec_type:stream_disposition=attached_pic', '-of', 'json', file], { maxBuffer: 64 << 20 });
  if (r.status === 0) {
    try {
      const j = JSON.parse(r.stdout);
      duration = num(j.format?.duration);
      for (const src of [...(j.streams || []).filter(s => s.codec_type === 'audio').map(s => s.tags || {}), j.format?.tags || {}])
        for (const [k, v] of Object.entries(src)) if (v !== '' && t[k.toLowerCase()] === undefined) t[k.toLowerCase()] = String(v);
      coverStream = (j.streams || []).some(s => s.codec_type === 'video' && s.disposition?.attached_pic);
    } catch { /* unreadable tags -> fall through to sidecar/filename */ }
  }
  const tag = (...names) => first(...names.map(n => t[n]));
  const [trk, trkTotal] = ofTotal(tag('track', 'tracknumber'));
  const [disc] = ofTotal(tag('disc', 'discnumber'));
  const tags = {
    title: tag('title'), artist: tag('artist', 'performer'), albumArtist: tag('album_artist', 'albumartist'), album: tag('album'),
    year: (tag('date', 'year', 'originaldate', 'originalyear', 'tyer', 'tdrc') || '').slice(0, 4), genre: tag('genre'),
    track: trk, trackTotal: first(num(tag('tracktotal', 'totaltracks')), trkTotal), disc,
    composer: tag('composer'), label: tag('label', 'publisher', 'organization'), copyright: tag('copyright'), isrc: tag('isrc'),
    comment: tag('comment', 'description'), lyrics: tag('lyrics', 'unsyncedlyrics', 'uslt', 'lyrics-eng'), mood: tag('mood'),
    bpm: num(tag('bpm', 'tbpm', 'tempo')), key: tag('initialkey', 'initial_key', 'key', 'tkey'),
  };

  // ---- sidecar JSON (stem-set manifest / <name>.meta.json)
  let side = {}, sections = [];
  for (const sc of [path.join(dir, base + '.meta.json'), path.join(dir, 'manifest.json')]) {
    if (!fs.existsSync(sc)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(sc, 'utf8'));
      side = { title: j.title || j.name, artist: j.artist, album: j.album, genre: j.genre, bpm: num(j.bpm), key: j.key_label || j.key, duration: num(j.seconds ?? j.duration), year: j.year };
      if (Array.isArray(j.sections)) sections = j.sections.map(s => ({ name: s.name, start: s.start_s ?? s.start, end: s.end_s ?? s.end }));
      break;
    } catch { /* ignore malformed sidecar */ }
  }

  // ---- setlist tracklist.txt
  const tracks = []; const tl = path.join(dir, 'tracklist.txt');
  if (fs.existsSync(tl)) for (const line of fs.readFileSync(tl, 'utf8').split('\n')) {
    const g = /^(\d+):(\d\d):(\d\d)\s+(\S+)(?:\s+\(([^,)]*)(?:,\s*(\d+)\s*BPM)?(?:,\s*([^)]*))?\))?/.exec(line);
    if (g) tracks.push({ start: +g[1] * 3600 + +g[2] * 60 + +g[3], title: g[4], style: g[5] || '', bpm: num(g[6]), key: (g[7] || '').trim() });
  }

  // ---- embedded cover art -> cache/covers/<hash>.jpg (once)
  let cover;
  if (coverStream) {
    try {
      const st = fs.statSync(file), h = crypto.createHash('md5').update(`${path.resolve(file)}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 16);
      const out = path.join(root, 'cache', 'covers', h + '.jpg');
      if (!fs.existsSync(out)) { fs.mkdirSync(path.dirname(out), { recursive: true }); spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-an', '-map', '0:v:0', '-frames:v', '1', out]); }
      if (fs.existsSync(out)) cover = `/cache/covers/${h}.jpg`;
    } catch { /* no cover */ }
  }

  const fileTitle = /^(mix|master|final|track)$/i.test(base) ? path.basename(dir) : base;
  const m = {
    title: first(tags.title, side.title, fileTitle), artist: first(tags.artist, side.artist, ''), albumArtist: first(tags.albumArtist, ''),
    album: first(tags.album, side.album, ''), year: first(tags.year, side.year && String(side.year), ''), genre: first(tags.genre, side.genre, ''),
    track: tags.track, trackTotal: tags.trackTotal, disc: tags.disc, composer: first(tags.composer, ''), label: first(tags.label, ''),
    copyright: first(tags.copyright, ''), isrc: first(tags.isrc, ''), comment: first(tags.comment, ''), lyrics: first(tags.lyrics, ''), mood: first(tags.mood, ''),
    bpm: first(tags.bpm, side.bpm), key: first(tags.key, side.key, ''), duration: first(duration, side.duration),
    cover, sections, tracks,
  };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && v !== '') m[k] = ['bpm', 'duration', 'track', 'trackTotal', 'disc'].includes(k) ? num(v) : v;
  return m;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) console.log(JSON.stringify(readMeta(path.resolve(process.argv[2])), null, 1));
