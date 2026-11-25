# Vendoring bootleg-vizualizer into another app

bootleg-vizualizer (spec + runtime + packs + FX + tests) is meant to be **vendored**: copied into a consumer at a pinned version, never
edited in place there. Consumers: [bootleg](https://github.com/chrisskurda/bootleg) (the player), [bootleg-vizualizer-videocreator](https://git.skurda.org/chris/bootleg-vizualizer-videocreator.git), other apps that show visualizers (stem players, music makers).

## What a consumer gets
| path | what | consumer uses it for |
|---|---|---|
| `SPEC.md` | the contract (packs, features, params, look/FX, metadata) | reference |
| `core/pack-runtime.js` `core/fx-gl.js` `core/look.js` `core/meta.js` | what runs inside a pack's frame | the player/audition page host a pack in an iframe |
| `core/audio.js` `core/stems.js` `core/live.html` | live analysis (incl. per-stem taps) + stem frame shape + the reference host page | optional: the reference host, or lift `audio.js` + `stems.js` |
| `core/fx.js` `core/feed-offline.js` | CPU FX reference, offline feature feed | offline rendering, tests |
| `packs/` | the packs | content |
| `bin/` | `analyze` `stems` `meta` `check` `measure` `server` | the reference analysis (offline renderers import it), QA, the dev host |
| `tests/` | FX goldens + Rust reference + conformance tests | prove the vendored copy still conforms |

## How
- Pin by **tag** (`VERSION`, semver: spec/contract changes bump major/minor; new packs bump patch).
- Put it at `vendor/bootleg-vizualizer/` in the consumer (for example `<app>/vendor/bootleg-vizualizer/`).
- Update with `git subtree pull --prefix vendor/bootleg-vizualizer https://github.com/chrisskurda/bootleg-vizualizer.git <tag> --squash` (or a copy script; subtree keeps it plain files, no submodule checkout step).
- Never patch `vendor/bootleg-vizualizer/` in the consumer; send the change upstream, then bump the pin.
- Each consumer runs `node vendor/bootleg-vizualizer/tests/fx.test.mjs` (and `fx-gl.test.mjs` where there is a browser) in its CI to prove the pin conforms.
- A **native** host (RiffBox, Rust) does not run the JS runtime; it implements the FX passes in Rust and tests against `tests/golden/fx/` (the reference crate in `tests/fx-reference/` is the same code RiffBox already has, with the portable hash — RiffBox's `hash()` should be replaced by it).

## Licensing
MIT (see LICENSE). The FX code originates from RiffBox (MIT, same author) via the racing engine's shaders. Packs contain no third-party code, fonts or art (SPEC §7).
