# bootleg-vizualizer — Repository Contract

**Layer:** repository. **Project:** bootleg (no project contract file exists yet; see Contract gaps). **Context:** personal.
**Global contract:** `CONTRACT.md` in the owner's `agents.md` repository on the home remote (the context profile gives its address; beside this checkout it is `../agents.md`). Read it first. Anything not mentioned here is inherited unchanged. This repository is public, so the home remote's address is deliberately not written in this file.
**Contract version checked:** `2.0.0` (2026-11-28)
**Size cap:** keep this file under about 400 lines; move deep specifications into `docs/` or directory-scoped `AGENTS.md` files and link to them.

Written 2026-11-28 by an agent from the repository at commit `61c7892` (the tip of `origin/main` as recorded locally), by reading only. Nothing was built or run. Statements about owner decisions are marked as such; everything else is what the files show.

## What this is
The pack format for music visualizers and everything needed to run and test it: the spec (`SPEC.md`), the runtime a pack runs in (`core/`), look/FX passes with a CPU reference, a WebGL implementation and a Rust reference with golden images (`tests/`), a reference live host (`bin/server.mjs`, `core/live.html`), pack-author tools (`bin/check.mjs`, `bin/measure.mjs`), and 42 packs (`packs/`). It is the upstream that other repositories vendor (`VENDORING.md`); it is not an application. State: `VERSION` 0.9.4, pre-1.0, MIT. "Production" for this repository is not yet asked; in practice a change reaches users when a consumer pulls it, and the repository is public, so a push to `origin` is a publication.

## Quick Command Matrix
*Copied from `package.json` and `README.md`. There is no single task that runs everything.*
* **Install / Setup:** `npm i` (needs Node, Google Chrome, ffmpeg and ffprobe on the machine; the Rust goldens also need cargo)
* **Lint & Typecheck:** none yet
* **Unit Tests:** `npm test` (version check, FX conformance on CPU and WebGL2, stems, scenes, kit; the WebGL and stems tests launch Chrome)
* **Live Dev Integration Tests:** `npm run check` (= `node bin/check.mjs [--packs a,b] [--fps]`, the pack acceptance check of SPEC §10; launches Chrome, makes synthetic audio with ffmpeg)
* **Full Build:** none yet (nothing is built; `npm run goldens` regenerates the golden images from `tests/fx-reference`)
* **Whole gate (everything CI runs):** none yet (no CI; `npm test` and `npm run check` are separate commands)
* **Environment check:** none yet
* **Run:** `npm run live` (= `node bin/server.mjs [--port N] [--media DIR]`), then open `/core/live.html` on the printed loopback address
* **Other:** `npm run check:version` · `node bin/measure.mjs [--packs a,b]` (frame-rate probe; opens a visible Chrome window) · `node bin/screenshots.mjs` (README stills)

## Playbooks that apply
* **publishing-and-mirrors** — the repository is public on GitHub (owner mark, 2026-11-28).
* **data-formats-and-saves** — it defines the pack format (`pack.json`, the `(T, A, P, K)` runtime contract), the `viz-*` `postMessage` messages, and the reference host's HTTP interface (SPEC §8).
* **equivalence-and-performance** — `core/fx.js` and `core/fx-gl.js` must reproduce the Rust goldens in `tests/golden/fx/`; SPEC §9 sets a frame-rate budget.
* **forks-and-vendoring** — `tests/fx-reference/src/main.rs` is copied verbatim from RiffBox (its header says so), and this repository is the upstream side of every consumer's vendored copy, so "upstream is tagged before any consumer updates" and "conformance tests travel with the code" bind here.

Considered and not listed: deploy-backup-operations (no server, no state), unattended-runs, migration, provenance-and-clean-room (SPEC §7 forbids third-party material in packs), acting-on-other-machines.

## Local rule documents
These stay where they are; this layer does not restate them.
* `SPEC.md` — the pack format and runtime contract. §4 and §4a (determinism and loop rules), §7 (dependencies and licensing), §9 (performance budget and the portable canvas subset), §10 (acceptance checklist) are rules for every pack.
* `VENDORING.md` — how consumers take this repository: pin by tag, never patch the vendored copy, run the conformance tests.
* `packs/README.md` — the pack catalog and how to make a pack.
* `CHANGELOG.md` — Keep a Changelog; states "while we are `0.x`, breaking changes bump the minor version".
* `bin/check.mjs` — the executable form of SPEC §10.

