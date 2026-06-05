#!/usr/bin/env bash
# Termination-decider collapse — THICK BASELINE cohort.
# Single arm (current code, post-instrument): locks the thick-baseline CohortStats
# the comparator gates the collapse against. The collapsed arm runs AFTER sites
# 2,5,6,7 are folded into the arbitrator chain; same script, re-run, compareCohorts.
#
# Scope: sites 2 (low_delta), 5 (stall_deliverable), 6 (oracle_forced), 7 (loop_resolution).
# Reactive + switching-OFF (matches the current spot harness pin; site 4
# switching_exhausted + ToT sub-kernel deferred to a switching-enabled cohort).
#
# Tasks trip the give-up race naturally on a small model:
#   compact  — achievable (github list_commits + write) → mostly site-1 final_answer (CONTROL).
#   overflow — 57k file-read + summarize + write → small model stalls → site 5.
#   stuck    — read a nonexistent file + summarize → repeated tool failure → site 7/2 give-up.
# Each cell's taskId (== trace runId) is recorded so the aggregator groups cohorts by tier.
set -uo pipefail
cd "$(dirname "$0")"

# Load repo-root .env (API keys + GITHUB token). Values never printed.
if [ -f ../../.env ]; then set -a; . ../../.env; set +a; fi

# Deterministic 57k overflow fixture (> 45875-char mid budget).
[ -f overflow-fixture.md ] || cp ../../AGENTS.md overflow-fixture.md

OUT="${OUT:-/tmp/decider-baseline-$(date +%Y%m%dT%H%M%S)}"
mkdir -p "$OUT"
CELL_TIMEOUT="${CELL_TIMEOUT:-300}"

# tier = name|provider|model|N
TIERS_DEFAULT="local|ollama|qwen3.5:latest|6 mid|anthropic|claude-haiku-4-5-20251001|4"
read -ra TIERS <<< "${TIERS:-$TIERS_DEFAULT}"

# task = name|TOOLS|TASK
COMPACT="compact|file-write,github/list_commits|Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file (./commits.md) with all 10 commit messages."
OVERFLOW="overflow|file-read,file-write|Read the file ./overflow-fixture.md (in the current directory) then write a local markdown file ./agents-summary.md summarizing its top-level (##) sections."
STUCK="stuck|file-read,file-write|Read the file ./nonexistent-spec-do-not-create.md then write a local markdown file ./stuck-summary.md summarizing its sections."
TASKS=("$COMPACT" "$OVERFLOW" "$STUCK")

MANIFEST="$OUT/manifest.jsonl"
echo "baseline out: $OUT" >&2

for tier in "${TIERS[@]}"; do
  IFS='|' read -r tname provider model nruns <<< "$tier"
  for task in "${TASKS[@]}"; do
    IFS='|' read -r kind tools desc <<< "$task"
    for ((r=1; r<=nruns; r++)); do
      cell="${tname}__${kind}__r${r}"
      log="$OUT/$cell.log"
      echo ">>> $cell" >&2
      rm -f agents-summary.md commits.md stuck-summary.md
      SPOT_STRATEGY=reactive SPOT_LOG_IO=1 \
        SPOT_PROVIDER="$provider" SPOT_MODEL="$model" \
        SPOT_TOOLS="$tools" SPOT_TASK="$desc" \
        timeout "$CELL_TIMEOUT" bun run spot-test.ts >"$log" 2>&1
      ec=$?
      sj=$(grep -m1 '^SPOT_RESULT_JSON=' "$log" | sed 's/^SPOT_RESULT_JSON=//')
      [ -z "$sj" ] && sj='{"taskId":null,"success":null,"note":"no SPOT_RESULT_JSON (timeout/crash)"}'
      echo "{\"cell\":\"$cell\",\"tier\":\"$tname\",\"task\":\"$kind\",\"run\":$r,\"exit\":$ec,\"result\":$sj}" >> "$MANIFEST"
    done
  done
done

echo "=== baseline done: $MANIFEST ===" >&2
cat "$MANIFEST" >&2
