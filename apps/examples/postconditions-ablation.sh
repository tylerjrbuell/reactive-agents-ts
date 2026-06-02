#!/usr/bin/env bash
# #7 PostCondition spine ablation: RA_POST_CONDITIONS 0 (off) vs 1 (on).
# Sweeps arm x deliverable-task x tier. RA_ASSEMBLY is FIXED ON (now the default),
# so both arms share the canonical assembler and isolate the post-condition gate.
#
# The gate (arbitrator.applyPostConditionGate) refuses exit-success when a derived
# state-grounded condition (e.g. ArtifactProduced(./commits.md)) is unmet, steering
# the loop to actually produce the deliverable. This ablation measures:
#   WIN  — dishonest-success (success=true but file absent/empty/low-coverage) ↓
#   RISK — false-block of honest runs (extra iterations / max-iter) + token overhead
set -uo pipefail
cd "$(dirname "$0")"
if [ -f ../../.env ]; then set -a; . ../../.env; set +a; fi
[ -f overflow-fixture.md ] || cp ../../AGENTS.md overflow-fixture.md

OUT="${OUT:-/tmp/postconditions-ablation-$(date +%Y%m%dT%H%M%S)}"
mkdir -p "$OUT"
RUNS="${RUNS:-3}"
CELL_TIMEOUT="${CELL_TIMEOUT:-420}"

TIERS_DEFAULT="local|ollama|qwen3.5:latest mid|anthropic|claude-haiku-4-5-20251001"
read -ra TIERS <<< "${TIERS:-$TIERS_DEFAULT}"

# Deliverable tasks — each has a write-verb + literal path → derives an
# ArtifactProduced + ToolCalled(file-write) post-condition.
COMMITS="commits|github/list_commits,file-write|commits.md|Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file ./commits.md with all 10 commit messages."
SUMMARY="summary|file-read,file-write|agents-summary.md|Read the file ./overflow-fixture.md (in the current directory) then write a local markdown file ./agents-summary.md summarizing its top-level (##) sections."
TASKS_DEFAULT=("$COMMITS" "$SUMMARY")
case "${TASK_SET:-both}" in
  commits) TASKS=("$COMMITS") ;;
  summary) TASKS=("$SUMMARY") ;;
  *)       TASKS=("${TASKS_DEFAULT[@]}") ;;
esac

REPORT="$OUT/ablation.jsonl"
echo "ablation out: $OUT" >&2

for tier in "${TIERS[@]}"; do
  IFS='|' read -r tname provider model <<< "$tier"
  for task in "${TASKS[@]}"; do
    IFS='|' read -r kind tools deliverable desc <<< "$task"
    for arm in 0 1; do
      for ((r=1; r<=RUNS; r++)); do
        cell="${tname}__${kind}__pc${arm}__r${r}"
        log="$OUT/$cell.log"
        echo ">>> $cell" >&2
        rm -f agents-summary.md commits.md
        RA_POST_CONDITIONS="$arm" RA_ASSEMBLY=1 SPOT_LOG_IO=1 SPOT_STRATEGY=reactive \
          SPOT_PROVIDER="$provider" SPOT_MODEL="$model" \
          SPOT_TOOLS="$tools" SPOT_TASK="$desc" \
          timeout "$CELL_TIMEOUT" bun run spot-test.ts >"$log" 2>&1
        ec=$?
        sj=$(grep -m1 '^SPOT_RESULT_JSON=' "$log" | sed 's/^SPOT_RESULT_JSON=//')
        [ -z "$sj" ] && sj='{"success":null,"note":"no SPOT_RESULT_JSON (timeout/crash)"}'
        # fs-reality: did the named deliverable actually get produced?
        fexists=false; fbytes=0; cov=null
        if [ -f "$deliverable" ]; then
          fexists=true; fbytes=$(wc -c < "$deliverable" | tr -d ' ')
          cp "$deliverable" "$OUT/$cell.deliverable.md"
          if [ "$kind" = "summary" ]; then
            c=$(bun run section-coverage-grade.ts overflow-fixture.md "$OUT/$cell.deliverable.md" 2>/dev/null | grep -oE '"coverage":[[:space:]]*[0-9.]+' | grep -oE '[0-9.]+$')
            [ -n "$c" ] && cov=$c
          fi
        fi
        # dishonest-success = claimed success but the deliverable is absent or empty.
        succ=$(echo "$sj" | grep -oE '"success":[[:space:]]*(true|false|null)' | grep -oE '(true|false|null)$')
        dishonest=false
        if [ "$succ" = "true" ] && { [ "$fexists" = false ] || [ "${fbytes:-0}" -lt 20 ]; }; then dishonest=true; fi
        echo "{\"cell\":\"$cell\",\"tier\":\"$tname\",\"task\":\"$kind\",\"pc\":$arm,\"run\":$r,\"exit\":$ec,\"fileExists\":$fexists,\"fileBytes\":$fbytes,\"coverage\":$cov,\"dishonest\":$dishonest,\"result\":$sj}" >> "$REPORT"
      done
    done
  done
done

echo "=== ablation done: $REPORT ===" >&2
cat "$REPORT" >&2
