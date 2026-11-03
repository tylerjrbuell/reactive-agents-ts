#!/bin/bash
# usage: run.sh MODEL POSTURE REPS... ; appends CELL lines to results.jsonl
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
M=$1; P=$2; shift 2
for i in "$@"; do
  GO=""; [ "$P" = "planGO" ] && GO=1
  PP=$P; [ "$P" = "planGO" ] && PP=plan
  timeout 140 bun run $R/wiki/Research/Prototypes/plan-posture-probe-2026-10-29/probe.ts $R $M $PP $i $GO 2>/dev/null | grep '^CELL ' >> $R/wiki/Research/Prototypes/plan-posture-probe-2026-10-29/results.jsonl || echo "{\"model\":\"$M\",\"posture\":\"$P\",\"rep\":$i,\"timeout\":true}" | sed 's/^/CELL /' >> $R/wiki/Research/Prototypes/plan-posture-probe-2026-10-29/results.jsonl
done
