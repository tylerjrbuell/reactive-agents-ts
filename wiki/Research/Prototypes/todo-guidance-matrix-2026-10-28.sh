#!/bin/bash
# resumable. usage: matrix.sh DEADLINE_SECONDS [MAXREP]. results -> $D/tg-results.jsonl
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp; R=$D/tg-results.jsonl; touch $R
ROOT=/tmp/ra-tg-pin
P=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Research/Prototypes/todo-guidance-probe-2026-10-28.ts
end=$(( $(date +%s) + $1 )); MAXREP=${2:-2}
cd /tmp
for rep in $(seq 0 $MAXREP); do for model in cogito:14b qwen3:14b; do for task in W1 W2 N3 L4 C5; do for arm in A0 A1 A2 A3; do
  grep -q "\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep," $R && continue
  left=$(( end - $(date +%s) )); [ $left -lt 250 ] && exit 0
  line=$(timeout 240 bun run $P $ROOT $model $task $arm $rep 2>/dev/null | grep '^CELL ' | sed 's/^CELL //')
  [ -z "$line" ] && line="{\"arm\":\"$arm\",\"model\":\"$model\",\"task\":\"$task\",\"rep\":$rep,\"correct\":false,\"consistent\":false,\"used\":false,\"err\":\"cell-timeout-240s\",\"timeout\":true}"
  echo "$line" >> $R
done; done; done; done
