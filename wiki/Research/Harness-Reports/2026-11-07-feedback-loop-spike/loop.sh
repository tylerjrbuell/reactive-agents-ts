#!/usr/bin/env bash
# usage: loop.sh "<tier>..." [k] [arms] [tasks] ; env TAG CELL_T. Stops when every arm says remaining=0 or ~MAXPASS.
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/shell-ab
k=${2:-3}; arms=${3:-"base shell"}; tasks=${4:-rw-7,lh-debug-green}; tag=${TAG:-ab}
for tier in $1; do slug=${tier//:/-}
  done_all=1
  for arm in $arms; do last=$(/usr/bin/grep -a '^\[h3\] ran=' "$D/$arm-$tag-$slug.log" 2>/dev/null | tail -1); case "$last" in *remaining=0) ;; *) done_all=0 ;; esac; done
  if [ $done_all = 1 ]; then echo "[loop] $tier DONE"; ollama stop "$tier" 2>/dev/null; continue; fi
  echo "[loop] $tier pass $(date +%T)"; timeout 590 bash "$D/drive.sh" "$tier" "$k" "$arms" "$tasks"; exit 0
done
echo "[loop] ALL DONE"
