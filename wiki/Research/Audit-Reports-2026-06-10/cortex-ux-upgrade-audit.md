# Cortex UX + Capability Upgrade Audit — 2026-06-10

**Method**: Playwright live exploration (all 6 major pages) + full source audit of routes, components, and server API.  
**Scope**: `apps/cortex/ui/` + `apps/cortex/server/`  
**Status**: Research complete; no code changes yet.

---

## Executive Summary

Cortex has strong bones — full run lifecycle, rich trace/replay, Lab builder with gateway scheduling, template variables, live SSE streaming. The gaps are mostly **discoverability, workflow glue, and aggregate intelligence** rather than missing primitives. The highest-leverage work falls into three clusters:

1. **Finding things** — runs, chats, and prompts are unindexed/unsearchable
2. **Cross-surface handoffs** — completed run → chat, Lab config → Beacon, run → compare
3. **Ambient intelligence** — per-agent stats, live cost meter, API health visibility

---

## Tier 1 — High Impact, Relatively Bounded (ship first)

### 1.1 Run + Chat Search / Filter

**Problem**: No search on the Runs list or Chat session list. With any real usage, finding a specific run requires scrolling. Chat history is completely unsearchable.

**Fix**:
- Runs list: add `<input>` filter by prompt snippet / agent name / status chip + date range picker. Server already supports `?limit=` — add `?search=` + `?agentId=` query params to `/api/runs`.
- Chat: search across `turn.content` within the current session (client-side FTS over loaded turns is fine for session scope); cross-session search needs server-side SQLite FTS5 on `chat_messages`.

**Leverage**: Every user hits this within the first week. Turns Cortex from a toy into a workbench.

---

### 1.2 Run Labeling / Nicknames

**Problem**: Runs are identified by a UUID truncated to 8 chars. `cortex-run-a1b2c3d4.json` tells you nothing. `LaunchRunModal` doesn't offer a "name this run" field.

**Fix**:
- Add optional `label` column to `runs` table (nullable string, max 120 chars).
- Pre-fill with first 80 chars of the prompt on creation.
- Show `label || runId.slice(0,8)` everywhere; inline-rename from VitalsStrip or RunOverview header.

**Leverage**: Immediate UX payoff; trivial schema change.

---

### 1.3 API Key / Provider Health Check in Settings