## Overrides
None approved. Proposed:

**Override [playbook equivalence-and-performance, "must match a reference exactly"]:** The JavaScript and WebGL FX ports are compared with the Rust goldens within a stated tolerance (at most 0.5% of pixels off by more than two levels, mean error 0.35 levels), while the noise hash must be bit-exact (`tests/fx.test.mjs:8-13`).
**Reason:** float rounding differs between Rust, JS and GLSL; the hash was made integer so the part that decides structure is exact. **Approved:** pending owner (agent-proposed, 2026-11-28).

**Override [§5 Zero Hardcoded User-Facing Strings, Modular i18n Packs]:** A pack's display text (`name`, `description`, param labels) lives in its own `pack.json`, and a pack is a self-contained folder with no shared locale files (SPEC §1, §4 rule 5). The reference host `core/live.html` is a developer tool with inline English labels.
**Reason:** packs must run unchanged in every host and offline; hosts own their own UI text. **Approved:** pending owner (agent-proposed, 2026-11-28).

## Kickoff answers
Owner answers are quoted or marked decided; "repository shows" is what the files say, not a decision.
* **Versioning and changelog:** not yet asked. Repository shows: semantic version in `VERSION` and `package.json`, kept equal by `bin/check-version.mjs`; `CHANGELOG.md` with `[Unreleased]`; SPEC carries its own "v0.9 (draft)".
* **Update channel and what a push triggers:** not yet asked. Repository shows: `origin` fetches from GitHub and pushes to both GitHub and the home remote, so every `git push origin` is a public push. No CI, no release workflow. Consumers pull by `git subtree` or a copy script.
* **Home remote and public mark:** decided, 2026-11-28: every project is pushed to the home remote named in the context profile; this repository is marked public in the context profile.
* **Commit style:** decided, 2026-11-28: plain or `scope: sentence` subjects, with a body stating cause and verification.
* **Test environments:** not yet asked. Repository shows: the system's Google Chrome (launched by `playwright-core` with a fresh profile), ffmpeg, synthetic audio written to the git-ignored `cache/`.
* **What is production:** not yet asked.
* **Installed copy versus working tree:** not yet asked. Consumers hold vendored copies; one consumer's script copies from a sibling checkout of this repository.
* **Targets and weakest device:** not yet asked. Repository shows: SPEC §9 targets 60 fps at 1920×1080 "on a laptop"; consumers also run packs on the floor device and a Car Thing, which is why §9 defines a portable canvas subset.
* **License and attribution:** repository shows MIT (`LICENSE`); FX code credited to RiffBox (`VENDORING.md`). No third-party notices file. Owner confirmation: not yet asked.
* **Naming table:** below, collected from the files; not owner-reviewed.
* **Organization-managed machines involved:** not yet asked.
* **Disk budget:** not yet asked. `cache/` and `tests/fx-reference/target/` are git-ignored and unbounded.
* **Sibling products:** repository shows three consumers: bootleg, bootleg-bridge-thing, bootleg-vizualizer-videocreator (the last is not named in the README).
* **Localization:** not yet asked.
* **Spelling variant:** decided, 2026-11-28: US English for new text; existing other spelling is a gap; shipped format keys never change.
* **What the agent may do on the owner's machine:** not yet asked (the tools launch Chrome, and `bin/measure.mjs` opens a visible window).

