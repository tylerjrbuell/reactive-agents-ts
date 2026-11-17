#!/usr/bin/env bash
# Cortex compliance gate (owner decision 2026-11-12).
#
# Why: apps/cortex was outside every ledger (check-string-errors, check-type-escape-hatches,
# check-file-size and the cast ceilings cover packages/*/src only) and absorbed nearly all of
# 2026-11-12's new violations (audit wiki/Research/Audit-Reports-2026-11-12/01-golden-rule-compliance.md,
# finding L1). Cortex is an edge app on Bun/Elysia, so raw `await` at route and handler edges is
# allowed and not counted; the rest of CODING_STANDARDS.md applies. The rules are written up in
# apps/cortex/AGENTS.md ("Compliance gates").
#
# Same ledger law as check-string-errors.sh / check-file-size.sh: every counter is pinned at its
# measured value; growth FAILS and shrink FAILS until the baseline is edited down, so a cleanup
# always shows up as a visible, reviewable ledger edit and the numbers only move down.
#
# Metrics. Scan = non-test .ts under server/ (server/tests and *.test.ts excluded); the UI rows
# scan non-test .ts and .svelte under ui/src. Comment lines and trailing `// ...` are dropped
# before matching, so prose never counts (a regex scan, not an AST; the number is a direction).
#   ANY            any / as any / <any> / @ts-ignore / @ts-expect-error (server, ui)  - target 0
#   AS_UNKNOWN_AS  `as unknown as` casts                                              - typed helper at 2+
#   NEW_ERROR      `new Error(` string errors; service-boundary failures use a tagged
#                  error from server/errors.ts (model: ChatTurnFailedError)
#   INSTANCEOF     `instanceof *Error` identity checks
#   CONSOLE        console.* outside server/cortex-log.ts; log through cortexLog        - target 0
#   PROCESS_ENV    process.env outside server/env-config.ts; new reads go through cortexEnv
#   BUN_SQLITE     `from "bun:sqlite"` imports (existing ones baselined; new ones forbidden)
#   file size      server/ and ui/src files at or above 800 LOC are pinned in SIZE_LEDGER
#
# Usage: bash scripts/check-cortex-compliance.sh [CORTEX_DIR] [--measure]
#   CORTEX_DIR  the apps/cortex tree (default <repo>/apps/cortex); the self-test points it at a
#               /tmp fixture tree.
#   --measure   print the measured numbers and exit 0 (used to capture baselines).
#
# Rides `bun run repo check` (tools/repo/checks.json id check-cortex-compliance); pinned
# red-on-cut by apps/cortex/server/tests/check-cortex-compliance.test.ts.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORTEX_DIR="$ROOT/apps/cortex"
MEASURE=0
for arg in "$@"; do
  case "$arg" in
    --measure) MEASURE=1 ;;
    *) CORTEX_DIR="$arg" ;;
  esac
done
GIANT_BAR=800

# RATCHET: every value may only SHRINK, by deliberate edit, with the reducing change citing the
# cleanup. Captured 2026-11-12 (tree @ f8ed1768b + the cortex-compliance-gates mission).
#
# Edit history:
#   2026-11-12 captured. Same-day cleanups before capture: 7 `as any` removed (agents.ts x2,
#     queries.ts, tool-playground-invoke.ts, runner-service.ts x2, gateway-process-manager.ts),
#     the 4 repeated event casts in ingest-service.ts collapsed to one helper, the 9 string
#     errors added today converted to tagged errors, console.* routed through cortexLog.
SERVER_ANY_BASELINE=0
UI_ANY_BASELINE=0
SERVER_AS_UNKNOWN_AS_BASELINE=6
UI_AS_UNKNOWN_AS_BASELINE=4
NEW_ERROR_BASELINE=20
INSTANCEOF_BASELINE=38
CONSOLE_BASELINE=0
PROCESS_ENV_BASELINE=29
BUN_SQLITE_BASELINE=49

# path-relative-to-CORTEX_DIR:ceiling. Files at or above GIANT_BAR LOC that are not listed FAIL
# (new giants are forbidden at birth). Keep NO '#' characters inside the array literal: the
# self-test patches this block by regex.
SIZE_LEDGER=(
  "server/services/chat-session-service.ts:1453"
  "server/services/runner-service.ts:844"
  "server/api/chat.ts:839"
  "ui/src/lib/components/ChatPanel.svelte:899"
  "ui/src/lib/stores/chat-store.ts:826"
)

