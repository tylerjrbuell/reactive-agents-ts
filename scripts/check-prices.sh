#!/usr/bin/env bash
# Price snapshot age gate (2026-11-19). Offline: reads only the committed
# llm-provider snapshot's asOf and prints a STALE warning past
# STALE_AFTER_DAYS (scripts/update-prices.ts). Never downloads, never fails on
# age. Drift (download + diff) runs via `bun run prices:check` and the weekly
# .github/workflows/prices.yml.
#
# Usage: bash scripts/check-prices.sh
# Exit: non-zero only if the snapshot file cannot be read or parsed.

set -euo pipefail
cd "$(dirname "$0")/.."
bun scripts/update-prices.ts --check --offline
