# Changelog

All notable changes to bootleg-vizualizer are documented here. The pack format and its API are versioned together (see `SPEC.md`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While we are `0.x`, breaking changes bump the minor version.

## [Unreleased]

## [0.10.0] - 2026-11-27

### Added
- Cover-art kit (SPEC §2d): `K.coverArt(A)` returns the track cover (else the user image) analysed once in the runtime — `avg`, `lum`, 5 dominant `colors`, `px(n)` pixels of the centre square — or `null`; `K.coverDraw` draws a sub-rect of the centre square; `K.coverBlur` draws a blurred backdrop without `filter`/`shadowBlur`. `K.cover(A)` is unchanged.
- Seven cover-art packs built on it: `cv_ambient` (Cover Ambient), `cv_gallery` (Cover Gallery), `cv_glitch` (Cover Glitch), `cv_mirror` (Cover Mirror), `cv_mosaic` (Cover Mosaic), `cv_shards` (Cover Shards), `cv_strips` (Cover Strips). With no art they show a "No cover" card.
- Ten OS-theme packs: `os_amiga`, `os_apple2`, `os_beos`, `os_dos`, `os_hacker` (Hackerman), `os_mac` (Mono Mac), `os_matrix`, `os_metro`, `os_palm`, `os_temple`. Their colours come from the theme (theme/tint params), not `palette`/`bg`.
- `hotdog` pack (Hot Dog Stand): Windows 3.1 red-and-yellow scheme with spectrum meters, falling peak caps and a scope.
- `bin/screenshots.mjs --image FILE`: art for cover-art packs.
- `jazz` pack (Jazz Cup): 90s paper-cup pattern with a spectrum-driven brush swoosh, squiggles and confetti; optional cup silhouette. The cup is masked by repainting the background outside it, so it also renders correctly on hosts whose canvas has no `clip()` (bootleg-pod).
- `bin/screenshots.mjs`: stills of packs from a synthetic audio signal (no audio file needed), with an optional contact sheet. A gallery of 12 packs in the README.

### Changed
- `stem-rack`: tall lanes stack name / role · gain · kit / sample label without overlapping; the kit name moves onto the role line.
- Docs list bootleg-bridge-thing (a Car Thing remote that runs packs) among the consumers.

## [0.9.4] - 2026-11-25
### Changed
- The stems layout is now named the **bootleg stem format** (documented in the bootleg player repo); docs, tool comments and the test fixture say so. No behaviour change.

## [0.9.3] - 2026-11-25
### Added
- `pack.json` `usesStems`: a pack that draws per-stem visuals says so, so players can load a track's real stems for it on demand. Packs without the flag get estimates from the mix. Set on `stem-rack`.

## [0.9.2] - 2026-11-25
### Added
- `feed.fromNode(node)` — analyse any node of a player's own audio graph — and `VisStems.clipsFromDoc` / `applyClips` / `roleOf`, for players that own their audio graph (live per-stem taps via `feed.addStem`).
### Changed
- Packs load the runtime with relative paths (`../../core/…`) so they work from any host path; `bin/check.mjs` fails a pack that does not.
- The stem-role table lives in the browser file (`core/stems.js`) and the Node tool reads it from there.

## [0.9.0] - 2026-11-25
Initial release: the pack format, runtime, FX and 41 packs.
### Added
- Pack format and runtime (`definePack`, loop-safe kit helpers, fresh canvas state per frame, design-unit drawing), the audio-feature contract (spectrum, onsets, sections, song metadata, `A.past`), and stems (`A.stems`, `A.stem()`, estimates when there are none).
- Look/FX passes (roto, glitch, screen) with a CPU reference, a WebGL implementation and a Rust reference with 21 golden images.
- Multi-scene packs can play a chosen subset of scenes (`multi` param, `K.scenes({only})`).
- Reference live host, acceptance checker (`bin/check.mjs`), analysis and stem tools, and a library of packs.

[Unreleased]: https://github.com/chrisskurda/bootleg-vizualizer/compare/v0.9.4...HEAD
[0.9.4]: https://github.com/chrisskurda/bootleg-vizualizer/releases/tag/v0.9.4
[0.9.3]: https://github.com/chrisskurda/bootleg-vizualizer/releases/tag/v0.9.3
[0.9.2]: https://github.com/chrisskurda/bootleg-vizualizer/releases/tag/v0.9.2
[0.9.0]: https://github.com/chrisskurda/bootleg-vizualizer/releases/tag/v0.9.0