FAIL=0
fail() { echo "❌ check-cortex-compliance: $1"; FAIL=1; }

SERVER_FILES="$(find "$CORTEX_DIR/server" -name '*.ts' ! -name '*.test.ts' \
  -not -path '*/tests/*' -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | sort)"
UI_FILES="$(find "$CORTEX_DIR/ui/src" \( -name '*.ts' -o -name '*.svelte' \) ! -name '*.test.ts' \
  -not -path '*/node_modules/*' 2>/dev/null | sort)"

# SCAN-EMPTY guard: a gate that cannot fail is theater.
if [ -z "$SERVER_FILES" ]; then
  echo "❌ check-cortex-compliance: SCAN-EMPTY - no non-test *.ts under $CORTEX_DIR/server - a guard that cannot fail is theater."
  exit 1
fi

# Source lines of the given files with comment lines and trailing // comments removed.
code_lines() {
  [ -z "$1" ] && return 0
  printf '%s\n' "$1" | xargs awk '
    { l = $0 }
    l ~ /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
    { sub(/[[:space:]]\/\/.*$/, "", l); print l }
  ' 2>/dev/null
}

# Number of regex matches (-o, so two on a line count twice) in already comment-stripped code text.
# The code text of each file set is computed once (speed: this gate runs on every commit).
count_in() {
  printf '%s\n' "$2" | grep -oE "$1" 2>/dev/null | wc -l | tr -d ' '
}

ANY_RE='(\bas any\b|:[[:space:]]*any([[:space:]]*[]);,>=|&[]|$)|<any>|@ts-ignore|@ts-expect-error)'
SERVER_CODE="$(code_lines "$SERVER_FILES")"
UI_CODE="$(code_lines "$UI_FILES")"
# console.* and process.env are allowed in exactly one home file each: count the whole set, then subtract the home.
LOG_CODE="$(code_lines "$(printf '%s\n' "$SERVER_FILES" | grep '/server/cortex-log\.ts$')")"
ENV_CODE="$(code_lines "$(printf '%s\n' "$SERVER_FILES" | grep '/server/env-config\.ts$')")"
CONSOLE_RE='console\.(log|warn|error|info|debug)\('

SERVER_ANY=$(count_in "$ANY_RE" "$SERVER_CODE")
UI_ANY=$(count_in "$ANY_RE" "$UI_CODE")
SERVER_AS_UNKNOWN_AS=$(count_in 'as unknown as' "$SERVER_CODE")
UI_AS_UNKNOWN_AS=$(count_in 'as unknown as' "$UI_CODE")
NEW_ERROR=$(count_in 'new Error\(' "$SERVER_CODE")
INSTANCEOF=$(count_in 'instanceof (Error|[A-Za-z]*Error)' "$SERVER_CODE")
CONSOLE=$(( $(count_in "$CONSOLE_RE" "$SERVER_CODE") - $(count_in "$CONSOLE_RE" "$LOG_CODE") ))
PROCESS_ENV=$(( $(count_in 'process\.env' "$SERVER_CODE") - $(count_in 'process\.env' "$ENV_CODE") ))
BUN_SQLITE=$(count_in 'from "bun:sqlite"' "$SERVER_CODE")

# "<lines> <path>" for every scanned file, in one wc call (no per-file forks).
file_sizes() {
  printf '%s\n%s\n' "$SERVER_FILES" "$UI_FILES" | grep -v '^$' | xargs -r wc -l | grep -v ' total$'
}

if [ "$MEASURE" -eq 1 ]; then
  echo "SERVER_ANY=$SERVER_ANY UI_ANY=$UI_ANY SERVER_AS_UNKNOWN_AS=$SERVER_AS_UNKNOWN_AS UI_AS_UNKNOWN_AS=$UI_AS_UNKNOWN_AS"
  echo "NEW_ERROR=$NEW_ERROR INSTANCEOF=$INSTANCEOF CONSOLE=$CONSOLE PROCESS_ENV=$PROCESS_ENV BUN_SQLITE=$BUN_SQLITE"
  while read -r n f; do
    [ "$n" -ge "$GIANT_BAR" ] && echo "SIZE ${f#$CORTEX_DIR/}:$n"
  done < <(file_sizes)
  exit 0
