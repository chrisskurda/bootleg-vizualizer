# Changelog

All notable changes to bootleg-vizualizer are documented here. The pack format and its API are versioned together (see `SPEC.md`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While we are `0.x`, breaking changes bump the minor version.

## [Unreleased]

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
