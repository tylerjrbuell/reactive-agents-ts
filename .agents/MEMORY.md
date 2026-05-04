# Reactive Agents Build Memory

> **Status:** Reset 2026-04-28 on `refactor/overhaul`. Prior version (564 lines of layered sprint logs) preserved at commit `949bf81f^` — recover via `git show <sha>:.agents/MEMORY.md` if a specific historical claim needs lookup.

## Read first

Before doing any work in this repo:

1. **`docs/spec/docs/PROJECT-STATE.md`** — current empirical state of the framework.
2. **`docs/spec/docs/AUDIT-overhaul-2026.md`** — the v0.10.0 overhaul plan. 28 packages + 13 mechanisms + 44-item FIX backlog + W0-W13 execution sequencing. **This is the single source of truth for what's broken, deferred, fixed, or shipping.** If anything in this memory file conflicts with the audit, the audit wins.
3. **`docs/spec/docs/00-RESEARCH-DISCIPLINE.md`** — 12 rules. Every harness change requires prior spike validation. No exceptions.

The full canonical doc set is listed in `docs/spec/docs/DOCUMENT_INDEX.md`.

---

## Current state (May 4, 2026)

- **Spike M4: Healing Pipeline Validation — COMPLETE:**
  - 4-stage healing pipeline (retry → reparse → interpolate → fallback) **validated** for FC error recovery.
  - Recovery rate: **86.7%** (13/15) — exceeds 60% threshold.
  - Accuracy improvement: **+80.0%** (6.7% → 86.7%).
  - Token efficiency: **90% savings** vs reprompt fallback (750 vs 7500 tokens per 15 calls).
  - Success by stage: tool-name 100%, param-name 100%, path-resolution 100%, type-coercion 100%.
  - Unrecoverable errors identified: missing required args (semantic), unknown tools (discovery needed), undefined aliases (addressable via CalibrationStore).
  - Evidence: `packages/tools/tests/m4-healing-pipeline.test.ts` (11 passing tests, 15-case dataset, 39 assertions).
  - Verdict: **M4 validated**. Ready for Phase 1 deployment with alias maps; Phase 2 adds CalibrationStore learning; Phase 3 adds fuzzy matching.

- **Spike M10: Memory System Validation (FM-F2) — COMPLETE:**
  - FM-F2 ("memory pollution across runs") is **mitigated** (not a practical risk) — task-scoped queries prevent false memory injection.
  - Recall accuracy: **66.7%** on verbose natural language, **100%** on key-term queries.
  - Accuracy lift: **+66.7pp** vs baseline (no memory context).
  - Memory overhead: **negligible** (0.05ms per entry, 4KB/100 entries).
  - **Key finding:** FTS5 keyword search requires query decomposition; verbose natural language queries fail (0% match) but focused key-term queries succeed (100% match). Recommendation: ship with key-term extraction preprocessing or Tier 2 semantic embeddings for robust multi-turn learning.
  - Evidence: `packages/memory/tests/m10-memory-system.test.ts` (7 passing tests, 16 assertions).
  - Debrief: `docs/superpowers/debriefs/M10-memory-system-validation.md`.
  - Audit update: Mark FM-F2 as **validated → mitigated** in `AUDIT-overhaul-2026.md §10` (was "unvalidated theoretical").

- **External channels phase 1 (branch `feat/channels-package`, merge pending):** package `@reactive-agents/channels`, runtime `.withChannels()`, gateway config rename `channels` → `accessControl`, webhook adapter + tests. Debrief: `docs/superpowers/debriefs/2026-05-03-channels-phase1-development-debrief.md`. **Mainline docs** (`apps/docs`, Starlight gateway pages) still describe `GatewayConfig.channels` until the branch merges.
- **Test runner snapshot (main workspace):** `bun test` → 4,701+ pass (verify after M10 commit); 23 skip across **536** files / **4,731+** tests (May 4); resolve failures before treating green as release truth.

### Earlier context (May 1, 2026)

