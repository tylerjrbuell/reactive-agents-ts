# Reactive Agents Build Memory

> **Status:** Reset 2026-04-28 on `refactor/overhaul`. Prior version (564 lines of layered sprint logs) preserved at commit `949bf81f^` — recover via `git show <sha>:.agents/MEMORY.md` if a specific historical claim needs lookup.

## Read first

Before doing any work in this repo:

1. **`docs/spec/docs/PROJECT-STATE.md`** — current empirical state of the framework.
2. **`docs/spec/docs/AUDIT-overhaul-2026.md`** — the v0.10.0 overhaul plan. 28 packages + 13 mechanisms + 44-item FIX backlog + W0-W13 execution sequencing. **This is the single source of truth for what's broken, deferred, fixed, or shipping.** If anything in this memory file conflicts with the audit, the audit wins.
3. **`docs/spec/docs/00-RESEARCH-DISCIPLINE.md`** — 12 rules. Every harness change requires prior spike validation. No exceptions.

The full canonical doc set is listed in `docs/spec/docs/DOCUMENT_INDEX.md`.

---

## Current state (Apr 28, 2026)

- **Branch:** `refactor/overhaul` (100+ commits ahead of `main`). All prior `feat/*` branches archived as `archive/*` tags.
- **Release target:** v0.10.0 clean-break. Stage 4 (doc + memory reset) in progress. Stages 5–6 follow.
- **Published on npm:** all packages at `0.9.0`. Umbrella `reactive-agents` and `@reactive-agents/diagnose` have **never been published** — top-priority FIX items.
- **Tests:** ~4,353 pass / 23 skip / 0 fail across 494 files (last clean count). Will re-run during Stage 6.
- **Architecture target:** `15-design-north-star.md` v3.0 (10 capabilities + cognitive kernel + 3 ports).

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
| "3/6 skill lifecycle AgentEvents missing" | **Events exist** at `core/services/event-bus.ts:986-990` (`SkillActivated`, `SkillRefined`, `SkillConflictDetected`). What's missing: 3/6 RI hooks have **no event subscriber**. Fix at `builder.ts:2657-2681`. | AUDIT §11 item 6, M6 mechanism |
| "Calibration defaults to `:memory:`" | **Already correct** at `reactive-intelligence/types.ts:246` (`~/.reactive-agents/calibration.db`). Apr 21 fix. | AUDIT §11 item 9 |

Memory descriptions to update or rewrite if you encounter them in personal memory:
- `project_v010_audit_blockers` — both stale claims above appear here.
- `project_running_issues` — older entries; cross-reference against AUDIT §11 before acting on any item.

---

## Architecture summary (high signal, low detail)

**Kernel composable phase architecture (shipped Apr 3, 2026):**
- `strategies/kernel/phases/` — `context-builder.ts`, `think.ts`, `guard.ts`, `act.ts` (4 single-concern phase files)
- `strategies/kernel/utils/` — 11 utility files (ICS, reactive-observer, loop-detector, etc.)
- `Phase` type, `Guard` type, `MetaToolHandler` registry — extensions are one-line additions
- `kernel/loop/runner.ts` is the largest file in the harness and houses 8 of 9 termination paths (M9 architectural blocker)

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
- Ollama streaming: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- Loop detection: `maxConsecutiveThoughts: 3` — only ACTION steps reset the streak; observations do NOT (IC-1 fix)

---

## Architecture debt (current top items)

The full list lives in `AUDIT-overhaul-2026.md` §11 (44 items). Top 5:

1. **9 termination paths in kernel** — oracle wired to 1 (M9). Single highest-leverage Stage 5 action.
2. **`builder.ts` 5,877 LOC + `execution-engine.ts` 4,476 LOC** — orchestration SHRINK targets.
3. **RI dispatcher budget counters dead-zeroed** at `reactive-observer.ts:294`, `plan-execute.ts:698` → suppression gates unreachable.
4. **3/6 RI hooks have no subscriber** at `builder.ts:2657-2681` (events exist; subscribers don't).
5. **Eval Rule 4 frozen-judge fails** at `eval/src/eval-service.ts:159` (judge resolves from same context as SUT). Blocks any benchmark claim.

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