**Problem**: Settings page pings `/api/health` (Cortex server) but gives no signal on whether `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. are configured and valid. Users hit opaque 4xx errors at run time.

**Fix**:
- Add `/api/health/providers` endpoint: for each known cloud provider, attempt a minimal non-billable check (list models or cheapest introspection call); return `{ anthropic: "ok"|"missing"|"invalid", openai: ..., ... }`.
- Settings page shows colored pill per provider with optional refresh button.
- Ollama: check `GET /api/tags` from the configured endpoint.

**Leverage**: Eliminates a major frustration category for new users.

---

### 1.4 Live Cost + Token Counter in Chat

**Problem**: Chat streaming shows no token/cost accumulation. Users have no idea how much a long back-and-forth costs until they click into a run detail.

**Fix**:
- `ChatPanel` already receives SSE events — pipe `token_usage` events from the chat stream into a running tally shown in a small chip in the chat header (e.g. `~2,400 tok · ~$0.003`).
- Show per-turn cost on hover over each assistant bubble.

**Leverage**: Makes cost visible and builds user intuition; no server changes needed.

---

### 1.5 Beacon Node Live Step Indicator

**Problem**: Beacon nodes show status badge + token count but give no sense of what the agent is doing right now. A "running" node looks the same whether it's on loop 1 or loop 47.

**Fix**:
- Push `ReasoningIterationProgress` events from SSE into each agent node's state in `agentStore`.
- Render: loop counter badge + a 1-line truncated "current step" label (e.g. `"Calling web-search…"` or `"Reasoning: step 3 of 10"`).
- Optional: pulse animation on the node border while live.

**Leverage**: Turns Beacon from a status dashboard into a live operations view.

---

## Tier 2 — High Value, Moderate Effort

### 2.1 "Continue in Chat" Handoff from Run

**Problem**: No path from a completed Beacon run or RunDetail → Chat. If you ran a research task and want to ask follow-up questions, you manually copy output into a new chat.

**Fix**:
- Add "Open in Chat" button in RunFinalDeliverable / RunOverview footer.
- On click: POST `/api/chat/sessions` with the run's agent config + seed the conversation history with `[{role:"user", content: run.prompt}, {role:"assistant", content: run.output}]`.
- Navigate to `/chat?sessionId=<new>`.

**Server side**: `chat-session-service` already has `createSession` + `addMessage`; this is wiring, not new primitives.

**Leverage**: Closes the biggest workflow gap — agents are most useful when you can iterate on their output.

---

### 2.2 Prompt / Task Library

**Problem**: No way to save prompts for reuse. Common tasks get retyped every time. Template variables (`{{var}}`) exist but there's no library of named templates.

**Fix**:
- New `prompt_library` table: `id, name, body, variables (JSON), tags, createdAt`.
- `/api/prompts` CRUD endpoint.
- In BottomInputBar and Lab builder: "Save as template" button + "Load template" dropdown/search.
- Bonus: show template variables as a pre-fill form before launching.

**Leverage**: Multiplies reuse of every prompt invested into the system.

---

### 2.3 Agent Performance Dashboard

**Problem**: No aggregate view of an agent's history. You can see individual runs but not "agent X averages 3,200 tokens, 92% success, typical cost $0.008."

**Fix**:
- SQL: aggregate `runs` by `agentId` → `{ avgTokens, avgCostCents, successRate, p50Duration, runCount }`.
- Add `/api/agents/:agentId/stats` endpoint.
- In Lab gateway card and BeaconNode popover: show stats strip.
- Optional: sparkline of last-10-runs token cost.

**Leverage**: Turns agents from black boxes into measurable workers; essential for tuning.

---

### 2.4 Run Comparison View

**Problem**: Common workflow — tweak agent config, re-run same task, want to see diff. Currently requires opening two browser tabs and manually comparing.

**Fix**:
- Runs list: multi-select checkbox + "Compare selected" action (max 2).
- `/run/compare?a=<id>&b=<id>`: side-by-side VitalsStrip + output diff (unified text diff or toggle view).
- Bonus: highlight config differences between the two runs (if run config is stored at launch time).

**Leverage**: Core workflow for iterative prompt/config tuning.

---

### 2.5 Command Palette (⌘K)

**Problem**: Navigation between Beacon, Chat, Lab, Run detail is purely sidebar clicks. Power users want keyboard-first.

**Fix**:
- Global `⌘K` modal: fuzzy search over recent runs (by label/prompt), saved agents, chat sessions, settings sections.
- Actions: "New run", "New chat", "Open Lab", "Go to run <id>".
- Svelte store holding recent items; no server round-trip for the index.

**Leverage**: Small surface area, enormous daily-use payoff for power users. Sets Cortex apart from basic AI wrappers.

---

### 2.6 Model Context Window + Pricing Info in Selectors

**Problem**: Model dropdowns show model IDs with no context on context window size, pricing tier, or capability notes. Users can't make informed choices.

**Fix**:
- Extend `ModelInfo` type in `@reactive-agents/llm-provider` with `contextWindow: number`, `pricingTier: "free"|"standard"|"premium"`, optional `notes: string`.
- Show in model dropdown: `[claude-sonnet-4-6] 200k ctx · standard` with a tooltip on hover showing input/output pricing.
- Populate from the provider registry static manifest (no live fetch needed).

**Leverage**: Reduces "why is this expensive?" confusion; directly informs config decisions.

---

## Tier 3 — Longer Horizon, High Strategic Value

### 3.1 Run Branching / Fork

**User story**: "I have a run 8 steps in — I want to try a different response at step 4 and see where it goes."  
**What's needed**: Replay already gives you the state at step N. Fork = create a new run seeded from that partial state with a different prompt injection at the branch point.  
**Complexity**: Medium-high — needs kernel support for "resume from checkpoint at step N with override."

---

### 3.2 Collaborative Run Sharing

**User story**: Share a run detail link that a teammate can open read-only.  
**What's needed**: Run access tokens or a shareable URL (optionally time-limited). All run data is already in SQLite; just needs auth + a share endpoint.  
**Complexity**: Low server work; needs auth design.

---

### 3.3 Inline Agent Evaluation Harness

**User story**: "Run this prompt against 3 model configs and score the outputs."  
**What's needed**: Lab "sweep mode" — matrix of (model × strategy × param) → batch launch → comparison table with configurable eval metric.  
**Complexity**: High, but this is where Cortex becomes a serious local AI development platform rather than a chat UI.

---

### 3.4 Persistent Trace Search + Annotations

**User story**: "Find all runs where the agent called web-search more than 3 times" or "annotate this step as a mistake."  
**What's needed**: Server-side event indexing (FTS5 or simple JSON path queries on run events); annotation writes back to DB.  
**Complexity**: Medium, depends on how event data is currently stored.

---

## UX Polish (Quick Wins)

| Item | Where | Fix |
|------|-------|-----|
| Run list empty state | `/runs` | Show "Launch your first run →" CTA, not blank |
| Chat empty state | `/chat` | "No sessions yet — start a conversation" with a New Chat button |
| AgentConfigPanel section memory | All | Persist open sections to localStorage per page context |
| Beacon filter persistence bug | `/` | Status filter already uses localStorage but clears on hard reload in some browsers — audit the init hydration |
| Error messages in chat | `ChatPanel` | Raw API errors surface as stack traces; show human error + "Retry" button |
| Copy button on code blocks | `MarkdownRich` | Standard expectation; likely missing |
| Mobile sidebar | All | Sidebar is fixed 64px/256px with no collapse — breaks on narrow viewports |
| Keyboard shortcut hints | All | `⌘Enter` to send, `⌘K` to command palette — show them in empty state hints |
| Run status filter on Beacon | `/` | Add "has errors" and "slow" (duration > threshold) to status filters |
| Gateway next-run indicator | Lab | Gateway cards don't show "next run at HH:MM" — compute from cron expression |

---

## Recommended Implementation Order

```
Week 1:  1.2 Run labeling  +  1.1 Run search  +  1.3 API health check
Week 2:  1.4 Chat cost meter  +  1.5 Beacon live step  +  UX polish batch
Week 3:  2.1 Continue-in-chat  +  2.2 Prompt library
Week 4:  2.5 Command palette  +  2.6 Model info in selectors
Future:  2.3 Agent stats  +  2.4 Run comparison  +  3.x roadmap items
```

Weeks 1–2 are all client-side or thin server additions with no schema changes except run labeling. They make Cortex feel finished. Weeks 3–4 add workflow power. The Tier 3 items are roadmap candidates that depend on deeper kernel/server work.

---

*Audit by Claude Sonnet 4.6, 2026-06-10. Screenshots captured via Playwright MCP across all 6 major Cortex pages.*