fi

# ratchet <label> <measured> <baseline> <how to fix>
ratchet() {
  if [ "$2" -gt "$3" ]; then
    fail "$1 GREW to $2 (baseline $3). $4"
  elif [ "$2" -lt "$3" ]; then
    fail "$1 SHRANK to $2 but the baseline is still $3. Update the baseline to $2 (the ledger may only shrink by deliberate edit) - good work, now make it visible in the ledger."
  fi
}

ratchet "server any/@ts-ignore" "$SERVER_ANY" "$SERVER_ANY_BASELINE" "Type the value (a named type or unknown plus a guard); 'any' is forbidden in Cortex (CODING_STANDARDS.md)."
ratchet "ui any/@ts-ignore" "$UI_ANY" "$UI_ANY_BASELINE" "Type the value (a named type or unknown plus a guard); 'any' is forbidden in Cortex (CODING_STANDARDS.md)."
ratchet "server 'as unknown as'" "$SERVER_AS_UNKNOWN_AS" "$SERVER_AS_UNKNOWN_AS_BASELINE" "Add one typed helper that owns the cast (model: eventRecord in services/ingest-service.ts)."
ratchet "ui 'as unknown as'" "$UI_AS_UNKNOWN_AS" "$UI_AS_UNKNOWN_AS_BASELINE" "Add one typed helper that owns the cast."
ratchet "string 'new Error('" "$NEW_ERROR" "$NEW_ERROR_BASELINE" "Mint a Data.TaggedError in server/errors.ts (model: ChatTurnFailedError) - 'NEVER use throw new Error(msg)' (CODING_STANDARDS.md)."
ratchet "instanceof *Error" "$INSTANCEOF" "$INSTANCEOF_BASELINE" "Prefer _tag dispatch or a guard exported by the error's module over a new identity check."
ratchet "console.* outside cortex-log.ts" "$CONSOLE" "$CONSOLE_BASELINE" "Log through cortexLog (server/cortex-log.ts) so CORTEX_LOG and CORTEX_LOG_FILE apply."
ratchet "process.env reads outside env-config.ts" "$PROCESS_ENV" "$PROCESS_ENV_BASELINE" "Read the variable in server/env-config.ts (cortexEnv) or take an 'env' argument like listen-host.ts."
ratchet "bun:sqlite imports" "$BUN_SQLITE" "$BUN_SQLITE_BASELINE" "Take the database as a parameter typed by the existing modules; do not add new bun:sqlite imports."

# File-size ledger.
ledger_ceiling() {
  local entry
  for entry in "${SIZE_LEDGER[@]}"; do
    if [ "${entry%%:*}" = "$1" ]; then ceiling="${entry##*:}"; return 0; fi
  done
  return 1
}
SEEN=""
while read -r n f; do
  rel="${f#$CORTEX_DIR/}"
  if ledger_ceiling "$rel"; then
    SEEN="$SEEN $rel"
    if [ "$n" -gt "$ceiling" ]; then
      fail "$rel GREW to $n LOC (ceiling $ceiling). Put new behavior in a new module; the giant only wires it."
    elif [ "$n" -lt "$ceiling" ]; then
      fail "$rel SHRANK to $n LOC but the ceiling is still $ceiling. Lower the ceiling to $n in SIZE_LEDGER (remove the entry when it is under $GIANT_BAR)."
    fi
  elif [ "$n" -ge "$GIANT_BAR" ]; then
    fail "$rel is $n LOC (>= $GIANT_BAR) and not in SIZE_LEDGER. New giants are forbidden at birth: split it."
  fi
done < <(file_sizes)
for entry in "${SIZE_LEDGER[@]}"; do
  case " $SEEN " in
    *" ${entry%%:*} "*) ;;
    *) fail "SIZE_LEDGER lists ${entry%%:*} but the scan did not find it. Remove the entry (the file was deleted or moved)." ;;
  esac
done

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "✅ check-cortex-compliance: any $SERVER_ANY/$UI_ANY, as-unknown-as $SERVER_AS_UNKNOWN_AS/$UI_AS_UNKNOWN_AS, new-Error $NEW_ERROR, instanceof $INSTANCEOF, console $CONSOLE, process.env $PROCESS_ENV, bun:sqlite $BUN_SQLITE, ${#SIZE_LEDGER[@]} size-ledger files, all at baseline."
exit 0