## Naming table
| Namespace | Value |
|---|---|
| Display name | bootleg-vizualizer (this spelling; never "visualizer" in the name) |
| Load-bearing identifier | package `bootleg-vizualizer`; vendored path `vendor/bootleg-vizualizer/`; pack id = folder name under `packs/` |
| Spec title | "Reactive Animation Pack Spec" (`SPEC.md`) |
| Browser globals | `definePack`, `VisFX`, `VisStems` |
| Message type prefix | `viz-` (`viz-features`, `viz-meta`, `viz-image`, `viz-image-file`, `viz-pack`) |
| HTTP paths (reference host) | `/api/packs`, `/api/media`, `/api/meta`, `/api/stems`, `/media/<n>/…` |
| Configuration directory | none |
| Data directory | `cache/` (git-ignored); `samples/` (git-ignored) |
| Temporary file prefix | `viz-` in the system temp directory (`bin/server.mjs:31`) |
| Environment variable prefix | none |
| Ports | 8080 default for `bin/server.mjs` (`--port`); checks and tests use an ephemeral loopback port |
| Tag pattern | `v<semver>` (CHANGELOG links; one local tag `v0.10.0`) |
| Rust crate | `fx-reference` (`tests/fx-reference`, not published) |

## Glossary
| Canonical name | Meaning | Aliases |
|---|---|---|
| pack | one animation: a folder with `pack.json` and a page that draws from `(T, A, P)` | "native pack", "animation pack", "visualizer" |
| runtime | `core/pack-runtime.js`, what runs inside a pack's frame | "kit" (for `K`, its helpers) |
| reference host | `bin/server.mjs` plus `core/live.html` | "live host", "dev host", "live" |
| offline renderer | the frame-by-frame renderer; it lives in bootleg-vizualizer-videocreator as `bin/render.mjs`, not here | "render", "`render.mjs`" |
| look / FX passes | host-level grading and the roto, glitch and screen pixel passes (SPEC §5, §5a) | "look layer", "pixel passes" |
| goldens | `tests/golden/fx/*.rgba` with `manifest.json` and `hash.json`, written by `tests/fx-reference` | "Rust goldens", "golden images" |
| bootleg stem set | per-track stems; the format is owned by bootleg-stemserver (`contracts/song_format.md`) | "bootleg stem format", "stems layout" |
| consumer | a repository that vendors this one | "host", "player" |
| acceptance check | `bin/check.mjs` | "checker", "the check" |

## Active Safety Constraints (Project-Specific Registry)
> **Governance Rule:** Every feature, background job, script, and refactor in this repository MUST honor all constraints listed below and in the global registry. Entries are append-only: loosening or removing one needs an owner directive and a dated `docs/adr/` entry.

Only guardrails the repository already states or implements.
* `[SAFE-VIZ-001]` **Packs are deterministic and offline.** `draw` depends only on `(T, A, P, K)`: no random source, no clock, no network at run time (SPEC §4). Enforced by the static and statelessness checks in `bin/check.mjs`.
* `[SAFE-VIZ-002]` **No third-party code, fonts, images or audio in `packs/` or `core/`** (SPEC §7). Enforced by the static check in `bin/check.mjs`.
* `[SAFE-VIZ-003]` **Packs load the runtime by relative path** so they work from any host mount. Enforced by `bin/check.mjs` (added in `9378d60`).
* `[SAFE-VIZ-004]` **The reference host listens on loopback only** and serves only files under the repository root or a `--media` directory. Enforced in `bin/server.mjs:36-41` (bind address and path-prefix checks). It has no token or origin check; that is listed under Contract gaps and is not a registered exception.
* `[SAFE-VIZ-005]` **Version files agree and the changelog has the entry.** Enforced by `bin/check-version.mjs`, run first in `npm test`.
* `[SAFE-VIZ-006]` **The FX noise hash is bit-exact across Rust, JS and GLSL.** Enforced by `tests/fx.test.mjs` (hash vectors in `tests/golden/fx/hash.json`) and `tests/fx-gl.test.mjs`.
* `[SAFE-VIZ-007]` **A consumer never patches its vendored copy; changes go upstream first** (`VENDORING.md`). Documented only, not enforced in code.

## Contract gaps
All found 2026-11-28, by reading. Most serious first.
1. **§8 A Release Is a Tag; playbook forks-and-vendoring "upstream is tagged before any consumer updates"** — `origin/main` has no tags, yet `VENDORING.md:18` tells consumers to pin by tag and `CHANGELOG.md:41-44` links to release tags `v0.9.0`–`v0.9.4` that do not exist. The only tag, `v0.10.0`, is local, lightweight (not annotated), and sits on the unpushed commit `f649197` — found 2026-11-28.
   *Update 2026-11-28:* `v0.10.1` is an annotated tag on `bfca182` (release commit with only the bump and changelog); local only, not pushed. `v0.10.0` is still lightweight, and the changelog still links `v0.9.x` tags that do not exist.
