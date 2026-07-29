# Task 10 Report — the gate script, CI wiring, docs + register + memory sync

(Note: this file previously held an unrelated Task 10 report from the Agentic-UI-Kit plan
— superseded here; this is the cross-cutting-cascade plan's Task 10, the final task.)

**Commit:** `fd2ffd41` (chore(gates): check-cross-cutting.sh wired into CI + register/docs sync)
Branch: `cross-cutting-cascade`, parent `c5d225cd` (Task 9).

## Step 1 — the script, verified against the real tree

Wrote `scripts/check-cross-cutting.sh` following the brief's three checks, in the repo's
established `check-*.sh` idiom (ALLOWED/GRANDFATHERED arrays, `EXCLUDE` pattern, OK/FAIL
messaging) rather than the brief's bare skeleton. Verified each check's grep pattern against
the actual Task 1–9 tree and corrected two of the three:

- **Check 1 (strategy re-declares an envelope field):** brief's pattern was fine as-is. Verified
  zero matches exist today (no `readonly` or non-`readonly` declarations of any of the 7 fields
  in `packages/reasoning/src/strategies`).
- **Check 2 (raw `KernelInput` literal outside sanctioned sites) — CORRECTED.** The brief's
  exclusion list only had `reactive.ts`/`direct.ts`/`build-kernel-input.ts`. Grepping the real
  tree turned up a genuine third site the brief missed:
  `kernel/loop/runner-helpers/strategy-switch.ts:231` — `const currentInput: KernelInput = { ...priorInput, priorContext, requiredTools }`.
  Read the file: this is the strategy-switch handoff — it spreads an **already-assembled**
  `priorInput` (envelope fields already merged by `runKernel`) and only overrides
  `priorContext`/`requiredTools`. It never hand-authors a cross-cutting field, so it is not the
  defect class this check exists to catch. Added it to `ALLOWED_KERNEL_INPUT_SITES` with a
  comment explaining why.
- **Check 3 (RunEnvelope provided at exactly 2 seams) — CORRECTED, the significant fix.** The
  brief's pattern was `grep -E "provideService(.*RunEnvelope|RunEnvelope.of("` — single-line only.
  The real production site in `services/reasoning-service.ts` is Prettier-wrapped:
  ```
  Effect.provideService(
    strategyFn({ ...params, config }),
    RunEnvelope,
    params.envelope ?? emptyRunEnvelope,
  );
  ```
  `RunEnvelope` lands alone on its own line — the brief's pattern would have matched **zero**
  lines here, silently failing to recognize the one sanctioned production seam (a false negative
  that happened not to also produce a false positive only by luck). Separately, naively
  broadening to match any bare `RunEnvelope,` line would have false-positived on `index.ts`'s
  re-export list (`export { RunEnvelope, ... }`) and on `import { RunEnvelope, ... }` lines.
  Fixed with an awk pass: a bare `RunEnvelope,` line only counts if it follows a `provideService(`
  line within 6 lines — this correctly catches the real production site and correctly ignores the
  export/import lines (verified both directions). Combined with the original same-line pattern
  (catches `provideTestEnvelope`'s single-line call), the two sanctioned seams are exactly what's
  found on the clean tree, nothing more.

Script is executable (`chmod +x`), uses `set -euo pipefail`, exits 0 on the clean tree today.

## Step 2 — red-on-cut, all three checks, verbatim

**Check 1** — added `readonly fabricationGuard?: string;` to `DirectInput` in `strategies/direct.ts`:
```
FAIL (1/3): strategy input interface re-declares a cross-cutting field
(the RunEnvelope is the only carrier):

packages/reasoning/src/strategies/direct.ts:44:  readonly fabricationGuard?: string;
...
Cross-cutting cascade invariant VIOLATED — see failures above.
EXIT: 1
```
Reverted (`cp` back from a pre-edit backup); re-ran clean → exit 0.

**Check 2** — added a throwaway file `kernel/__tmp_violation.ts` with
`const badInput: KernelInput = { task: "x" } as unknown as KernelInput;`:
```
FAIL (2/3): raw KernelInput literal outside the sanctioned assembly sites:

packages/reasoning/src/kernel/__tmp_violation.ts:2:const badInput: KernelInput = {
...
Cross-cutting cascade invariant VIOLATED — see failures above.
EXIT: 1
```
Deleted the file; re-ran clean → exit 0.

**Check 3** — added a throwaway file `kernel/__tmp_provision.ts` with a second, Prettier-wrapped
`Effect.provideService(effect, RunEnvelope, emptyRunEnvelope)` (the harder, multi-line case —
deliberately chosen to prove the corrected awk-based matcher actually works, not just the
same-line fallback):
```
FAIL (3/3): RunEnvelope provided outside the two sanctioned seams:

packages/reasoning/src/kernel/__tmp_provision.ts:7:     RunEnvelope,
...
Cross-cutting cascade invariant VIOLATED — see failures above.
EXIT: 1
```
Deleted the file; re-ran clean → exit 0. `git status --short packages/` confirmed no leftover
changes after each revert.

## Step 3 — wiring, verified at both consumption points

`grep -rn "check-ledger-writes" package.json .github/ scripts/` found **no explicit reference to
check-ledger-writes.sh by name anywhere** — it is wired by glob, not by name:
- `.github/workflows/ci.yml` "Enforce architectural invariants" step: `for s in scripts/check-*.sh; do bash "$s"; done`
- `packages/reasoning/tests/enforcement-scripts.test.ts`: `readdirSync(SCRIPTS_DIR).filter(f => f.startsWith("check-") && f.endsWith(".sh"))`, spawns and asserts exit 0 on every discovered script.

Dropping `check-cross-cutting.sh` into `scripts/` required **zero edits** to either wiring
file — both auto-discover it. Ran the CI glob loop locally and confirmed `check-cross-cutting.sh`
appears in the loop and passes. Then verified the wiring is *live*, not just structurally present:
temporarily replaced the script's body with `exit 1` and confirmed:
- The per-script exit-code capture loop (`for s in scripts/check-*.sh; do bash "$s"; rc=$?; ... done`) recorded `scripts/check-cross-cutting.sh -> exit 1` while all 9 others stayed 0.
- `bun test tests/enforcement-scripts.test.ts --timeout 15000` in `packages/reasoning` failed with `check-cross-cutting.sh FAILED (exit 1) — an architectural invariant is violated.` (10 pass / 1 fail).

Restored the real script; both checks went back to green (11/11 pass on the enforcement-scripts
suite; `bash scripts/check-cross-cutting.sh` exit 0).

(Note: an initial attempt to prove this via `set -e` inside a nested `(...)` subshell in this
tool's Bash environment did not propagate the failing exit code as expected — a harness/subshell
quirk, not a property of the actual CI script or test file. Switched to direct per-command exit-code
capture, which is unambiguous and is what's reported above.)

## Step 4 — records

- **DEBT-REGISTER §3:** the `TaskResult.metadata` hand-enumerated-literal row was already closed
  by Task 9 (`c5d225cd`) but didn't cite the hash — added `` `c5d225cd` `` to the closing
  annotation. The `normalizeReasoningResult`/`runLedger` row Task 9 logged was already present
  and already marked open/CONFIRMED — left as-is per instructions (real, unfixed). Added a new
  row to §6 ("the gates that keep it fixed") for `check-cross-cutting.sh`.
- **09-UNIFIED-PROGRAM.md §7:** added one blockquote line: cascade shipped 2026-07-23
  (`6813d973`..`c5d225cd`), C3 terminal judgment live at the mint, explicitly noting enforcement
  is opt-in only, the `taskContract` wither doesn't itself flip behavior, the
  plan-execute/code-action per-iteration repair gap, and the open `runLedger` drop — per the
  accuracy constraint, no overstatement.
- **`.agents/MEMORY.md`:** added one entry at the top (matching the file's dense single-bullet
  style) covering the defect class (a run-wide field named by hand at N boundaries silently
  dropped wherever one is missed), the fix shape (ambient `RunEnvelope` + branded terminal mint
  + typed `extensions` metadata slot), the gate name, and the same accuracy caveats.
- **Claude project memory** (`~/.claude/projects/.../memory/MEMORY.md`): added the matching
  entry. The harness's size hook then required compacting the file (21.4KB → under 17.1KB);
  condensed older, already-topic-filed entries to one-liners (no information lost — each still
  links to its full topic file) down to 16.4KB.
- **`.superpowers/sdd/progress.md`:** added a T10 entry in the existing per-task ledger style,
  documenting the two grep-pattern corrections, the wiring verification, and final numbers.

## Step 5 — final verification, exact output

```
$ bunx turbo run build --force
 Tasks:    37 successful, 37 total
Cached:    0 cached, 37 total
  Time:    37.418s

$ bunx turbo run typecheck --force
 Tasks:    67 successful, 67 total
Cached:    0 cached, 67 total
  Time:    45.565s

$ cd packages/reasoning && bun test --timeout 15000
 2495 pass
 4 todo
 0 fail
 9192 expect() calls
Ran 2499 tests across 283 files. [5.18s]

$ cd packages/runtime && bun test --timeout 15000
 1314 pass
 1 skip
 0 fail
 2966 expect() calls
Ran 1315 tests across 229 files. [36.26s]

$ cd packages/core && bun test --timeout 15000
 190 pass
 0 fail
 355 expect() calls
Ran 190 tests across 27 files. [200.00ms]

$ bash scripts/check-cross-cutting.sh
OK (1/3): no strategy re-declares a cross-cutting envelope field.
OK (2/3): no raw KernelInput literal outside the sanctioned sites.
OK (3/3): RunEnvelope provided only at the two sanctioned seams.

Cross-cutting cascade invariants hold.
$ echo $? → 0

$ bash scripts/check-ledger-writes.sh
✅ RunLedger invariant holds — append API confined to kernel/ledger/ + the act.ts dual-emit seam.
$ echo $? → 0
```

## Files touched

- `scripts/check-cross-cutting.sh` (new, executable)
- `wiki/Architecture/DEBT-REGISTER.md`
- `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`
- `.agents/MEMORY.md`
- `.superpowers/sdd/progress.md`
- `~/.claude/projects/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/memory/MEMORY.md` (Claude project memory, outside repo — not part of the commit)

Two pre-existing dirty files unrelated to this task (`apps/docs/src/data/github-stats.json`,
`wiki/Research/Harness-Reports/integration-control-flow-scenario-health.json`) were left
untouched and out of the commit — they were already modified before Task 10 started.

## Concerns

None blocking. One thing worth flagging to the owner: check 3's awk-based multi-line matcher
uses a 6-line window heuristic (bare `RunEnvelope,` following a `provideService(` line). It is
verified correct against the current tree and against both a same-line and a multi-line injected
violation, but if a future refactor reformats the production call with a much larger gap between
`provideService(` and the `RunEnvelope` argument, the window may need widening — the script's
inline comment documents this explicitly for the next person who touches it.
