#!/bin/bash
# resumable: skips cells already in results.jsonl. usage: run-matrix.sh DEADLINE_SECONDS
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp; R=$D/results.jsonl; touch $R
end=$(( $(date +%s) + $1 ))
cd /tmp
for rep in 0 1 2 3 4; do for model in qwen3:14b gemma4:12b; do for task in F S P; do for arm in before after; do
  grep -q "\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep," $R && continue
  left=$(( end - $(date +%s) )); [ $left -lt 260 ] && exit 0
  line=$(timeout 240 bun run $D/rg-probe.ts /tmp/ra-rg-probe/$arm $model $task $arm $rep 2>/dev/null | grep '^CELL ' | sed 's/^CELL //')
  [ -z "$line" ] && line="{\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep,\"pass\":false,\"err\":\"cell-timeout-240s\",\"trips\":0,\"toolCalls\":0,\"timeout\":true}"
  echo "$line" >> $R
done; done; done; done
