#!/usr/bin/env bash
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/wc-ab
k=${2:-5}; arms=${3:-"base wc"}; tasks=${4:-rw-7,lh-debug-green}
for tier in $1; do slug=${tier//:/-}; done_all=1
  for arm in $arms; do last=$(/usr/bin/grep -a '^\[h3\] ran=' "$D/$arm-ab-$slug.log" 2>/dev/null | tail -1); case "$last" in *remaining=0) ;; *) done_all=0 ;; esac; done
  if [ $done_all = 1 ]; then echo "[loop] $tier DONE"; ollama stop "$tier" 2>/dev/null; continue; fi
  echo "[loop] $tier pass $(date +%T)"; timeout 590 bash "$D/drive.sh" "$tier" "$k" "$arms" "$tasks"; exit 0
done
echo "[loop] ALL DONE"
