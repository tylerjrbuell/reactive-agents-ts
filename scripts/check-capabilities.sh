#!/usr/bin/env bash
# The CI "Check capability manifest" step, runnable through `bun run repo check`
# (2026-11-06). It ran only in CI, so deleting RI handlers turned dev red
# while `repo check --all` was green.
#
# Usage: bash scripts/check-capabilities.sh
# Exit: non-zero when CAPABILITIES.md and the dispatched RI handlers disagree.

set -euo pipefail
cd "$(dirname "$0")/.."
bun run scripts/check-capabilities.ts