2. **§1 Commit, Push, and Publish Are Separate Approvals; §1 Home Remote First** — `origin` has two push addresses (the public host and the home remote), so one `git push origin` publishes; there is no remote that reaches the home remote alone — found 2026-11-28.
3. **§6 Local Listeners Authenticate** — `bin/server.mjs` accepts every request without a token or origin check, including `POST /api/meta` (up to about 500 MB, `bin/server.mjs:31-33`); `core/live.html:127` accepts `postMessage` from any origin and `core/pack-runtime.js:127` posts to `'*'` — found 2026-11-28.
4. **§6 Portable by Default (compare paths by components)** — the media and root guards are string prefix tests (`bin/server.mjs:26`, `:35`, `:37`, `:38`), so a sibling directory whose name starts with the media directory's name passes — found 2026-11-28.
5. **§7 Documents May Not Cite What Does Not Exist** — `SPEC.md:6` and `SPEC.md:300` cite `bin/render.mjs`, which is not in this repository; `VENDORING.md:23` gives instructions for RiffBox, archived 2026-11-19; `README.md:20` says 41 packs, the tree has 42 — found 2026-11-28.
6. **§7 One-Command Check; Tests Are Discovered; no CI** — `npm test` lists five test files by hand (`package.json:13`), `npm run check` is separate, there is no lint, formatter, or hosted CI, and `VENDORING.md:22` asks consumers to run tests "in its CI" — found 2026-11-28.
7. **§1 Atomic Commits** — releases share a commit with features (`5116232`, `71d6f51`, `f062b84`); no commit on `origin/main` has a body stating cause and verification — found 2026-11-28.
8. **§3 One Canonical Spec; §8 Component Version Table** — the spec calls itself "v0.9 (draft)" (`SPEC.md:1`) while the package is 0.9.4, with no table saying how spec, runtime and pack-library versions relate; `pack.json` and the `viz-*` messages carry no format or protocol version (playbook data-formats: "a protocol has a version field, and the receiver checks it") — found 2026-11-28.
9. **§7 Size Limits Measure More Than Lines; §3 File Size Guardrail** — source is packed many statements to a line (longest lines: `bin/check.mjs` 445 characters, `bin/testaudio.mjs` 414, `core/pack-runtime.js` 413); no formatter runs — found 2026-11-28.
10. **Playbook forks-and-vendoring "every copied file names its source commit and license"** — `tests/fx-reference/src/main.rs:2` names the source file in RiffBox but no commit — found 2026-11-28.
11. **§6 License Compatibility (third-party notices file)** — none; `playwright-core` is a dependency (tooling only, SPEC §7) — found 2026-11-28.
12. **§7 Pinned Inputs** — `playwright-core` is `^1.50.0` (`package.json:19`); Node, Chrome, ffmpeg and the Rust toolchain are not pinned — found 2026-11-28.
13. **§5 Base Language** — existing British spelling in prose and comments: `CHANGELOG.md:19` ("behaviour"), `packs/README.md:30` ("centre"), `packs/weather-report/pack.js:229` ("colour"). The stem name `colour` in `core/stems.js:9` and `SPEC.md:93` is a shipped format key and stays — found 2026-11-28.
14. **§10 Design Docs Carry a Status** — `SPEC.md` says "draft" with no date; its history line mixes eight spec versions into one paragraph — found 2026-11-28.
15. **§0 Every Level Must Exist** — the bootleg project has no project contract — found 2026-11-28.
16. **§1 Record a Baseline** — no check was run for this layer; the pass/fail state of `npm test` and `npm run check` at `61c7892` is unknown — found 2026-11-28.
   *Correction 2026-11-28:* baseline recorded at `5cd8500`: `npm test` passes, `npm run check` passes 60 packs with 28 warnings (OS-theme and cover packs: no `palette`/`bg`, named fonts, non-portable canvas calls).