- **v0.10.0 release-ready** — `refactor/overhaul` branch fully prepared; changeset + CHANGELOG + release doc written; 4,672 pass / 23 skip / 4 fail across 527 files (4 pre-existing failures in untracked `packages/benchmarks/parseDate.test.ts` — not regressions).
- **Branch:** `refactor/overhaul`. All prior `feat/*` branches archived as `archive/*` tags.
- **Published on npm:** all packages at `0.9.0`. Version bumps happen via changeset merge (`release-0-10-0.md` covers all 28 packages + umbrella, `@reactive-agents/diagnose` included).
- **cf-23 gate fixed:** `required-tools-satisfied` was moved from verifier to `runner.ts §8`; scenario now tests `agent-took-action` + positive absence. Baseline regenerated with BASELINE-UPDATE trailer.
- **Architecture target:** `15-design-north-star.md` v3.0 (10 capabilities + cognitive kernel + 3 ports).
- **Pending before tag:** (1) Publish `@reactive-agents/diagnose` — confirmed 404 on npm (May 1). Ships via CI changeset workflow. (2) Eval Rule 4 frozen-judge — `packages/eval/src/runtime.ts` still uses same-codepath judge; blocks any published benchmark claim. Then: merge `refactor/overhaul` → `main`, run `changeset version`, publish.
- **Gateway chat mode shipped** (May 1): per-sender SQLite session history, 40-turn/8 k-char windowing, episodic context injection, daily compaction, mode-aware routing (`channels.mode: 'chat'|'task'`). Two memory bugs fixed: `priorContext` silently dropped (context-manager.ts) + episodic injection gated behind `enableSelfImprovement` (execution-engine.ts). New `pruneEpisodicLog` on `CompactionService`; `chat-turn` event type added. Key file: `packages/runtime/src/gateway-chat.ts`.
- **Frontier bench (W21, Apr 30):** ra-full 100% across 4 frontier models (claude-sonnet-4-6, claude-haiku-4-5, gpt-4o-mini, gemini-2.5-pro). Bare-llm 85%. Gemini W22 fix: walk `candidates[0].content.parts[]` directly; surface non-OK `finishReason` as explicit errors.

### Token Optimization (May 3, 2026)
- **rtk discover audit:** 529 sessions, 17K Bash commands analyzed. Only 18% use RTK prefix. **1.2M tokens saveable** from non-prefixed commands (grep 502K, cat 351K, git log 166K, find 99K, ls 73K).
- **Root cause:** Behavioral, not technical. RTK hooked globally but requires consistent prefixing in Claude Code.
- **Skill created:** `.agents/skills/token-optimization/SKILL.md` — TDD-tested (RED-GREEN-REFACTOR phases complete).
  - RED: 18% adoption baseline, hook nudges insufficient, LSP/smart-search missing globally, bun test/run unhandled
  - GREEN: Skill addresses rationalizations, fixes hook JSON quoting, promotes LSP/smart-search to global allowlist
  - REFACTOR: Bulletproof against 5 key rationalizations (optional-ness, friction avoidance, invisibility, mental model gaps, RTK gaps)
- **Fixes implemented:** (1) Corrected PostToolUse hook JSON (previous had quoting errors). (2) Global allowlist expanded to include LSP + smart-search tools. (3) Memory: `project_token_optimization_may3.md` documents discovery + implementation. (4) Skill: Full decision trees and loophole-closers documented.
- **Action:** Prefix Bash commands with `rtk` consistently. Use `claude-mem:smart-search` (tree-sitter AST) for codebase symbol queries instead of grep + read chains (60-75% savings). Create pre-session token dashboard if hook nudges aren't sustaining behavior.
- **Target adoption curve:** Month 1 (baseline), Month 2 (45% RTK usage), Month 3 (70%), Month 4 (85%, plateau).
- **Savings:** ~$1,200/month at current command rates if 1.2M tokens reclaimed. Monthly re-check via `rtk discover --history` to track progress.

