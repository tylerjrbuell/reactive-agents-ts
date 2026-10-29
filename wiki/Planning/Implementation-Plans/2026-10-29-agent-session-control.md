---
type: implementation-plan
status: active
created: 2026-10-29
updated: 2026-10-29
tags: [implementation-plan, cortex, chat, agentic-config, goals, schedules, tool-design]
spec: "[[2026-10-28-plan-and-goal-primitives]]"
---

# Agent Session Control (Plan 5) — let the chat agent do what the chat UI does

**Goal:** the user can say "check crypto prices every hour" or "switch to qwen3:14b and turn thinking off" and the chat agent sets it up on their behalf, safely, including on small models.

## Design decisions (skeptic's cut)

1. **One tool, not a tool per feature.** A single Cortex-local tool `session-control` with a flat schema: `action` (enum) + optional flat string/number args. Small models fail on large tool surfaces and nested objects. Actions: `status` (read-only), `set-model`, `set-provider`, `set-thinking`, `pin-skill`, `add-doc`, `start-goal`, `set-loop`, `set-schedule`, `stop-loop`, `cancel-goal`, `list-schedules`. Enum values and arg names go through the existing healers (`healEnumArg`, `healParamNames`, aliases such as `loop`→`set-loop`).
2. **Mutations are proposals, never direct writes.** The tool validates args deterministically and persists a `chat_proposals` row (`id, session_id, action, args_json, status proposed|applied|dismissed, created_at`). It returns a short result to the model: `proposed: <one-line summary>; awaiting user Apply`. The UI shows a proposal card (Apply / Dismiss). Apply calls the same REST endpoints the slash commands use. **Why:** prompt injection (fetched docs, tool results) cannot change config, spend money or schedule recurring runs without a human click; the model cannot escalate (provider/model switch, budgets, loops).
3. **`status` is free and read-only,** returns current provider/model/thinking/goal/schedules/pinned skills in one compact string so the model can ground its proposals.
4. **Deterministic validation, not LLM judgment:** model/provider must exist in the live discovery list; loop interval ≥ 1m and expiry/cap/cost limits identical to the slash commands (single validator shared by both surfaces); goal proposals reuse goal creation (still needs the existing Accept step, so goals take two clicks by design).
5. **Opt-in per session, default off** (setting "Let the agent manage this chat"). It changes the model-visible tool surface, so default-on needs a lift/ablation measurement and a small-model tool-call reliability pass first (see the 2026-10-29 text-tool-call root-cause report). The system line is added only when enabled.
6. **Observable:** every proposal, apply and dismiss is a persisted row and a trace-visible tool call. No hidden writes.
7. **Honest claims:** docs say proposals need user approval; no claim about small-model success rates until measured.

## Tasks

- **S1 · cortex server:** shared action validator + `chat-proposal-service.ts` (table, create/list/apply/dismiss), routes `GET /sessions/:id/proposals`, `POST /proposals/:pid/apply|dismiss`. Apply dispatches to existing services (config patch, goal propose, schedule create). Refactor slash-command executors to call the same validator (boundary fix: one validation path for UI commands and the agent tool). Tests: every action's valid/invalid args, apply idempotency, injection guard (tool path never writes config), caps.
- **S2 · cortex server:** the `session-control` tool (defineTool, flat schema, aliases healed), registered in `build-cortex-agent.ts` only when the session setting is on; system line. Tests: schema passes `normalizeToolSchema` with zero repairs; each action produces a proposal; `status` output stable.
- **S3 · cortex UI:** `ChatProposalCard.svelte` inline in the turn (summary, Apply, Dismiss, applied/dismissed state), setting toggle in session config, docs in `cortex.mdx`, changeset.
- **S4 · measurement (harness-warden):** n≥5 per arm on 2 local tiers (qwen3:4b-class and qwen3:14b-class) for 6 canonical requests ("every hour check X", "switch model", "start a goal to …", "what's my config"); record call-correctness and proposal-correctness. Output decides whether it may ever be default-on.

## Exit gates
Scoped tests, svelte-check clean, typecheck; browser pass of propose→apply for loop, model switch, goal; no mutation reachable without an Apply click (red-on-cut test).
