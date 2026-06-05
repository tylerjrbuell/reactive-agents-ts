#!/usr/bin/env bash
# Phase-4 cross-tier A/B grid: RA_ASSEMBLY (project) vs legacy curate().
# Sweeps arm x task x tier; one spot-test subprocess per cell; collects the
# single greppable SPOT_RESULT_JSON line + the RA_ASSEMBLY_TRACE lines.
# Real-overflow task uses a genuinely large committed file (AGENTS.md ~57k chars
# > 45875 recency budget) so project()'s summary+ref branch engages WITHOUT the
# RA_RECENCY_BUDGET_CHARS test knob (knob proves the branch fires; the grid must
# prove it HELPS at the real budget — two different proofs).
set -uo pipefail
cd "$(dirname "$0")"

# Load repo-root .env (API keys + GITHUB token) into env for the MCP subprocess.
# Values never printed. bun only auto-loads .env from its own cwd (scripts/probes),
# which has none, so source the root file explicitly.
if [ -f ../../.env ]; then set -a; . ../../.env; set +a; fi

# Deterministic overflow fixture: a 57k file (> 45875-char mid budget). Regenerate
# from the repo-root AGENTS.md if absent so the grid is self-contained.
[ -f overflow-fixture.md ] || cp ../../AGENTS.md overflow-fixture.md

OUT="${OUT:-/tmp/assembly-ab-grid-$(date +%Y%m%dT%H%M%S)}"
mkdir -p "$OUT"
RUNS="${RUNS:-1}"
CELL_TIMEOUT="${CELL_TIMEOUT:-420}"

# tier=name|provider|model
TIERS_DEFAULT="local|ollama|qwen3.5:latest mid|anthropic|claude-haiku-4-5-20251001"
read -ra TIERS <<< "${TIERS:-$TIERS_DEFAULT}"

# task=name|TOOLS|TASK
# compact: github MCP list_commits returns ~8534 chars (< budget) → projects FULL on
# both arms → the clean no-regression comparison.
COMPACT="compact|file-write,github/list_commits|Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file (./commits.md) with all 10 commit messages."
# overflow: built-in file-read of a 57k local fixture (> 45875 budget) → =1 projects
# summary+ref, =0 legacy-crushes. Deterministic, no MCP/network. Documents the
# overflow path on both arms (currently fails pending Phase 5 write_result_to_file).
OVERFLOW="overflow|file-read,file-write|Read the file ./overflow-fixture.md (in the current directory) then write a local markdown file ./agents-summary.md summarizing its top-level (##) sections."

TASKS_DEFAULT=("$COMPACT" "$OVERFLOW")
# allow TASKS=compact|overflow to subset
case "${TASK_SET:-both}" in
  compact)  TASKS=("$COMPACT") ;;
  overflow) TASKS=("$OVERFLOW") ;;
  *)        TASKS=("${TASKS_DEFAULT[@]}") ;;
esac

REPORT="$OUT/grid.jsonl"
echo "grid out: $OUT" >&2

for tier in "${TIERS[@]}"; do
  IFS='|' read -r tname provider model <<< "$tier"
  for task in "${TASKS[@]}"; do
    IFS='|' read -r kind tools desc <<< "$task"
    for arm in 0 1; do
      for ((r=1; r<=RUNS; r++)); do
        cell="${tname}__${kind}__asm${arm}__r${r}"
        log="$OUT/$cell.log"
        echo ">>> $cell" >&2
        rm -f agents-summary.md commits.md
        RA_ASSEMBLY="$arm" RA_ASSEMBLY_DEBUG=1 SPOT_LOG_IO=1 SPOT_STRATEGY=reactive \
          SPOT_PROVIDER="$provider" SPOT_MODEL="$model" \
          SPOT_TOOLS="$tools" SPOT_TASK="$desc" \
          timeout "$CELL_TIMEOUT" bun run spot-test.ts >"$log" 2>&1
        ec=$?
        sj=$(grep -m1 '^SPOT_RESULT_JSON=' "$log" | sed 's/^SPOT_RESULT_JSON=//')
        traces=$(grep -c 'RA_ASSEMBLY_TRACE' "$log")
        # #1 renamed the overflow projection label summary+ref → preview+ref;
        # match both so the signal survives the rename (older logs/back-compat).
        summref=$(grep -oE 'preview\+ref|summary\+ref' "$log" | wc -l)
        [ -z "$sj" ] && sj='{"success":null,"note":"no SPOT_RESULT_JSON (timeout/crash)"}'
        # Snapshot the deliverable BEFORE the next cell rm's it, and grade
        # faithfulness in-grid (the flag ≠ the file — #1 lesson). overflow →
        # section-coverage vs the 22-section fixture; compact → keep commits.md.
        cov=null
        if [ "$kind" = "overflow" ] && [ -f agents-summary.md ]; then
          cp agents-summary.md "$OUT/$cell.deliverable.md"
          c=$(bun run section-coverage-grade.ts overflow-fixture.md "$OUT/$cell.deliverable.md" 2>/dev/null | grep -oE '"coverage":[[:space:]]*[0-9.]+' | grep -oE '[0-9.]+$')
          [ -n "$c" ] && cov=$c
        elif [ "$kind" = "compact" ] && [ -f commits.md ]; then
          cp commits.md "$OUT/$cell.deliverable.md"
        fi
        echo "{\"cell\":\"$cell\",\"tier\":\"$tname\",\"task\":\"$kind\",\"arm\":$arm,\"run\":$r,\"exit\":$ec,\"traces\":$traces,\"summref_lines\":$summref,\"coverage\":$cov,\"result\":$sj}" >> "$REPORT"
      done
    done
  done
done

echo "=== grid done: $REPORT ===" >&2
cat "$REPORT" >&2