**Resolved P0s (reference — do not resurface as blockers):**
- ~~Publish umbrella `reactive-agents` (404)~~ — ✅ W14: already published at v0.9.0; v0.10.0 via CI.
- ~~qwen3 thinking auto-enable~~ — ✅ W7: thinking is OPT-IN; `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226` returns `undefined` unless `configThinking === true`.
- ~~Dual compression uncoordinated~~ — ✅ W6: three stages sequenced (tool-execution stash → curator render → compress-messages patch); regression test in `context-curator.test.ts`.
- ~~9 termination paths, no single owner~~ — ✅ W4 (FIX-18): `kernel/loop/terminate.ts` is the single-owner helper; `kernel/capabilities/decide/arbitrator.ts` is the canonical oracle path.

---

## Working rules (cross-cutting feedback — keep applying)

- **No Co-Authored-By trailers in commits.** Shows publicly on GitHub contributors.
- **Commit before branching.** Always commit/stash exploratory changes before creating feature branches.
- **Keep `.agents/MEMORY.md` (this file) in sync with personal memory** so other AI agents have context.
- **Skip plans for content/skill writing.** No formal implementation plan for SKILL.md or doc tasks; implement directly.
- **Strict TypeScript — no `any` casts.** Use `unknown` + guards or proper types.
- **Don't `rm -rf` untracked dirs with content.** Confirm before deleting any `??` directory with >5 files; git can't recover untracked content. Cost: lost `wiki/` + 3 `obsidian-vault-*` skill modules on 2026-04-24 cleanup.
- **Workspace runs from `src/` under Bun.** Every `packages/*` declares `"bun": "./src/index.ts"` first in `exports`. Edits picked up at next `bun run`, no rebuild needed. Rebuild only for: (a) npm-publish validation, (b) Node-runtime consumers, (c) `.d.ts` refresh.
- **Control pillar — every harness primitive must be developer-overridable.** Vision Pillar 1. New behaviors ship with: `defaultFoo` preserving prior behavior, `KernelInput.foo?: FooHookType` injection field, public type export. Hardcoded harness logic = black box = anti-pattern.
- **Research discipline — spike-validated harness changes only.** Read `00-RESEARCH-DISCIPLINE.md` for the 12 rules. Notable: spike validates ONE mechanism × ONE failure-mode × ≤2 models × ONE task (Rule 11); single-spike findings shape the next spike, not harness-level decisions.

---

## Memory reconciliation — corrections from Stage 3 audit

Two prior memory entries are demonstrably stale or wrong. Do not propagate these in future memory:

| Stale claim | Actual state | Source |
|---|---|---|
| "3/6 skill lifecycle AgentEvents missing" | **Events exist** at `core/services/event-bus.ts:1001-1005`. **All 6 hooks wired** (W2 FIX-6) at `builder.ts:2673-2731`. This is fully resolved — do not resurface. | AUDIT §11 item 6, M6 mechanism; verified May 1 |
| "Calibration defaults to `:memory:`" | **Already correct** at `reactive-intelligence/types.ts:246` (`~/.reactive-agents/calibration.db`). Apr 21 fix. | AUDIT §11 item 9 |

Memory descriptions to update or rewrite if you encounter them in personal memory:
- `project_v010_audit_blockers` — both stale claims above appear here.
- `project_running_issues` — older entries; cross-reference against AUDIT §11 before acting on any item.

---

## Architecture summary (high signal, low detail)

**Kernel lives at `packages/reasoning/src/kernel/`** — reorganized in Stage 5 from `strategies/kernel/` to capability-grouped subdirs:
- `capabilities/` — 8 subdirs: act, attend, comprehend, decide (arbitrator.ts), reason (think.ts), reflect (loop-detector.ts, reactive-observer.ts), sense, verify
- `loop/` — runner.ts (1,706 LOC), react-kernel.ts, terminate.ts (single-owner termination helper), auto-checkpoint.ts, output-assembly.ts, output-synthesis.ts
- `state/` — kernel-state.ts, kernel-hooks.ts, kernel-constants.ts
- `utils/` — diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts

**Two records, distinct purposes:**
- `state.messages[]` — what the LLM sees (provider conversation thread)
- `state.steps[]` — what systems observe (entropy, metrics, debrief)

