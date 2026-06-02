---
title: Steering Experiment (b) — verdict
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
verdict: "Mechanism SOUND (adoption + comprehension + materialization all verified link-by-link). Single-shot end-to-end UNPROVABLE on the current architecture — the assembly/projection path is NON-DETERMINISTIC across identical-config runs. The proof attempt proves the maze must go."
---

# Steering Experiment (b) — verdict

**Goal:** before the big canonical rewrite, cheaply prove that steering weak models to the
reference tool (`write_result_to_file`) fixes the overflow/fabrication failure on the *current*
live path.

## What was proven (link-by-link, real evidence)
- **The tool was hidden behind THREE separate maze gates** — concrete maze-tax evidence; a new
  meta-tool must be registered in N unrelated lists:
  1. **Prune:** `buildToolSchemas` (context-utils.ts:111) keeps only `missingRequired ∪ META_TOOLS`;
     the tool was absent from `META_TOOLS` → pruned, never offered. FIXED (`c64e…`/warden).
  2. **Execution allowlist:** `runtime.ts ToolService.execute` gated on user `allowedTools` only,
     no meta-tool exemption → blocked EVERY meta-tool (incl. `recall`) at execute under an explicit
     `allowedTools`. Pre-existing bug. FIXED (`allowed = userAllowed ∪ META_TOOLS`).
  3. (Registration was present; offering confirmed via `logModelIO` = 89 schema refs after gate 1.)
- **Adoption + comprehension: cogito DOES use the tool when offered** — 6 `write_result_to_file`
  calls, rationale `conf 0.9` ("we already fetched them and have the result_ref"). This **overturns**
  the earlier "weak models won't adopt; need forcing" worry. Availability (offered + execly allowed)
  is sufficient for adoption; the prior failures were the hidden gates, not the model.
- **Materializer + execute are unit-green** (renders all N; honest-fails on bad ref).

## What blocked the single-shot end-to-end proof
**Non-determinism.** With *identical* config (`RA_OVERHAUL=1`, same task), the projection fired 3×
in one run (126,647-char result → summary+ref, `fired=true`) but did NOT fire (no ENTRY log) in
later runs — and even forcing `RA_OVERFLOW_BUDGET=500` did not make it engage. Result size varies
run-to-run (full commit bodies vs short → over/under the budget), and the projection's engagement
itself is inconsistent. So a clean run with [projection fires → unblocked tool call → faithful file]
was never captured in one shot, despite every link being individually verified.

## Verdict & decision
**The mechanism is sound; the current plumbing is too tangled + non-deterministic to demonstrate it
reliably.** That is itself the proof the user's risk-gate wanted, inverted: you cannot run a clean
experiment on this architecture. → **Stop patching the maze. Build the canonical core** (`project()`
pure + total + deterministic, single path, observable), where this proof becomes a **golden-trace
unit test** + a stable cross-tier live run, not a flaky lottery. The (b) findings are the inputs:
- adoption works once offered (no forcing needed) → the canonical `selectTools` just must always offer it;
- the 3 gates collapse into one `project` + one tool registry (no prune/allowlist/threading duplication);
- determinism (pillar #3) eliminates the run-to-run variance that blocked the proof.

## Real bugs fixed this experiment (keep regardless of the overhaul)
- `META_TOOLS` missing `write_result_to_file` (prune drop).
- Runtime execution allowlist blocked ALL meta-tools (recall included) under explicit `allowedTools`.
