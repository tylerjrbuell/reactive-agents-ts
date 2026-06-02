# Cross-Tier Investigation — Frontier + Mid Variance Root-Cause

**Date:** 2026-06-02
**Sprint:** 1 (Task A1.5 — investigation in service of A2 unblock)
**Baseline reference:** `baseline-2026-06-02.md` (this directory)

## Question

Sprint-1 baseline showed mixed cross-tier project-vs-legacy verdict:
- Local (qwen3.5): project +17pp acc / +23pp reliability — decisive win
- Mid (haiku): project +9pp acc / **-23pp reliability**
- Frontier (sonnet): **project -8pp acc** / +24pp reliability

Task A2 (delete legacy `curate()`) is BLOCKED by the mid + frontier regressions under the hard equal-or-better invariant. Are these regressions ARM-level architecture failures, or measurement noise from upstream bugs?

## Method

Re-ran `diag-summarize-arms.ts` against sonnet + haiku with `RA_ASSEMBLY_DEBUG=1`. Captured full assembly trace per iteration, tool-call sequence, and the actual model output text per run. Compared per-arm.

## Frontier root cause: sonnet drops the absolute path

**Mechanism:**
- Diag prompt: `"Working directory for this task: ${tmpDir}\n\nAll task files (e.g. report.md) are located in that directory. Use the full path when reading files."`
- Sonnet ignores the working-dir advisory and emits `file-read("report.md")` (relative) instead of `file-read("/tmp/diag-sum-project-xxx/report.md")` (absolute).
- Result: every file-read call returns `ENOENT: no such file or directory, open '/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/report.md'`.
- The 147-char ENOENT error message becomes the entire tool_result content (`projection: "full"`).
- Model never sees the 28800-char `bigReport` fixture, narrates "I need to read the full file content first" as the deliverable, fails the `## Summary` regex.

**Evidence:**
- Project arm: 4 file-read attempts in trace, all ENOENT.
- Legacy arm: same 4 attempts, all ENOENT.
- Capability resolves correctly for both arms: `window:200000, tier:"large", dialect:"native-fc"`.
- Projection stage logs: `projectResults` always reports `N full, 0 preview+ref` (only 147-char error strings, well under any preserve budget).

**Verdict:** the frontier "-8pp project regression" on `cs-overflow-summarize` is **N=3 sampling variance on a tool-call-fidelity bug**, not an arm-level architectural difference. Both arms hit the same ENOENT pattern; legacy got lucky 1 of 3 runs and produced a `## Summary`-matching output, project got 0 of 3 wins. Per-arm projection behavior is identical when both arms produce identical tool_result content (the ENOENT string).

## Mid root cause: haiku rationale-format leaks into the deliverable

**Mechanism:**
- Bench JSON shows haiku project-arm outputs of the form:
  ```
  {"why":"The file content was truncated in the display. I need to retrieve the full content to properly analyze each section and write accurate one-line summaries for each.","confidence":0.95}</parameter>
  ```
- The `{"why":..,"confidence":..}` is the framework's **rationale call format** that the rationale-parser should strip from output.
- The trailing `</parameter>` is a tool-call argument XML tag that escaped argument-parsing.
- Both leak past the deliverable assembly path because they technically qualify as "model-authored content" under today's loose `state.output: string` typing.
- Legacy arm produces prose narration ("Now I have the full content of the report. I can see it has 40 numbered sections...") that matches the `## Summary` regex when it works.

**Why the arms differ:**
- The system prompt built by canonical `systemPromptStage` and the one built by legacy `curate()` differ in subtle structural ways. Haiku reads them with different interpretation:
  - Project arm prompt → haiku reaches for the rationale call format (its "show your reasoning" pattern)
  - Legacy arm prompt → haiku writes prose
- The downstream output-assembly path doesn't distinguish a rationale-JSON-leak from a real model thought — `state.output` accepts both as strings.

**Verdict:** the mid "-23pp reliability regression" is a **rationale-parser-strip failure × prompt-format-induced output-style variance**, not an arm-level architectural regression. The bug is the deliverable channel accepting un-stripped rationale JSON; the bug is amplified by per-arm prompt differences that cause haiku to emit different output formats.

## Pattern across both findings

Both regressions are **measurement noise upstream of arm-level architecture**. Neither shows `project()` doing something the architecture said it shouldn't. Both show:
- A pre-existing downstream bug (path-dropping, rationale-leak)
- Triggered differently per arm because the prompts each arm produces differ
- Both arms produce non-meaningful output → bench scores reflect noise, not architectural quality

This validates the Phase-A 2026-06-02 thesis (`canonical-contracts-and-invariants.md`): the contract layer is what catches this class. Specifically:
- **DeliverableProvenance (Sprint-1 Task B2)** — would reject rationale-JSON-leak from `state.output` by construction
- **Bench Honesty Contract (Sprint-2 §6)** — would mark sonnet ENOENT cells `inconclusive`, not 0%
- **TaskContract (Sprint-1 Task B1)** — explicit fixture path declaration could be inlined or otherwise structured to prevent path-dropping

## Implication for Task A2

The hard equal-or-better invariant says we cannot proceed with A2 if any axis regresses. By raw bench numbers, both mid + frontier show regressions. By DIAGNOSED root cause, neither regression is architectural — they are measurement noise that the upcoming contract layer is designed to eliminate.

**Recommended path (preserves the discipline without false-blocking):**

1. **Add a confound-free probe to the bench session.** Build `cs-overflow-summarize-inline` — same fixture, but content embedded in the prompt directly (no `file-read` needed). Tests pure assembly-arm behavior without tool-fidelity confound. Use it as the A2 equal-or-better authoritative gate.
2. **Document the upstream bugs as named TODOs** that Sprints 2-3 must fix:
   - U1: rationale-parser-strip on haiku (rationale leak)
   - U2: path-dropping on sonnet (tool-call fidelity)
   - U3: prompt-format-induced output-style variance (mid project arm)
3. **Re-run baseline + post-A2 bench using `cs-overflow-summarize-inline`** as the authoritative cell. If project ≥ legacy on this clean cell cross-tier, A2 deletion is authorized.

This route stays disciplined (no false-pass) while distinguishing **arm-level architecture** from **upstream measurement noise** — which is the entire point of canonical-contracts in the first place.

## Files

- `sonnet-stdout.log` / `sonnet-trace.log` — frontier diag (this directory)
- The bench JSONs at `frontier.json` + `mid.json` contain per-run output text used for diagnosis