**FC conversation thread flow:**
1. Execution engine seeds `state.messages` with `[{role:"user", content: task}]`
2. `think.ts` reads messages → `applyMessageWindow` → provider LLM call
3. `act.ts` appends: `assistant(thought+toolCalls)` + `tool_result(s)` + progress/completion message

**Critical build patterns:**
- All providers pass `tools` to both `complete()` AND `stream()` methods
- Anthropic streaming: use raw `streamEvent` not helper events (`inputJson` fires before `contentBlock`)
- Gemini tool results: `functionResponse.name` must use `msg.toolName` not hard-coded "tool"
- Gemini streaming (W22): walk `candidates[0].content.parts[]` directly — `chunk.text` strips functionCall parts. Surface non-OK `finishReason` (UNEXPECTED_TOOL_CALL, MAX_TOKENS, SAFETY, MALFORMED_FUNCTION_CALL) as explicit errors.
- Ollama streaming: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- Loop detection: `maxConsecutiveThoughts: 3` — only ACTION steps reset the streak; observations do NOT. IC-1 fix Apr 12, now at `kernel/capabilities/reflect/loop-detector.ts:102`

---

## Architecture debt (current top items)

The full list lives in `AUDIT-overhaul-2026.md` §11 (44 items). Top items as of May 1:

1. **`builder.ts` 6,082 LOC + `execution-engine.ts` 4,499 LOC** — orchestration SHRINK targets.
2. **Eval Rule 4 frozen-judge** — `packages/eval/src/runtime.ts` uses same-codepath judge as SUT. Blocks any published benchmark claim. P0 before merge.
3. **ToT outer loop still unhooked** from `dispatcher-early-stop` — each branch is a separate sub-kernel (PER inner loop fixed Apr 19 at `plan-execute.ts:737,762`).
4. Strategy routing opt-in via `withReasoning({ strategySwitching: { enabled: true } })` — field is optional in `ReactiveInput` at `strategies/reactive.ts:70`; runtime at `runner.ts:749`.

**Resolved in prior work (keep as reference — do not resurface):**
- `_riHooks` **6/6 wired** (W2 FIX-6) at `builder.ts:2673-2731` — all 6 event subscribers wired. Events at `core/services/event-bus.ts:1001-1005`.
- RI budget counters **live** (W3 FIX-23): `reactive-observer.ts:283-321` accumulates `riBudget`. "Dead-zeroed" claim was stale.
- qwen3 thinking OPT-IN (W7 FIX-3): `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226`.

---

## Restoring sprint context

If you need the historical sprint logs (Mar–Apr 2026 stage-by-stage commits, IC-1/IC-2/IC-3 fixes, MCP client rewrite details, kernel composable phase shipment notes, the 6-handler RI dispatcher wiring sessions, etc.):

```bash
git log --diff-filter=M -- .agents/MEMORY.md | head -20  # find the rewrite commit
git show <sha>:.agents/MEMORY.md                          # read the prior version
```

The sprint logs are intentionally not carried forward in this reset because:
- Most sprint findings are now reflected in code or in `AUDIT-overhaul-2026.md`.
- Per-day "what shipped" entries decay fast and create noise for cold-start agents.
- The audit is the consolidated view; this memory is the index pointing to it.

---

## Lost / pending re-implementation (carried forward)

Three Obsidian-vault skill modules under `.agents/skills/` were deleted in the Phase-0-close cleanup on 2026-04-24 and are NOT recoverable from any backup:

- `.agents/skills/obsidian-vault-query/` — read the vault at session start
- `.agents/skills/obsidian-vault-sync/` — write decisions/experiments/sessions back to the vault
- `.agents/skills/obsidian-vault-hygiene/` — orphan/bitrot/duplicate loop maintenance

`AGENTS.md` and `.agents/skills/update-docs/SKILL.md` may still reference these by name. Re-implement before agents can act on those references.

---

*If you find this file stale, update it directly. Keep it short — the audit doc is where detailed plans live.*