17. **§8 One Version, Everywhere ("bump with the repository's script")** — there is no bump script; `VERSION`, `package.json` and the changelog heading are edited by hand and only checked by `bin/check-version.mjs` — found 2026-11-28.

## Handoff
**Layout.** `SPEC.md` (contract) · `core/` (runtime, audio feed, FX, stems, reference host page) · `bin/` (reference host server, acceptance check, analysis, measure, screenshots, version check) · `packs/<id>/` (`pack.json` + page; `_template` to copy) · `tests/` (conformance tests, `golden/fx/`, Rust reference in `fx-reference/`) · `docs/screenshots/` (README stills, generated by `bin/screenshots.mjs`).

**Toolchain pins.** `package-lock.json` and `tests/fx-reference/Cargo.lock` only. No Node, Chrome, ffmpeg or Rust version is recorded.

**State of the branches (local refs, 2026-11-28; no remote was contacted).** `origin/main` = `61c7892`. Local `main` = `f649197` ("0.10.0: cover-art kit and 18 packs"), one commit ahead and not pushed, carrying the tag `v0.10.0`. This layer is on `contract-layer`, branched from `61c7892`.
*Update 2026-11-28, later:* local `main` = `bfca182` ("Release 0.10.1", tag `v0.10.1`), above `a843c45` (bfunk2, bfunk3, onhold) and `d619506` (screenshots section fix). Not pushed. `release/` holds the 0.10.1 release build (`bin/release-build.sh`: all steps passed). All four consumers report in-sync at 0.10.1 (`bin/sync-consumers.mjs`); their commits are local too.

**Open items.** SPEC §11 lists the open design questions (stereo features, section detection, lyrics, shader packs, presets, spectrum over `postMessage`). Consumers are at different versions of this repository (review of 2026-11-28).

**Needs owner.**
* Whether `f649197` and `v0.10.0` should be pushed, and whether the tag should be re-made as an annotated tag first.
* Whether to tag the past releases the changelog links to, or remove the links.
* Whether `origin` should keep pushing to both hosts in one command.
* The kickoff answers marked "not yet asked".
* The two proposed overrides above.
* Whether to push `main` and `v0.10.1` (a push to `origin` is public).

**Unverified work.** Everything in this layer was established by reading (tier: not run). No test, check, or tool in this repository has been run by the session that wrote it. Hosted CI: none exists.

**Known failures.** None recorded in the repository. None observed, because nothing was run.

**Out-of-repository state.** None made by this layer. The tools write to `cache/` inside the checkout and to the system temp directory.

**Possibly stale documents relied on.** `VENDORING.md` (RiffBox instructions; GitHub subtree address although one consumer pulls from the home remote) and the README's pack count.

## Decision log
| Date | Decision | Reason | Status |
|---|---|---|---|
| 2026-11-28 | Every project is pushed to the home remote named in the context profile; public only if marked in the context profile (this repository is marked public) | owner statement | decided |
| 2026-11-28 | Commit subjects are plain or `scope: sentence`, with a body stating cause and verification | owner statement | decided |
| 2026-11-28 | US English for new text; existing other spelling is a gap; shipped format keys never change | owner statement | decided |
| 2026-11-26 | The stem format's home is bootleg-stemserver (`contracts/song_format.md`) | commit `61c7892`; read from the repository, not confirmed with the owner | tentative |
| 2026-11-28 | bfunk3's ticker wall uses invented company names, not ones from films, TV or comics; its "DJIA" label is "FUNK-30" | owner's choice when asked; contract §6 Likeness and SPEC §7 | decided |

## Lessons
* Make any hash that decides structure an integer hash: a float `sin` hash differs by one unit in the last place across platforms and moves glitch rows (`tests/fx-reference/src/main.rs:7-9`).
* A rewrite of shared helpers needs a guard test: the loop-safe kit helpers were dropped by a rewrite and restored with `tests/kit.test.mjs` (`49c60ef`).
* Packs must load the runtime by relative path, or they break under a different host mount (`9378d60`).
* A synthetic `A.section` must carry `start`, `end` and `count`: without them `K.scenes` computes a `NaN` scene and multi-scene packs throw and draw nothing (`d619506`).

## Communication log
No entries yet.

## Proposed for the global contract
None.
