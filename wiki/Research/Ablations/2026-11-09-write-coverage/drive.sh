#!/usr/bin/env bash
# usage: drive.sh <tier> [k] [arms] [tasks]; arms: base = auto ; wc = auto + RA_WRITE_COVERAGE=1.
set -u
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/wc-ab
tier=$1; k=${2:-5}; arms=${3:-"base wc"}; tasks=${4:-rw-7,lh-debug-green}; slug=${tier//:/-}
tag=ab; cellT=${CELL_T:-300}; margin=$(( cellT + 5 ))
if [ -n "$(git -C "$R" status --short packages ':!packages/ui-core' ':!packages/llm-provider/src/providers/gemini.ts' ':!packages/llm-provider/src/providers/litellm.ts' ':!packages/llm-provider/src/providers/openai.ts' ':!packages/llm-provider/tests' ':!packages/runtime/src/builder/build-effect/local-agent-tools.ts' ':!packages/runtime/src/engine/execute-result-assembly.ts' ':!packages/runtime/tests')" ]; then echo DIRTY; exit 3; fi
start=$(date +%s); cd "$R" || exit 4
for arm in $arms; do
  left=$(( 585 - ($(date +%s) - start) )); [ "$left" -lt 60 ] && { echo "[drive] out of wall"; exit 0; }
  export RA_ACT_OR_ANSWER=auto; unset RA_INPUT_COVERAGE RA_WRITE_COVERAGE
  [ "$arm" = wc ] && export RA_WRITE_COVERAGE=1
  log="$D/$arm-$tag-$slug.log"
  echo "CLEAN $(git -C "$R" rev-parse --short HEAD) arm=$arm WC=${RA_WRITE_COVERAGE:-0} $(date +%T)" >>"$log"
  timeout "$left" bun run "$D/run-wc.ts" --out "$D/$arm-$tag-$slug.json" --trace-root "$D/traces-$arm-$tag-$slug" \
    --tier "$tier" --k "$k" --budget-sec "$((left - 5))" --start-margin-sec "$margin" --cell-timeout-sec "$cellT" --task "$tasks" >>"$log" 2>&1
  echo "exit=$?" >>"$log"
  echo "[drive] $arm: $(/usr/bin/grep -a '^\[h3\] ran=' "$log" | tail -1)"
done
