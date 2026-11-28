# Vendoring bootleg-vizualizer into another app

bootleg-vizualizer (spec + runtime + packs + FX + tests) is meant to be **vendored**: copied into a consumer at a pinned version, never
edited in place there. Consumers: [bootleg](https://github.com/chrisskurda/bootleg) (the player), [bootleg-bridge-thing](https://github.com/chrisskurda/bootleg-bridge-thing) (a Car Thing remote), other apps that show visualizers (stem players, music makers).

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

## Keeping every consumer on the same version
Until there is a versioned catalog for packs, every consumer carries the whole pack library at one version. `bin/sync-consumers.mjs` keeps them equal:

```sh
node bin/sync-consumers.mjs            # report only: which consumers match this checkout
node bin/sync-consumers.mjs --apply    # update the ones that differ
```

- It expects the consumer checkouts beside this one (`--root <dir>`, or `--path <id>=<dir>` for one of them). A checkout that is not there is reported as `not-found`, never as fine.
- The comparison is by content against the tag `v<VERSION>`: every file a consumer carries is hashed. An edited vendored file, a missing pack, or a stray file shows up even when the consumer's `VERSION` matches.
- `--apply` needs this checkout to be clean and its HEAD to be that tag: tag the release first. It then runs each consumer's own vendoring step and reads the result back.

| consumer | how it carries the copy | what `--apply` leaves behind |
|---|---|---|
| bootleg | `git subtree` at `vendor/bootleg-vizualizer` | a commit in the consumer (not pushed) |
| bootleg-vizualizer-videocreator | `git subtree` at `vendor/bootleg-vizualizer` | a commit in the consumer (not pushed) |
| bootleg-composer | copy by its `scripts/vendor-vizualizer.sh` | uncommitted changes in the consumer |
| bootleg-bridge-thing | partial copy by its `scripts/vendor-viz.mjs` (four `core/` files, one of them patched, and the packs) | uncommitted changes in the consumer |

A `git subtree` consumer with uncommitted changes is reported as `blocked` and left alone. The list of consumers lives at the top of `bin/sync-consumers.mjs`; add a new consumer there.

## Licensing
MIT (see LICENSE). The FX code originates from RiffBox (MIT, same author) via the racing engine's shaders. Packs contain no third-party code, fonts or art (SPEC §7).
