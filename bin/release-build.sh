#!/usr/bin/env bash
# Release build of bootleg-vizualizer: runs the tests and the pack acceptance check, then packages the committed tree.
#   bin/release-build.sh [--skip-tests]
# Output: release/bootleg-vizualizer-<version>.tar.gz and release/release-manifest.json (schema 1: what was built, from
# which commit, which steps ran and how they ended, and a sha256 per file). Nothing is tagged, committed, or pushed.
# The archive holds HEAD exactly as committed (git archive), which is what a consumer vendors. A modified tree is
# reported as such: the file is named -dirty and the manifest says so, because the tests then ran on other content.
# Needs: node, npm, git, Google Chrome and ffmpeg (the tests and the check launch Chrome and make synthetic audio).
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    *) echo "release-build: unknown option $arg" >&2; exit 2 ;;
  esac
done

OUT=release
MANIFEST="$OUT/release-manifest.json"
VERSION=$(tr -d '[:space:]' < VERSION)
COMMIT=$(git rev-parse HEAD)
IS_DIRTY=false; [ -z "$(git status --porcelain)" ] || IS_DIRTY=true
IS_TAGGED=false; [ "$(git rev-parse --verify --quiet "v$VERSION^{commit}" || true)" = "$COMMIT" ] && IS_TAGGED=true
SUFFIX=""; [ "$IS_DIRTY" = true ] && SUFFIX="-dirty"
STEPS=(); ARTIFACTS=()

sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
join_by_comma() { local IFS=,; echo "$*"; }
# step names, statuses, and file names below are fixed words from this script, so they need no JSON escaping
record_step() { STEPS+=("{\"name\":\"$1\",\"status\":\"$2\",\"note\":\"${3:-}\"}"); }
record_artifact() { ARTIFACTS+=("{\"file\":\"$1\",\"target\":\"$2\",\"bytes\":$(wc -c < "$OUT/$1" | tr -d ' '),\"sha256\":\"$(sha256_of "$OUT/$1")\"}"); }
write_manifest() {
  cat > "$MANIFEST" <<JSON
{
  "schema": 1,
  "component": "bootleg-vizualizer",
  "version": "$VERSION",
  "commit": "$COMMIT",
  "dirty": $IS_DIRTY,
  "tagged": $IS_TAGGED,
  "host": "$(uname -s | tr 'A-Z' 'a-z')-$(uname -m)",
  "builtAt": "$(date -u +%FT%TZ)",
  "result": "$1",
  "steps": [$(join_by_comma ${STEPS[@]+"${STEPS[@]}"})],
  "artifacts": [$(join_by_comma ${ARTIFACTS[@]+"${ARTIFACTS[@]}"})]
}
JSON
}
run_step() {   # run_step <name> <command…>: a failing step is recorded, the manifest says "failed", and the script stops
  local name=$1; shift
  echo; echo "== $name: $*"
  if "$@"; then record_step "$name" pass; else record_step "$name" fail; write_manifest failed; echo "release-build: $name failed" >&2; exit 1; fi
}

# Only a folder this script made (it holds our manifest) or an empty one is ever cleared.
if [ -e "$OUT" ] && [ ! -f "$MANIFEST" ] && [ -n "$(ls -A "$OUT")" ]; then
  echo "release-build: $OUT/ exists and was not made by this script; move it away first" >&2; exit 2
fi
rm -rf "$OUT"; mkdir -p "$OUT"

for tool in node npm git ffmpeg; do command -v "$tool" >/dev/null 2>&1 || { echo "release-build: $tool is not installed" >&2; exit 2; }; done

run_step install npm ci --no-audit --no-fund
if [ "$SKIP_TESTS" = 1 ]; then
  record_step tests skipped "--skip-tests"; record_step pack-check skipped "--skip-tests"
else
  run_step tests npm test
  run_step pack-check npm run check
fi

ARCHIVE="bootleg-vizualizer-$VERSION$SUFFIX.tar.gz"
run_step package git archive --format=tar.gz --prefix="bootleg-vizualizer-$VERSION/" -o "$OUT/$ARCHIVE" HEAD
record_artifact "$ARCHIVE" source
write_manifest complete

echo; echo "bootleg-vizualizer $VERSION ($(git rev-parse --short HEAD)$SUFFIX) → $OUT/$ARCHIVE"
[ "$IS_TAGGED" = true ] || echo "note: HEAD is not the tag v$VERSION. Consumers pin by tag (VENDORING.md); bin/sync-consumers.mjs --apply will refuse until it is."
