#!/usr/bin/env bash
# Memory snapshot for dev-machine OOM triage. Read-only: never kills or deletes anything.
#   bash scripts/mem-watch.sh            one snapshot
#   bash scripts/mem-watch.sh --watch    repeat every 10 s (Ctrl-C to stop); warns below WARN_GB
# Shows MemAvailable, RAM-backed temp usage, top RSS processes and models loaded in ollama.
set -u
WARN_GB="${MEM_WATCH_WARN_GB:-3}"

snapshot() {
  echo "== $(date '+%H:%M:%S') =="
  if [ -r /proc/meminfo ]; then
    avail_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
    total_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
    echo "MemAvailable: $((avail_kb / 1048576)) GB of $((total_kb / 1048576)) GB"
    if [ "$avail_kb" -lt $((WARN_GB * 1048576)) ]; then
      echo "WARN: MemAvailable below ${WARN_GB} GB; stop heavy processes before the kernel picks a victim"
    fi
  else
    echo "MemAvailable: n/a (no /proc/meminfo; Linux only)"
  fi
  tmp="${TMPDIR:-/tmp}"
  df -h "$tmp" | awk 'NR==2 {print "temp (" $1 "): " $3 " used of " $2 " (" $5 ")"}'
  echo "top RSS processes:"
  ps -eo rss=,pid=,comm= --sort=-rss 2>/dev/null | head -8 | awk '{printf "  %5d MB  pid %s  %s\n", $1 / 1024, $2, $3}'
  if command -v ollama >/dev/null 2>&1; then
    echo "ollama loaded models:"
    ollama ps 2>/dev/null | sed 's/^/  /' || echo "  (ollama not reachable)"
  fi
  echo "next: bun run repo janitor   # reap leaked test temp dirs"
}

if [ "${1:-}" = "--watch" ]; then
  while true; do snapshot; sleep 10; done
else
  snapshot
fi
