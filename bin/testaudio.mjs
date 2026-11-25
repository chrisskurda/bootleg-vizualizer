// Synthetic test music (a beaty mix: 55 Hz pulse, pink-noise hats, a 880 Hz tone) so checks and perf probes need no audio files.
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
export function ensureTestMusic(cacheDir) {
  const f = path.join(cacheDir, 'check_music.wav'); fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(f)) { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=55:d=12,tremolo=f=2:d=1', '-f', 'lavfi', '-i', 'anoisesrc=d=12:a=0.15:c=pink,tremolo=f=8:d=0.9', '-f', 'lavfi', '-i', 'sine=f=880:d=12,tremolo=f=0.5:d=0.8,volume=0.25', '-filter_complex', 'amix=inputs=3:normalize=0', f]); if (r.status) throw new Error('ffmpeg is needed to make test audio: ' + r.stderr); }
  return f;
}
