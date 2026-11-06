#!/usr/bin/env bash
# Repo-wide cast/swallow ceilings (2026-11-05).
#
# These ceiling tests live in packages/runtime/test/ but count sites across ALL
# packages. A change in another package (e.g. a new `as unknown as` in a
# reasoning test) only turned them red in CI, because package-scoped test runs
# never execute them. Running them here puts them in `bun run repo check`.
#
# Usage: bash scripts/check-cast-ceilings.sh
# Exit: 0 if every ceiling holds; non-zero with the failing test output if not.

set -euo pipefail
cd "$(dirname "$0")/.."

bun test \
  packages/runtime/test/as-unknown-as-ceiling.test.ts \
  packages/runtime/test/composable-layer-ceiling.test.ts \
  packages/runtime/test/no-silent-swallow-floor.test.ts \
  --timeout 30000
