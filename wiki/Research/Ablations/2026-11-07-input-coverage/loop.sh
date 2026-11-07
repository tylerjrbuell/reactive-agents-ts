#!/usr/bin/env bash
# usage: loop.sh "<tier> <tier>..." [k] [arms] [tasks]   env: TAG, CELL_T, PASSES (default 30)
# Repeats drive.sh (each pass <= 590 s, foreground child) per tier until every arm's
# last run-h3 line says remaining=0, then stops that tier's model (ablation loaded it).
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-ic
k=${2:-3}; arms=${3:-"auto ic"}; tasks=${4:-rw-7,lh-debug-green,lh-enumerate-audit}; tag=${TAG:-lh}
for tier in $1; do
  slug=${tier//:/-}
  for pass in $(seq 1 "${PASSES:-30}"); do
    done_all=1
    for arm in $arms; do
      last=$(/usr/bin/grep -a '^\[h3\] ran=' "$D/$arm-$tag-$slug.log" 2>/dev/null | tail -1)
      case "$last" in *remaining=0) ;; *) done_all=0 ;; esac
    done
    [ $done_all = 1 ] && break
    echo "[loop] $tier pass $pass $(date +%T)"
    timeout 590 bash "$D/drive.sh" "$tier" "$k" "$arms" "$tasks"
  done
  echo "[loop] $tier DONE $(date +%T)"
  case "$tier" in gpt-*) ;; *) ollama stop "$tier" 2>/dev/null ;; esac
done
