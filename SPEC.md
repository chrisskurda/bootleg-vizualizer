# Reactive Animation Pack Spec — v0.9 (draft)

*v0.9: scene subsets — the `multi` param type (a checklist) and `K.scenes({only})`: cycle a chosen subset of scenes, or hold one (§2a, §3). v0.8: every frame starts from a fresh default 2D context (§2, §4 rule 6); pack-defined palettes via `K.addPalette` (§3). v0.7: stems (§2c): `A.stems`, `A.stem(nameOrRole)`, per-stem level/onsets/spectrum/clip text, estimates when there are no stems. v0.6: pixel passes `roto`/`glitch`/`screen` with a Rust reference, goldens and a portable hash (§5a); hi-res backing store (§2: draw in design units). v0.5: loop-safe motion helpers and rules (§4a: `K.phase/drift/tri/progress/ema`); `K.softShadow`; user image (`K.image`); portable canvas subset (§9). v0.4: `K.scenes()` music-synced scene scheduler (§2a); multi-scene convention (§3).*

A **pack** is one self-contained animation that runs identically in two places:
**live** (`core/live.html`, real-time audio) and **offline** (`bin/render.mjs`, frame-by-frame to MP4).
Everything below exists to keep those two outputs the same picture.

## 1. Layout

```
packs/<id>/
  pack.json     manifest (required)
  index.html    entry page (name set by "page", default index.html)
  …             any assets, relative paths only
```

### pack.json
| field | meaning |
|---|---|
| `name`, `description` | shown in the UI / `--list` |
| `page` | entry HTML file, default `index.html` |
| `type` | `"native"` (the only type: canvas drawing through `core/pack-runtime.js`) |
| `width`, `height` | design resolution in px (the host scales to fit; render uses it × `--scale`) |
| `loopSeconds` | length of the pack's own motion loop (seamless; see §4) |
| `params` | user-tweakable controls, see §3 |
| `usesStems` | optional, `true` when the pack draws per-stem visuals (`A.stem()` / `A.stems`). A player may then load a track's real stems for it (decoding stems costs memory, so players load them on demand); without the flag the pack gets estimates from the mix, which is always enough to draw |

## 2. Runtime contract (native packs)

```html
<script src="/core/pack-runtime.js"></script>
<script> definePack({ draw(ctx, T, A, P, K) { … } }) </script>
```

`definePack({ draw, init?(ctx, K), bg? })` — `draw` is required; `init` runs once before the first frame; `bg` is the page color behind the canvas (defaults to the `bg` param). Size, loop length and params come from `pack.json`.

**Draw in design units** (`width` × `height` from `pack.json`) and never read `canvas.width/height`: the host scales the canvas backing store — to the output pixels when rendering (a 2× render is really drawn at 2×, not upscaled), to design size × fit × `devicePixelRatio` (1–2×) live.

`draw` is called once per frame with a **brand-new default 2D context** — the host calls `ctx.reset()` first, so `lineWidth`, `lineCap`, dashes, `font`, `fillStyle`, clip and the rest are back to canvas defaults and the transform is the host's scale. Set what you need inside `draw`; never rely on state a previous frame left behind (it is gone, and a native host will not have it either). Paint the **whole** canvas every call.

### T — loop time
Seconds into the pack's loop, `0 ≤ T < loopSeconds`. Drive ambient motion from `T` only.

### A — audio features (all values 0..1 unless noted)
| name | type | meaning |
|---|---|---|
| `A.bass` `A.mid` `A.high` | number | smoothed band energy: 30–150 Hz / 150 Hz–2 kHz / 2–12 kHz |
| `A.beat` | number | 1.0 on a bass onset, decays ~0.82×/frame. Use for flashes, expanding rings |
| `A.level` | number | mean of the three bands |
| `A.spectrum` | `Float32Array(64)` | log-spaced bands 35 Hz → 16 kHz, auto-gain, fast attack / medium release |
| `A.wave` | `Float32Array(128)` | recent waveform, −1..1, normalized to its recent peak |
| `A.live` | boolean | true when real audio features are present (false = idle/no audio; a pack may show a demo) |
| `A.t` `A.duration` | seconds | playback position and track length (no audio: `A.t` = elapsed seconds since start) |
| `A.meta` | object | song metadata, see §6 |
| `A.section` | object\|null | `{name,index,count,start,end,progress}` current song section (when the track has section data) |
| `A.track` | object\|null | `{title,bpm,key,style,start,end,index,count,progress}` current track inside a setlist/mix |
| `A.stems` `A.stem(x)` | list · function | per-stem features and text; `A.stem(nameOrRole)` always returns a stem (estimated from the mix if absent) — see §2c |
| `A.past(sec)` | `→ Float32Array(64)` | the spectrum `sec` seconds ago (at least 5 s of history live, any length offline; before the start of the track it returns zeros). **The only sanctioned way to get history** (trails, waterfalls, peak-hold) |

