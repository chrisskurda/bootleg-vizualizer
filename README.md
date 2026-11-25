# bootleg-vizualizer

The **pack format** for music visualizers, and everything needed to run and test it: the runtime a pack runs in, the audio-feature
contract (spectrum, onsets, song sections, per-stem data, song metadata), look/FX passes (roto, glitch, scanlines/CRT) with
conformance tests, a reference live host, pack-author tools (acceptance checker, perf probe) and a library of packs. MIT licensed.

A **pack** is one animation: a folder with `pack.json` and a page that draws a canvas from `(T, A, P)` — loop time, audio features, params.
That one rule makes the same pack run live (a browser or a Tauri window with real-time audio) and render offline frame-by-frame, identically.

It is designed to be **vendored** ([VENDORING.md](VENDORING.md)) into whatever shows visualizers:

| project | role |
|---|---|
| [bootleg](https://github.com/chrisskurda/bootleg) | the audio player (web + Tauri desktop); hosts packs live |
| [bootleg-bridge-thing](https://github.com/chrisskurda/bootleg-bridge-thing) | a Spotify Car Thing remote for bootleg: controls playback and runs packs on the device |
| stem players, music makers | a stem player page; a music maker with a visualizer lane |

## Start
    npm i                                      # once (needs Chrome and ffmpeg)
    node bin/server.mjs --media ~/Music        # live host: http://localhost:8080/core/live.html  (--port N)
    node bin/check.mjs [--packs a,b] [--fps]   # acceptance check for packs (SPEC §10)
    node bin/measure.mjs [--packs a,b]         # live frame-rate probe
    npm test                                   # FX conformance vs the Rust goldens (CPU + WebGL2) and stem tests

Make a pack: copy `packs/_template`, edit `pack.json` and `draw()`, run `node bin/check.mjs --packs yours`.
**Read SPEC §4a (loops and seams) first** — it is the most common mistake, and the checker tests for it.

## What's here
| path | what |
|---|---|
| [SPEC.md](SPEC.md) | the contract: pack layout, `draw(ctx, T, A, P, K)`, features, stems, params, look/FX, metadata, determinism and loop rules, portable canvas subset, acceptance checklist |
| `core/` | `pack-runtime.js` (what a pack runs in), `fx.js` / `fx-gl.js` (roto, glitch, CRT: CPU reference + WebGL2), `look.js`, `meta.js`, `stems.js`, `audio.js` (live analysis incl. per-stem taps), `feed-offline.js`, `live.html` (reference host) |
| `packs/` | the packs — [catalog](packs/README.md) |
| `bin/` | `server` (live host + media/metadata/stem APIs), `check`, `measure`, and the reference analysis: `analyze` (audio features), `stems` (per-stem features), `meta` (tags/sidecars/cover art) |
| `tests/` | FX reference in Rust (`fx-reference/`) with golden outputs, conformance tests, synthetic stem fixture |

## Features a pack can use
Spectrum (64 log bands) and waveform; bass/mid/high/beat; `A.past(sec)` history; song time, duration, **sections** and **metadata** (title, artist, BPM, key, cover art — from standard tags, with `manifest.json` / `tracklist.txt` sidecars);
**per-stem** level, onsets, spectrum, gain, mute/solo and the sample playing on each stem (`A.stem('kick')`, estimated from the mix when a track has no stems);
a user-supplied image (`K.image()`); loop-safe motion helpers; custom palettes. Look/FX applied by the host: `roto`, `glitch`, `screen` (scanlines / CRT / curved) plus hue, saturation, brightness, blur, …

## Live host
`core/live.html` is the reference host: pick a pack, then a source (file, `--media` library, mic, tab/system audio). **Tweak** edits params and look; *Copy render command* prints the matching offline-render command.
URL params: `?pack=ID&audio=URL&params={json}&look={json}&meta={json}&image=URL&ui=0&hud=0`. Keys: `f` fullscreen, `h` HUD.
Embed it in an iframe and drive it with `postMessage`: `viz-features` (push your own analysis), `viz-meta`, `viz-image`, `viz-pack`.

## Licensing
MIT ([LICENSE](LICENSE)). Packs contain no third-party code, fonts or art (SPEC §7); the FX code comes from RiffBox (same author), which ported it from a racing engine's shaders.
