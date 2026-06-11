# Cortex Upgrades Phase 2 — Chat Modernization, Transparency, Prompt Platform

**Date:** 2026-06-10
**Branch:** `worktree-feat+cortex-upgrades-2026-06-10` (continues Phase 1, commits `9899acca..fa8e0e83`)
**Baseline:** 323 cortex tests passing
**Goal:** Make Cortex a full expression of reactive-agents: powerful agent building with total transparency, observability, and developer control.

## Priorities (highest leverage first)

### Task 1 — Modern streaming chat experience

**Problem:** `chat-store.ts` routes every `TextDelta` into reasoning-step thoughts when steps exist. The final answer never streams into the bubble — users stare at "Drafting final response…" until completion. Feels dated vs modern chat UIs.

**Spec:**
1. Detect final-answer phase: investigate `AgentStreamEvent` union for a phase marker; if none exists, derive (deltas arriving after final `IterationProgress`/verification events) or add an explicit marker server-side (`chat-session-service.chatStream` can tag deltas).
2. Stream final answer progressively into the bubble with live markdown rendering (use `MarkdownRich` incrementally; cursor pulse at end).
3. Thinking accordion polish: auto-collapse reasoning steps when final answer starts streaming; live tool chips with pending/done states.
4. Smart autoscroll: only follow stream when user is pinned at bottom (don't yank scroll if they scrolled up).

**Tests:** chat-store unit tests for delta routing (reasoning vs final phase); existing 323 stay green.

### Task 2 — Prompt platform (typed prompts, Lab tab, universal picker)

**Spec:**
1. DB: add `type` column to `cortex_prompts` (`system | persona | task | snippet`), migration-safe (`ALTER TABLE` guarded by PRAGMA check). Update `prompt-queries.ts` + API validation.
2. Lab gets a 5th tab `prompts`: full CRUD manager — list with type badges + search, create/edit form (name, type, tags, body with `{{var}}` hint), delete with confirm.
3. Extract reusable `PromptPicker.svelte` (popover, type-filterable) from current `PromptLibrary`; attach to:
   - Lab builder system-prompt textarea (filter: system/persona)
   - `BottomInputBar` (already wired — upgrade to typed picker, filter: task/snippet)
   - `ChatPanel` textarea
4. Insert semantics: insert at cursor for textareas with content; replace when empty.

**Tests:** prompt-queries type column CRUD; API accepts/validates type.

### Task 3 — Full-transcript trace transparency

**Spec:**
1. Verify `ReasoningStepCompleted.messages` carries the complete messages array (system prompt included) — fix server/framework plumbing if truncated.
2. RunDetail: add `transcript` bottom tab — flat per-LLM-call view: exact ordered messages (role, full content, copy), per-call model/provider/tokens, and a "what changed since previous call" delta marker (new messages highlighted).
3. Export: "Download trace JSON" + "Copy as markdown" actions on the tab.

### Task 4 — Harness control + hooks in Lab builder

**Spec:**
1. Advanced section in builder: strategy override, maxIterations, lean-harness toggle, verification/strategy-switching toggles — anything `normalizeCortexAgentConfig` already understands plus gaps worth exposing.
2. Hook points (design-first): per-agent webhook URLs fired on lifecycle events (tool-call start/end, iteration, completion) — server-side dispatch, keeps UI simple and safe (no arbitrary JS eval).

### Task 5 — Agent export

**Spec:** "Export" button in Lab builder + gateway cards: generates runnable TS file using the public reactive-agents builder API mirroring the agent's config (provider, model, system prompt, tools, harness overrides) + JSON config download.

### Task 6 — Per-page quality sweep (continuous)

Punch list applied opportunistically while touching each page: empty states, loading skeletons, keyboard a11y, focus management, dead UI removal.

## Execution order

1 → 2 → 3 → 5 → 4 (hooks need design pass) — quality sweep woven throughout.
TDD where server logic changes (tasks 1–3, 5). Commit per task.
