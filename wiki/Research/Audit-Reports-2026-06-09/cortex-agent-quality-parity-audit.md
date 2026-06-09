# Cortex Agent-Build Quality & Parity Audit

**Date:** 2026-06-09
**Scope:** `apps/cortex` agent construction paths (chat sessions, Lab runs) vs the
canonical `AgentConfig` (UI source of truth) and framework best practices.
**Trigger:** User report — chat config "not saving all settings (e.g. observability)"
and "agents in cortex aren't giving the same quality as manually built agents."

## Method

Traced every config field from the UI `AgentConfig` (`ui/src/lib/types/agent-config.ts`,
the panel's output) through the three serialization layers of each build surface to
`buildCortexAgent` (`server/services/build-cortex-agent.ts`), the single shared build
function. Compared field coverage across surfaces and against framework capability
defaults.

## Architecture (as-found)

`AgentConfig` (37 fields) is produced by the shared `AgentConfigPanel` for BOTH Lab
and chat. It reaches `buildCortexAgent` through **five hand-rolled field allowlists**
across two surfaces:

| Surface | Layer 1 (accept) | Layer 2 (→ params) |
|---|---|---|
| **Lab run** | `runs.ts` `t.Object` body | `runner-service.ts` body→buildCortexAgent |
| **Chat** | `chat.ts` `ChatSessionConfigBody` | create handler + PATCH handler + `buildChatAgentParams` |

The UI sends the **whole** config (`currentConfigPayload()` spreads `...sessionAgentConfig`;
chat-store `JSON.stringify`s it). Loss is entirely server-side: Elysia `t.Object`
strips keys absent from the schema, and the create/PATCH handlers copy a hand-listed
subset into the persisted `agentConfig` blob.

## Finding 1 — Chat drops 12 config fields (P0, root cause of "not saving")

`ChatSessionConfigBody` (and both handlers) omit these `AgentConfig` fields that the
Lab run path forwards. They are **silently dropped before the DB** — the value never
persists, so the user's "observability won't save" is literally true at the API:

| Field | Quality impact | Notes |
|---|---|---|
| `observabilityVerbosity` | — (telemetry) | User-named. Pure settings loss. |
| `numCtx` | **HIGH** | Read by `buildChatAgentParams` but never stored → always absent. On local providers the framework falls back to **2048 num_ctx**, which commonly breaks tool-calling (system prompt + tool schema overflow). Chat cannot raise it. |
| `memory` `{working,episodic,semantic}` | MED | Chat **hardcodes** `{ episodic: true }`, ignoring a configured value → no semantic/working recall. |
| `minIterations` | MED | Forces deeper reasoning; dropped. |
| `metaTools` `{brief,find,pulse,recall,…}` | LOW | Defaults ON in `buildCortexAgent` (`?? true`), so absence ≠ disabled — but a user who **disables** a meta-tool is not honored. |
| `fallbacks` | resilience | Provider fallback dropped. |
| `healthCheck` | LOW | Dropped. |
| `progressCheckpoint` | LOW | Dropped. |
| `retryPolicy` | LOW | Dropped. |
| `timeout` | LOW | Dropped. |
| `cacheTimeout` | LOW | Dropped. |
| `taskContext` | MED | Chat builds its own `taskContext`; a configured `AgentConfig.taskContext` is not merged. |

**Fix (shipped this audit):** add all to `ChatSessionConfigBody`, both handlers, and
`buildChatAgentParams` (server-only — the UI already sends them). `memory` forwards the
configured value, falling back to `{ episodic: true }`. Plus a drift-guard test asserting
the chat body schema ⊇ the runs body schema (minus run-only keys).

## Finding 2 — The "lower quality" answer is grounding, not a dropped field

The screenshotted contradiction (`Current Price: $1.14` then `trading at ~$1.30` in the
**same** answer) is **intra-turn**, so it cannot be a chat-history artifact. Root cause:
`crypto-price` returned the live $1.14 while `web-search` surfaced stale $1.30 articles,
and the agent did not reconcile them. This is a grounding/synthesis weakness.

Critically: chat **already forwards** `verificationStep`, `runtimeVerification`, and
`contextSynthesis`. So this defect is **not** a parity drop — turn-1 chat is
config-equivalent to a one-shot `run()`. The differentiator vs a "manually built" agent
is almost certainly that the hand-coded agent **enabled** grounding/verification while the
cortex UI **defaults them off**.

## Finding 3 — Cortex default config is below framework best practice (P1)

`defaultConfig()` ships:
- `verificationStep: "none"`, `runtimeVerification: false` → no grounding/verification.
- `numCtx: 0` → local providers silently run at 2048 (tool-calling trap).
- `strategySwitching: false`, `minIterations: 0`.

A best-practice research agent enables `withVerificationStep({mode:"reflect"})` and/or
`withVerification()` for factual reconciliation, and sets a sane local `numCtx`.

**Recommendations (P1, not auto-applied — they change default behavior/cost):**
1. When provider is local (ollama/litellm) and `numCtx === 0`, default to **8192** in
   `buildCortexAgent`. Eliminates the 2048 tool-calling trap framework-wide for cortex.
2. Offer a "Grounded research" preset (verificationStep reflect + contextSynthesis auto)
   in the panel; consider defaulting `verificationStep: "reflect"` for tool-enabled agents.
3. Surface tool-result reconciliation guidance in the default system prompt for research
   tasks (e.g. "prefer live tool data over web-article figures; flag conflicts").

## Finding 4 — Related fix already shipped this session (reference)

Cross-provider helper-model bug (`5ec90fbb`): verification/compression helper layers
hardcoded `claude-haiku-4-20250514` on the agent's own provider → `ollama/claude-haiku…`
mismatch → 2048 fallback. Fixed to run on the agent's own provider. Relevant because
enabling `runtimeVerification` (Finding 3) would otherwise have re-triggered it on local.

## Finding 5 — Structural debt: 5× duplicated field allowlist (P2)

The same field list is hand-maintained in 5 places (3 chat + 2 runs). This drift is the
mechanical cause of Finding 1 and will recur. **Recommend** (separate plan, not this
audit — the typed-body vs persisted-`Record` shape mismatch makes it a real refactor):
extract one `agentConfigToBuildCortexParams(config)` mapper consumed by both surfaces.
The drift-guard test shipped here is the interim safety net.

## Shipped in this audit

- P0 parity: chat now accepts + persists + forwards all 12 dropped fields (server-only).
- Drift-guard test: chat config body ⊇ runs config body.
- This report.

## Deferred (filed as recommendations)

- P1 best-practice defaults (numCtx-local, grounding preset) — behavior/cost change,
  needs user sign-off.
- P2 shared config→params mapper refactor — separate plan.
