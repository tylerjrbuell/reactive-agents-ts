---
title: Phase 4 — cross-tier A/B grid + legacy-builder deletion gating
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
status: COMPLETE (grid run, verdict landed)
verdict: "DO NOT DELETE legacy builders. Block stands on two independent legs, either sufficient: (1) ARCHITECTURAL — defaultContextCurator + buildStaticContext are public API (mandate keeps it); non-reactive strategies (plan-execute/ToT/reflexion) assemble via a separate path the project() seam does not cover. (2) EMPIRICAL — on the overflow+summarize task, =1 (project) REGRESSES vs =0 (legacy) on mid tier: legacy 2/2 success with a faithful summary at 4250 tok; project 0/2 (summary+ref strips content to a bare reference → mid model can't recover it → loop → max_iterations). Compact = parity (=1 succeeds everywhere, cross-tier). No-regression bar NOT cleared. MCP-unblocking was necessary but not sufficient. Phase 5 (write_result_to_file) does NOT rescue this — see verdict §."
---

# Phase 4 — A/B grid + deletion gating

## Sequencing (locked, not a preference)
You cannot A/B a single arm. Deleting legacy removes the `RA_ASSEMBLY=0` control →
nothing to compare against. So: **grid first (prove), delete second (gated on the
result + the caller-map below).** The task sentence order ("delete… run grid") does
not reorder this.

## Pre-run corrections (read the wire, don't infer — recurring trap)
1. **dist staleness.** bun resolves `@reactive-agents/reasoning` from `dist/index.js`
   (the `"bun"` export condition → `./dist/index.js`), NOT src. The on-disk dist was
   built between `488daf34` and `34dc70cf` — it had the RA_ASSEMBLY seam but was
   MISSING `sanitizeToolName` (MCP-name fix) and `RA_RECENCY_BUDGET_CHARS`. Any live
   run before `bunx turbo run build --filter=@reactive-agents/reasoning` tests stale
   code. **Always rebuild reasoning before live overhaul runs.** (Memory lesson, re-confirmed.)
2. **Seam fires on REACTIVE only.** adaptive picked `plan-execute-reflect` for the
   overflow task → 0 RA_ASSEMBLY_TRACE lines. The seam lives in kernel `think.ts`;
   plan-execute/ToT/reflexion make their own planning LLM calls (`plan-prompts.ts`),
   not through the curate seam. Added `SPOT_STRATEGY` knob to spot-test; the grid pins
   `reactive` so both arms hit the seam → clean isolation of curate-vs-project.

## Overflow is hard to trigger at the real budget (the advisor's warning, validated)
recencyBudgetChars(mid) = floor(32768 * 0.35 * 4) = **45875**. Four realistic vehicles
were refuted as overflow triggers:

| Vehicle | Returned | Why it doesn't overflow |
|---|---|---|
| `github/get_file_contents` (MCP) | **81 chars** | Returns a resource/SHA descriptor (`successfully downloaded text file (SHA:…)`), not inline content. RA does not inline MCP embedded resources. |
| `github/list_commits` (MCP) | **8534 chars** | Server-capped even at `perPage=100`. < budget. |
| `file-read` abs path | **161 chars (ENOENT)** | Model rebased the absolute path to cwd (`apps/examples/AGENTS.md`) → file not found. file-read resolves relative to cwd. |
| `file-read ./overflow-fixture.md` (57k local fixture) | **57282 chars** | ✅ **DOES overflow** → `0 full, 1 summary+ref` LIVE, no knob. |

⟹ Built-in `file-read` of a 57k local fixture (`apps/examples/overflow-fixture.md`,
copy of AGENTS.md) is the deterministic overflow vehicle — no MCP, no network, no
server cap.

### CORRECTION (post-grid): overflow does NOT fail in both arms — it is the DECISIVE cell
A pre-grid note here claimed "both arms broken on overflow pending Phase 5." **The grid
REFUTES that.** Legacy (=0) succeeds 2/2 on mid overflow with a faithful summary; project
(=1) fails 0/2. So overflow is not a set-aside cell — it is where the blocking regression
lives. The corrected mechanism:

- **Legacy (=0)** keeps a **compressed-preview inline** (`[file-read result — compressed
  preview]`, ~10k of the 57k). Content stays *visible* → the model summarizes it passively.
  Wire-verified: the written summary covers every real AGENTS.md section (28+ packages, the
  warden pilot dates, 24 skills, the Architecture Debt table) — faithful, 4250 tok, 9 steps.
- **Project (=1)** `ResultStore.summarize()` **strips content** to a bare reference and steers
  to `write_result_to_file(result_ref, path)`. Content must be *actively recovered* → the mid
  model loops on recall/find and never produces a deliverable (0/2, max_iterations).

**Phase 5 does NOT rescue this.** `write_result_to_file` copies the stored blob to a file —
it cannot produce a *summary*; the model must SEE the content to summarize it. The fix is a
**content-preview projection mode** in project() (what legacy's compressed-preview already
does), keyed to deliverable type: *read-the-content* (summarize/analyze → keep a preview)
vs *act-by-reference* (transcribe/copy → bare ref + write_result_to_file). This is pillar #6
of the canonical spec ("per-result full|summary+ref|cleared, system-decided") proven
incomplete: summary+ref alone is insufficient; a fourth mode is needed. The reference-protocol
spike (`2c5d77bf`) validated act-by-reference; THIS grid tested summarize, where bare-reference
is the wrong projection.

