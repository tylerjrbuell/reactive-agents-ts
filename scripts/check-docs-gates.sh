#!/usr/bin/env bash
# The CI "Docs Anti-Rot Gates" job, runnable through `bun run repo check`
# (2026-11-06). These gates ran only in CI, so a hand-edited generated table
# (configuration.md) turned dev red although `repo check --all` was green.
# Keep this list in step with .github/workflows/ci.yml (docs job).
#
# Usage: bash scripts/check-docs-gates.sh
# Exit: non-zero on the first failing gate.

set -euo pipefail
cd "$(dirname "$0")/.."

bun run docs:gen:api -- --check
bun run docs:examples:check
(cd apps/docs && bun run metrics >/dev/null && bun run metrics:check)
bun run docs:sync:check