With no audio (`A.live` false) the numbers are 0, `spectrum`/`wave` are zero-filled arrays and `past()` returns zeros — they are never undefined, and packs must still render something sensible (idle state).

### 2a. Multi-scene packs and music-synced scene changes
Packs with several scenes (Business Funk, Weather Report) should not hard-code a schedule. `K.scenes(T, A, opts)` returns `{idx, local, len}` — which scene (0…count−1), seconds into it, and its length:

```js
const { idx, local, len, held } = K.scenes(T, A, { count: 10, mode: P.cycle, beats: P.sceneBeats, loop: 90, only: K.sceneIndices(P.scenes, NAMES) /*, durs:[…], bpm: 112 */ });
```
| `mode` | scene changes |
|---|---|
| `sections` | at every song section start (`A.section`); a long section is split into chunks of ≈`beats` beats so it doesn't sit on one scene |
| `beats` | every `beats` beats at the track's BPM (`A.meta.bpm`, else `opts.bpm`) |
| `fixed` | on a fixed schedule from loop time `T` (`durs` per scene, or `loop/count` each) — the idle/no-audio behavior |
| `auto` | `sections` if the track has sections, else `beats` if it has a BPM, else `fixed` |

**Choosing scenes.** Multi-scene packs let the user pick which scenes play: `only` is a list of scene indices (ascending), and `K.sceneIndices(P.scenes, NAMES)` makes it from the pack's `scenes` param.
Several chosen → the scheduler cycles through just those (in `fixed` mode their durations are stretched to exactly fill `loop`, so the loop seam stays seamless; in `beats` / `sections` mode they simply take turns).
**One chosen → the scene is *held*: `held` is `true`, `local` is loop time, and the pack should skip cuts and wipes** (a pack may also skip the scene's entrance animation). Nothing or everything chosen → all scenes.

Section *i* starts at scene `3·i` (so consecutive sections are visually distinct), advancing one scene per chunk. It is deterministic: it depends only on `A.t`, `A.meta` and `A.section`. Draw cut transitions (wipes) from `local` (just after a cut) **and** `local − len` (just before the next one) so the animation stays continuous.

### 2b. User image
A pack may layer its animation over an image **the user supplies**: `K.image()` returns an `HTMLImageElement` (loaded) or `null`; draw a fallback when it is `null`.
The host provides it — drop an image on the live preview, the **Image…** button, `?image=URL`, `postMessage {type:'viz-image', url}`, or `--image FILE` when rendering.
The pack ships no art (§7); the image is the user's. Cover art from tags is separate: `K.cover(A)`.

### 2c. Stems — per-stem visuals and text
When a track comes with stems — a **bootleg stem set** (`stems/<name>.flac`, gains in `manifest.json`, placements in `clips.json` — the format is documented in the bootleg player repo, `docs/STEM-FORMAT.md`) or a stem player's live audio nodes —
packs get one more feature set. `A.stems` is the list; **`A.stem(nameOrRole)` always returns a stem** (never `undefined`):

| field | meaning |
|---|---|
| `name`, `role` | the stem's file name (`kick`, `sub`, `colour`…) and its role |
| `level` | 0..1, smoothed loudness on a **scale shared by all stems** (a quiet hat stem stays quieter than the kick) |
| `beat` | 0..1 onset pulse for this stem alone (1 on a hit, decays ~0.82×/frame) |
| `spectrum` | `Float32Array(16)`, log bands 35 Hz–16 kHz, shared scale |
| `gainDb`, `gain` | its mix gain (from `manifest.json`, or the player's fader) |
| `muted`, `audible` | the player's mute/solo state; `audible` is false for muted stems and for everything but the soloed one |
| `label`, `kit`, `clip` | **text**: the loop/hit playing on this stem right now — cleaned sample name, its kit, and `clip = {label, kit, kind, start, end, progress}` (`null` between clips) |
| `estimated` | `true` when this stem is not real (see below) |

**Roles:** `kick snare hats perc drums bass keys lead pad sample vocals fx other`. Stem names map to roles (`sub`/`808`→`bass`, `colour`/`strings`→`pad`, `crash`/`riser`→`fx`, `clap`→`snare`, …); unknown names are `other`.
`A.stem('kick')` finds a stem by exact name first, then by role.

**Always something to draw.** With no stems (a plain mp3), or when a role is absent, `A.stem(role)` is an **estimate** shaped from the mix — kick ≈ bass band + beat, hats ≈ highs, keys/lead/pad/sample ≈ mids, snare ≈ mids + beat — with `estimated: true`.
A stem-aware pack must look right on estimates (design for them; show a note like "estimated from the mix" if it matters), so it works on every track and gets better when real stems exist.

**Per-stem visuals** are a pack's choice: give each role its own glyph (`packs/stem-rack`: kick rings, snare bursts, hat sparkles, bass wave, key spectrum, perc dots), route stems to different layers
(kick → flash, hats → sparkle, pad → colour), or draw one lane per stem. **Per-stem text:** name, role, gain, and the sample playing on it. Make text a param — sample/kit names can carry licence credits.

**Where the data comes from**
| host | how |
|---|---|
| offline render | `--stems auto` (default: a `stems/` folder next to the audio file) \| `off` \| `DIR`. `bin/stems.mjs DIR` does the analysis (cached) |
| reference live host | library files with a `stems/` folder: the server analyses and caches it (`GET /api/stems?url=`); the page indexes it by playback time |
| a stem player (live) | `feed.fromNode(masterBus)` analyses the player's own output; `feed.addStem(name, node, {role, label, gainDb})` taps each stem's own audio node; `feed.stemState[name] = {muted, solo, gainDb}` reflects its faders (`core/audio.js`). For the sample text: `VisStems.clipsFromDoc(clipsJson)` builds the timeline from a render's `clips.json`, and `VisStems.applyClips(A.stems, clips, A.t)` fills `label` / `kit` / `clip` on the live stems each frame |

Timing: loops in `clips.json` are placed in bars (4 beats at the render's BPM), hits in seconds; `A.stem(x).clip` is resolved from song time `A.t`.

### P — params
Resolved values: `pack.json` defaults overridden by the user (live panel / `--param`). Always read params from `P`, never hard-code colors or sizes that a user might want to change.

### K — kit (helpers; optional)
`K.palettes` / `K.pal(name,u)` / `K.css(name,u,alpha)` palette lookup (`u` 0..1) · `K.mix` `K.clamp` · `K.rng(seed)` seeded random ·
`K.scenes(T, A, opts)` scene scheduler, `K.sceneIndices(sel, names)` (§2a) · loop-safe motion `K.phase` `K.drift` `K.tri` `K.progress` (§4a) · `K.ema(A, f)` smoothing from history · `K.softShadow(ctx, x, y, w, h, r, {blur,dy,alpha})` portable drop shadow · `K.image()` user image or null (§2b) · `K.addPalette(name, colors)` pack-defined palette · `K.smooth(ctx, pts)` Catmull-Rom path · `K.text(ctx, str, x, y, {font,color,align,alpha,maxW,upper})` shrink-to-fit text · `K.fmtTime(sec)` · `K.cover(A)` cover-art image or null · `K.peak(A, i, hold, fall)` peak-hold from history · `K.TAU`.
Built-in palettes: aurora, sunset, neon, ember, ocean, mono, candy.

## 3. Params (what the live panel and `--param` expose)

```json
"params": {
  "palette": { "type": "select", "label": "Palette", "options": ["aurora","sunset"], "default": "neon" },
  "bg":      { "type": "color",  "label": "Background", "default": "#070a18" },
  "round":   { "type": "number", "label": "Roundness", "default": 1, "min": 0, "max": 1, "step": 0.05 },
  "peaks":   { "type": "bool",   "label": "Peak caps", "default": true }
}
```
Types: `number` (slider), `color` (#rrggbb), `select`, `bool`, `multi` (a checklist: `options` are the choices, `default` and the value are arrays of chosen option names — usually all of them). The UI is generated from this — no pack UI code.
Multi-scene packs also declare `cycle` (select: `auto`/`fixed`/`beats`/`sections`), `sceneBeats` (number, default 16) and **`scenes`** (`multi`, default all scene names: pick a subset to cycle just those, pick one to hold it, empty = all (UIs: with everything selected a click solos that scene, then clicks add or remove); the older single-choice `scene` param is still honoured, `K.sceneIndices(P.scenes, NAMES, P.scene)`).
**Custom palettes:** a pack that wants its own theme registers it in `init` with `K.addPalette('vapor', ['#2a1b6b', '#b967ff', '#ff71ce', '#01cdfe', '#fffb96'])` (hex strings or `[r,g,b]`) and lists the name in the `palette` param's `options`; `K.pal` / `K.css` then resolve it like a built-in. (`K.palettes.name = [[r,g,b],…]` also works, for older packs.) An unknown palette name silently falls back to `aurora`.
Convention: packs declare `palette` and `bg` so a theme can be swapped uniformly. Palette names are pack-defined (the kit's seven, or a pack's own like Business Funk's Report/Boardroom/Shag); omit `bg` if the pack's background comes from its palette.

**Presets are the URL.** Live `?pack=ID&params={…}&look={…}` is identical to CLI `--pack ID --param k=v … --look '{…}'`; the panel's *Copy render command* button prints the CLI form of whatever you dialed in.

## 4. The determinism rules (what makes renders repeatable)

1. `draw` may depend **only** on `(T, A, P, K)` — `A` includes `A.t`, `A.meta`, `A.section`, so music-synced behavior is fine. No `Math.random()`, `Date.now()`, `performance.now()`, no variables mutated between frames.
2. Randomness → `K.rng(seed)` at module load, producing fixed data (star positions, dot phases).
3. State that looks like it needs memory (trails, peak hold, decay) → derive from `A.past()`.
4. Loops: use **integer** numbers of cycles per `loopSeconds` so frame `loop` equals frame 0.
5. No network at runtime; assets relative to the pack folder. Preload in `init` if needed.
6. Canvas state is not memory either: each frame starts from a fresh default context (§2). A frame that only looks right because an earlier frame left `lineWidth`/`lineCap`/a dash set is a §4 violation.
Violating 1–3 still looks fine live but renders differently each run or differs from live.

## 4a. Loops and seams — read this before writing any motion

Every pack loops: `T` runs `0 … loopSeconds` and wraps to 0, live and in renders, while the music carries on. Anything driven by `T`
that is **not back where it started** at the wrap *pops* once per loop (a leaf jumps, a needle snaps, a counter resets mid-motion).
It is the most common defect in packs and is invisible in a still frame, so the rules below are mechanical.

**Two kinds of time**
| | `T` (loop time) | `A.t`, `A.duration`, `A.section`, `A.meta` (song time) |
|---|---|---|
| runs | 0 → `loopSeconds`, then wraps | with the song; never wraps; no audio → elapsed seconds |
| use for | ambient motion: rotation, drift, twinkle, sway, idle states | things *about the song*: counters, progress, scene scheduling, text, lyrics |
| seam rule | must be periodic over `loopSeconds` (recipe below) | no seam by itself — but needs a periodic **idle fallback** (`A.live` false) |

Driving ambient motion from `A.t` is allowed (playback has no seam) but then the pack can't be exported as a seamless standalone loop; prefer `T`.

**Recipe**
1. **Oscillations, spins, blinks** — a whole number of cycles per loop: `K.phase(T, loop, n)` (0..1, repeats `n`×) or `Math.sin(TAU * n * T / loop)`.
   A fractional `n` pops. Want a ~3 s period in a 20 s loop? use `n = 7` (2.86 s), or choose `loopSeconds` as a common multiple of the periods you care about.
2. **Anything that scrolls, falls or drifts and wraps** — travel per loop = a *whole number of laps of the wrap span*: `K.drift(T, loop, laps, span)`
   returns 0…`span`, advancing exactly `laps` spans per loop. `span` = screen size + the object's margin; speed = `laps × span / loop` px/s, so for a slower
   drift lengthen `loopSeconds`, don't use a fractional lap. Per-object speeds: vary `laps` (1, 2, 3), not the distance.
3. **Song progress** (tape reels, progress bars) — `K.progress(A, T, loop)`: `A.t / A.duration` while a track plays, else a ping-pong over the loop (`K.tri`).
   **Counters / clocks** — `const clock = A.live ? A.t : T`.
4. **Smoothing and decay** (VU needles, easing, peak hold) — no carried variables: `K.ema(A, f)` / `K.peak(A, …)` read the recent past via `A.past()`.
5. **Randomness** — seed once at load (`K.rng`); never per frame.
6. **Scenes** — `K.scenes()` (§2a) already loops in `fixed` mode; draw wipes from `local` and `local − len`.

**Common mistakes**
| wrong | why it pops | right |
|---|---|---|
| `x = (T/loop * W) % (W + 300)` | travels `W` per loop but wraps at `W + 300` | `K.drift(T, loop, 1, W + 300)` |
| `x = (T/loop * W * (1 + z)) % span` (z fractional) | fractional laps | `K.drift(T, loop, z > .5 ? 2 : 1, span)` |
| `Math.sin(T * 0.7)` | 0.7 rad/s is not a whole cycle per loop | `Math.sin(TAU * 3 * T / loop)` |
| `prog = (T % 20) / 20` for a tape/progress idle state | sawtooth resets to 0 | `K.progress(A, T, 20)` |
| `needle += (target - needle) * .3` | state carried between frames (also fails §4) | `K.ema(A, s => level(s))` |

The checker's *loop seam* test (idle, no audio) compares the frame just before the wrap with frame 0 against ordinary frame-to-frame change and warns when the jump is far larger.
A warning means "won't loop seamlessly as a clip"; it is a real pop in playback only for `T`-driven motion.

## 5. Look layer (host-level color grading, works on every pack)

Applied by the host as a CSS filter, so packs don't implement it. One function (`core/look.js`) drives both live and render.

| key | range | effect |
|---|---|---|
| `roto` `glitch` `screen` | see §5a | pixel passes: flat tones + ink, torn rows / RGB split, scanlines / CRT |
| `hue` | −180..180 ° | hue rotation |
| `sat` `bright` `contrast` | 1 = neutral | |
| `blur` | px | |
| `invert` `sepia` `gray` | 0..1 | |
| `hueDrift` | °/sec | continuous hue cycling over time |
| `hueBeat` | ° | hue kick scaled by `A.beat` |
| `brightBass` | +bright | brightness added per unit `A.bass` |
| `satMid` | +sat | saturation added per unit `A.mid` |

Hue/saturation/etc. are applied as a CSS filter on the page; the pixel passes run in the pack runtime (§5a). Pack-level color (`palette`, `bg`, per-pack colors) is *authored* color; Look is *grading* on top. Prefer exposing a pack param when the color choice is part of the design; use Look for global mood/filters and audio-linked color motion.

### 5a. Pixel passes (FX): roto, glitch, screen
Three passes that need the finished picture, so the **pack runtime** applies them (WebGL2, `core/fx-gl.js`) after `draw`, driven by the Look keys above:

| key | values | effect |
|---|---|---|
| `roto` | 0 off · 1 roto · 2 heavy | flat tones, inked edges: each pixel takes the mean of the least-varying quarter of its neighbourhood (Kuwahara), light is cut into 6 (4 heavy) bands with hue kept, edges are inked |
| `glitch` | 0..1 | bursts (≈11 decisions/s, chance ∝ `glitch`) tear rows sideways, split RGB, and pixelate blocks |
| `screen` | 0 off · 1 scanlines · 2 CRT · 3 curved CRT | 224-line beam averaged over the shown pixel (so lines fade evenly), soft focus + aperture grille + darker corners (2, 3), barrel distortion with rounded corners (3) |

Order is fixed: **look pass (roto + glitch), then screen pass**. Time for the glitch bursts is `A.t` (song time, so bursts don't repeat each loop); the screen pass needs the shown height in pixels. All three are resolution-independent (they work in normalized coordinates and scale with height), so a 4K render gets the same look as 1080p.

**These passes are defined by a reference implementation plus goldens, not by prose.** `tests/fx-reference/` (Rust, no dependencies; the code is RiffBox's, which ported it from the racing engine's shaders) renders a fixed test image through 21 parameter sets into `tests/golden/fx/`. Every implementation must reproduce them:
`tests/fx.test.mjs` (the JS reference `core/fx.js`) and `tests/fx-gl.test.mjs` (WebGL2 `core/fx-gl.js`); a native host adds its own test against the same goldens. Tolerance: the noise hash is **bit-exact**; pixels may differ by float rounding (typically ≤ 1–2 levels, none for glitch).

**Portable noise (normative).** Glitch randomness uses an integer hash, identical bit-for-bit in every language (the original `sin()`-based shader hash differs between platforms' `sinf` and was replaced for this reason):
```
hash(x, y):  xi = int32(floor(x*256)),  yi = int32(floor(y*256))          // inputs are float32; 1/256 quantisation
             h  = (uint32(xi) * 0x9E3779B1) XOR (uint32(yi) * 0x85EBCA6B)  // all multiplies wrap mod 2^32
             h ^= h >> 15;  h *= 0x2C1B3C6D;  h ^= h >> 12;  h *= 0x297A2D39;  h ^= h >> 15
             return float32(h >> 8) / 16777216                            // 24-bit fraction in [0, 1)
```
`tests/golden/fx/hash.json` holds 518 `[x, y, h>>8]` vectors to check a new implementation.

## 6. Song metadata (text, structure, artwork)

`A.meta` is resolved once per track — identically live and offline — with this priority **per field**:
explicit override (`--meta k=v`, `?meta={…}`, `postMessage {type:'viz-meta', meta}`) › **embedded standard tags** › sidecar JSON › filename.

| field | from tags (ID3 / Vorbis comments / MP4) |
|---|---|
| `title` `artist` `albumArtist` `album` `year` `genre` | TITLE ARTIST ALBUMARTIST ALBUM DATE/YEAR GENRE |
| `track` `trackTotal` `disc` | TRACKNUMBER (`3/12` ok), TRACKTOTAL, DISCNUMBER |
| `composer` `label` `copyright` `isrc` `comment` `mood` | COMPOSER LABEL/PUBLISHER COPYRIGHT ISRC COMMENT MOOD |
| `lyrics` | LYRICS / UNSYNCEDLYRICS / USLT (plain text) |
| `bpm` `key` | BPM/TBPM, INITIALKEY/TKEY |
| `duration` | container |
| `cover` | embedded picture, extracted to `cache/covers/` → URL; draw with `K.cover(A)` |

Structure that tags can't carry comes from sidecars next to the audio file: `manifest.json` / `<name>.meta.json`
(`name, bpm, key_label, seconds, sections:[{name,start_s,end_s}]`) → `A.meta.sections`/`A.section`, and `tracklist.txt`
(`00:03:02  name  (style, 146 BPM, D# minor)`) → `A.meta.tracks`/`A.track`. Tags win for descriptive fields; sidecars fill gaps and supply structure.
Text-only metadata is deterministic like everything else: `draw` may read `A.meta`, `A.section`, `A.t` freely.
Live sources: library files and picked files are parsed server-side (ffprobe); tab/mic have no tags, so a host app should push `viz-meta`.
Not yet: synced (LRC) lyrics, multiple cover images, per-section BPM/key.

## 7. Dependencies & licensing rule

A pack ships **only original code and art**: no third-party engines, libraries, fonts, images or audio inside `packs/` or `core/`.
- Fonts: use generic system stacks (`system-ui`, `ui-monospace`) — nothing is bundled or downloaded at runtime. Exact typography
  across machines then depends on the installed system fonts; if you need pixel-identical text, bundle a font whose license you hold.
- Art: draw it procedurally (canvas). No raster paintings or stock assets.
- Tooling only (not shipped): Node, `playwright-core` (Apache-2.0), Chrome, ffmpeg/ffprobe.
- No network access at runtime (no CDN scripts, no web fonts).

## 8. Audio analysis and host interfaces

Live: Web Audio `AnalyserNode` (2048 for bands/beat, 4096 for the spectrum) with adaptive gain.
Offline: same bands via FFT over the whole track, normalized with percentiles (cached per file in `cache/`).
They are tuned to look alike, not bit-identical: live adapts as it listens, offline knows the whole song.
Live sources: file, library (`--media`), mic/line-in, tab/system audio, or features pushed by a host app (spectrum/wave are not accepted over `postMessage` yet; a pushed-only feed is `A.live` false with zero spectrum).

| interface | surface |
|---|---|
| offline renderer CLI `render` | `--pack a,b` `--audio f` `--image f` `--stems auto\|off\|DIR` `--scale` `--fps` `--start/--end` `--crf` `--out` `--param k=v` (repeat) `--look '{json}'` `--meta k=v` (repeat) `--list` |
| CLI `bin/analyze.mjs`, `bin/meta.mjs`, `bin/measure.mjs`, `bin/check.mjs` | analysis JSON · print resolved metadata · live fps probe · pack acceptance check |
| Live URL (`core/live.html`) | `?pack=ID` `&audio=URL` `&params={json}` `&look={json}` `&meta={json}` `&image=URL` `&ui=0` `&hud=0` (drop an image on the preview, or the Image… button) |
| `postMessage` into live | `{type:'viz-features', bass,mid,high,beat,level}` · `{type:'viz-meta', meta:{…}}` · `{type:'viz-image', url}` · `{type:'viz-pack', id}` |
| HTTP (`bin/server.mjs`, localhost only) | `GET /api/packs` · `GET /api/media` · `GET /api/meta?url=/media/…` · `GET /api/stems?url=/media/…` · `POST /api/meta?name=x.flac` (raw bytes) |

Offline limits: `--meta` and tag/sidecar resolution need `--audio` (no audio → no metadata).

## 9. Performance budget

Target 60 fps at 1920×1080 on a laptop (all current native packs hold the display's 120 Hz).
Guidelines: avoid per-frame `shadowBlur` and large `filter` on `ctx`; prefer gradients + `globalCompositeOperation='lighter'` for glow;
keep path/point counts in the low thousands; allocate outside `draw` when you can. Check with `node bin/measure.mjs`.

**Portable canvas subset.** Packs should stay inside the Canvas2D features that every host can implement (a future native/headless host rasterizes them without a browser):
paths (`beginPath closePath moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect roundRect`), `fill stroke clip`, `save restore translate rotate scale setTransform`,
`fillRect`, linear and radial gradients, `fillStyle strokeStyle lineWidth lineCap lineJoin setLineDash lineDashOffset globalAlpha`, `globalCompositeOperation` = `source-over` or `lighter`,
`fillText` (+ `font textAlign textBaseline`, generic font stacks), `drawImage` (for `K.image()` / `K.cover()`).
Avoid: `shadowBlur`/`shadowColor` (use `K.softShadow`), `ctx.filter`, `createPattern`, `createConicGradient` (build it from wedges), pixel access (`getImageData`), other composite modes. The checker warns on each.

## 10. Acceptance checklist for a new pack

**Automated: `node bin/check.mjs [--packs id,id] [--fps]`** runs the machine-checkable items below (manifest, forbidden APIs/assets, system fonts, portable canvas subset, idle/audio/silence/long+empty metadata, statelessness, every param option, user image, loop seam, multi-scene params, and live fps with `--fps`) and exits non-zero on failure. Warnings (missing `bg`, many literal colors, named fonts, a visible loop seam) don't fail the run. The manual items — does it look right, are cuts musical — remain yours.
- [ ] `pack.json` valid, `palette` + `bg` params present, sensible defaults
- [ ] Renders with no audio (idle) and with a loud and a quiet track
- [ ] `node bin/render.mjs --pack ID --audio x --end 3` twice → identical frames
- [ ] Loop point seamless (frame at `loopSeconds` == frame 0)
- [ ] `node bin/measure.mjs --packs ID` ≥ 60 fps
- [ ] Looks right under `--look '{"hue":90}'` (no hard-coded colors outside palette/params)
- [ ] Renders sensibly with empty metadata (`A.meta` = `{}`, `A.section` = null) and with long titles (`K.text` maxW)
- [ ] Multi-scene packs use `K.scenes()` and expose `cycle`, `sceneBeats` and a `scenes` multi param (§2a); verify scene changes land on section boundaries with a sidecar manifest
- [ ] Stem-aware packs read `A.stem(role)` and look right on estimates (§2c); stem text is optional (param)
- [ ] Loop motion follows §4a (checker: *loop seam*); song-driven elements have a periodic idle fallback
- [ ] Stays inside the portable canvas subset (§9); uses `K.image()` only with a fallback when it is `null`
- [ ] No third-party code, fonts, images or audio inside the pack (§7)

## 11. Open questions / next
- Stereo (L/R) features and a true stereo scope.
- Detecting sections from audio alone (today sections come from sidecar data only).
- Synced lyrics (LRC) and a `A.lyric` current-line feature.
- WebGL/shader packs (`type: "gl"`) with the same `(T, A, P)` uniforms.
- Per-pack presets bundled in `pack.json` and a preset gallery.
- Spectrum over `postMessage` for host-app integrations.