## Revised pass bar (overflow-lift downgraded)
The advisor's earlier "overflow-lift" framing was over-weighted — natural overflow is
genuinely rare at 45875 chars, so on the common case project() and curate() produce
near-identical threads. Revised:
- **PRIMARY: no-regression.** `=1` matches `=0` on success / faithfulness / tokens,
  cross-tier including local. That is what justifies the deletion — nothing is lost.
- **Overflow-correctness** is already proven deterministically (golden-trace
  byte-identical ×3, `181afdf2`; + the RA_RECENCY_BUDGET_CHARS knob). One live overflow
  cell end-to-end confirms the branch lives; not required grid-wide.
- **Honest reporting:** if no live metric *lift* exists, the benefit case is
  determinism + killing the marker/recall indirection (architectural), NOT a gamed lift.

## Grid design
`apps/examples/assembly-ab-grid.sh`: arms {0,1} × tasks {compact, overflow} × tiers
{local=ollama qwen3.5, mid=anthropic haiku} × RUNS=2 = 16 cells. Sources repo-root
`.env` (keys never printed). compact=`github/list_commits` (≈8534c, projects full on
both arms = the clean comparison). overflow=`file-read` 57k fixture. SPOT_STRATEGY=reactive.

## Deletion gating — caller-map (deletion is NOT a clean Phase-4 cut)
Live reactive chain: `think.ts:353 → defaultContextCurator.curate → ContextManager.build
→ buildConversationMessages | buildCuratedMessages`. project() (=1) replaces ONLY the
`curate` call at think.ts.

Blockers to deleting the builders:
1. **Public API.** `defaultContextCurator` (index.ts:125, context/index.ts:25) and
   `buildStaticContext` (index.ts:111, context/index.ts:13) are exported. The overhaul
   mandate KEEPS the public API.
2. **Non-reactive strategies use a separate assembly path.** plan-execute / ToT /
   reflexion / code-action import `withEnvContext` from context-engine and run their own
   planning LLM calls via `plan-prompts.ts` + `buildStaticContext` — NOT the curate seam.
   project() does not yet cover these paths. Deleting the curate→ContextManager chain
   would not break reactive (=1 replaces it) but the builders/static-context remain
   referenced by the non-reactive paths.
⟹ A full delete requires project() to cover ALL strategies' assembly (or proof they
don't need the legacy builders) — a larger effort than a Phase-4 cut. The seam-collapse
touches kernel `think.ts` → **kernel-warden**; the one-way cut needs an `advisor()` pass.

## Grid results (16 cells: 2 arms × {compact, overflow} × {local qwen3.5, mid haiku} × RUNS=2)
`/tmp/assembly-ab-grid-main/grid.jsonl`. success / goal / tokens(total) / steps:

| cell | =0 (legacy curate) | =1 (project) |
|---|---|---|
| local · compact | ✅✅ 17568, 19575 tok | ✅✅ **8920, 9221 tok** |
| mid · compact   | ✅✅ 12858, 13940 tok | ✅✅ 14621, 14610 tok |
| local · overflow| ✅ 24307 / ❌ **84779 runaway** | ✅✅ 8663, 13270 tok |
| mid · overflow  | ✅✅ **4250, 4317 tok (faithful)** | ❌❌ 21147, 21340 (recall/find loop) |

Reading:
- **Compact = parity.** =1 succeeds everywhere, no success/goal regression cross-tier.
- **Compact tokens are NOT a clean assembly delta** — confounded by meta-tool choice
  (=0 cells called `discover-tools`, =1 called `brief`). Do not claim the local −50% /
  mid +10% as pure assembly cost.
- **Overflow = mixed, project regresses on mid.** Legacy ran away once on local (84k);
  project failed 0/2 on mid. Neither arm dominates → "project is broken" is the WRONG
  read. The correct read: **the no-regression bar is not cleared** (=1 < =0 on mid
  overflow-summarize).

## VERDICT — DO NOT DELETE legacy builders
Two independent legs, either sufficient on its own:

1. **Architectural.** `defaultContextCurator` + `buildStaticContext` are public API
   (mandate preserves it). plan-execute / ToT / reflexion assemble via a separate
   path (`plan-prompts` + `buildStaticContext` + their own planning LLM calls) that
   `project()` does NOT cover. The seam replaces ONLY the reactive `think.ts` curate
   call. Deleting the builders would break the non-reactive paths.
2. **Empirical.** =1 regresses vs =0 on mid overflow-summarize (0/2 vs 2/2). project()'s
   summary+ref strips content the model still needs to read.

**MCP-unblocking (34dc70cf) was necessary but not sufficient** to unblock deletion.
Leave all legacy builders in place. RA_ASSEMBLY stays flag-gated (default off).

## What would unblock a future deletion (not this turn)
- A **content-preview projection mode** in project() (4th mode, deliverable-type keyed)
  so overflow+summarize keeps visible content like legacy does — close the mid regression.
- `project()` wired into the non-reactive strategy assembly (plan-execute/ToT/reflexion),
  or proof they don't need the legacy builders.
- Keep `defaultContextCurator`/`buildStaticContext` exports (public-API mandate) even if
  internals are re-pointed at project().
- Seam-collapse touches kernel `think.ts` → **kernel-warden**; the one-way cut → `advisor()` first.

## Artifacts (this turn, branch overhaul/agentic-core-2026-05-31)
- `apps/examples/spot-test.ts` — `SPOT_STRATEGY` knob (pin strategy so the A/B isolates one think path).
- `apps/examples/assembly-ab-grid.sh` — the cross-tier grid runner (sources root .env, keys never printed).
- `apps/examples/overflow-fixture.md` — 57k local fixture (copy of AGENTS.md) for deterministic overflow. Untracked test artifact.
- No kernel/src deletions. No production behavior change. dist rebuilt (untracked).
