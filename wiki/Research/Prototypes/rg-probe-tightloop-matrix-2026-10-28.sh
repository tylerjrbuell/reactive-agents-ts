#!/bin/bash
# resumable. usage: run-matrix2.sh DEADLINE_SECONDS
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp; R=$D/results2.jsonl; touch $R
end=$(( $(date +%s) + $1 ))
cd /tmp
for rep in 0 1 2; do for model in qwen3:14b gemma4:12b; do for task in T1 T2; do for arm in before after; do
  grep -q "\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep," $R && continue
  left=$(( end - $(date +%s) )); [ $left -lt 200 ] && exit 0
  line=$(timeout 180 bun run $D/rg-probe2.ts /tmp/ra-rg-probe/$arm $model $task $arm $rep 2>/dev/null | grep '^CELL ' | sed 's/^CELL //')
  [ -z "$line" ] && line="{\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep,\"pass\":false,\"err\":\"cell-timeout-180s\",\"trips\":0,\"toolCalls\":0,\"timeout\":true}"
  echo "$line" >> $R
done; done; done; done
