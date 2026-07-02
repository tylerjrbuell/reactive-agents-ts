# Agentic UI Harness Components — Design Spec

**Date:** 2026-07-02
**Status:** Draft for review
**Thread:** post-v0.13.0 flagship direction (supersedes bureau/warden showcase for now; that becomes a future consumer of this kit)

---

## 1. Problem & Positioning

Every agentic UI offering on the market (Vercel AI SDK `streamUI`, CopilotKit, assistant-ui) is a **synchronous chat stream that dies with the page**. None of them own the layers underneath that decide whether an agent feature ships to production: durability, human-in-the-loop, cost control, verification, memory governance.

Reactive Agents already owns those layers. This spec turns them into **visible, embeddable UI primitives** for React, Vue, and Svelte:

> **Positioning: "Production Agentic UX."** Everyone else sells "add AI chat." RA sells the layer that makes agent features *shippable* — async, durable, resumable, auditable, cost-controlled, privacy-inspectable, receipts-bearing.

This is the foundation for a family of web-UI value built on the harness. Nothing in this category exists in the community today.

## 2. Why RA Is Uniquely Positioned (substrate → UX mapping)

| Shipped harness system | Becomes UI capability |
|---|---|
| Durable runs (SQLite, crash-resume) | Resumable streams, async task inbox, cross-device reattach |
| `.withApprovalPolicy` + `run_approvals` + `listPendingApprovals`/`approve`/`deny` | `<ApprovalGate>`, durable HITL that survives reloads |
| `.withOutputSchema` → `result.object`, `.streamObject()`, `parse-partial` | Dynamic (json-render-style) UI trees, progressive render |
| Grounding receipts, `trustVerdict`, forced abstention | `<Claim>` citations, `<TrustBadge>`, honest "declined" states |
| Budget/cost tracking + cost-aware model routing | `<CostMeter>`, per-user-tier routing hooks |
| EventBus telemetry | `<StepTimeline>`, live tool/strategy trace |
| Snapshot/replay | `<ReplayViewer>` (deferred tier) |
| 4-layer memory + identity | `<MemoryPanel>` inspector (deferred tier) |

Competitors would need to build the substrate first. RA only needs the last mile.

## 3. Current State (verified 2026-07-02)

- `packages/react/` — `useAgentStream` (SSE reader over `AgentStream.toSSE`), `useAgent`, `useStructuredObject`. Marked `@unstable`, **zero in-repo consumers** (Cortex uses its own client).
- `packages/vue/` and `packages/svelte/` — parallel surfaces; `parse-partial.ts` and structured-stream logic **duplicated per package** (existing debt this spec eliminates).
- `packages/runtime/` — `AgentStream.toSSE`, durable resume (`engine/durable-resume.ts`), approvals on `reactive-agent.ts` + `run-store.ts`.
- `packages/a2a/`, `packages/orchestration/multi-agent/` — exist; **out of scope** here but future consumers (multi-agent war-room components).

## 4. Architecture

### 4.1 Headless core + thin bindings

```
packages/ui-core/          NEW — framework-agnostic, zero DOM deps
  protocol/                wire protocol types + guards (single source of truth)
  stream/                  SSE/fetch client, reconnect + resume cursor logic
  state/                   framework-agnostic state machines (run, interaction, approval)
  parse-partial/           moved here from react/vue/svelte (dedupe)
  registry/                UI-tree node schema + component registry contract

packages/react/            thin binding: hooks wrap ui-core state machines
packages/vue/              thin binding: composables
packages/svelte/           thin binding: stores/runes

packages/runtime/          server side: endpoint helpers (extend AgentStream.toSSE)
```

Rule: **all protocol logic, parsing, and state transitions live in `ui-core`.** A binding is ≤ a few hundred LOC of reactivity glue. Fixing a protocol bug never touches three packages.

### 4.2 Wire protocol (extends existing SSE event stream)

Existing `AgentStreamEvent` (`TextDelta`, `StreamCompleted`, `StreamError`, `StreamCancelled`) is the base. New tagged events:

```ts
// Emitted by server
{ _tag: "RunAttached",     runId, status, resumeCursor }        // reattach handshake
{ _tag: "ObjectDelta",     partial }                            // streamObject partials
{ _tag: "UiTreeDelta",     partial }                            // dynamic-render tree partials
{ _tag: "InteractionRequested", interactionId, kind, schema, prompt }
                                                                // kind: "form" | "choice" | "confirmation" | "approval"
{ _tag: "ApprovalRequested",    approvalId, toolCall, policy }  // existing durable approvals surfaced
{ _tag: "CostDelta",       tokens, usd, budget }                // budget burn ticks
{ _tag: "StepEvent",       step }                               // EventBus-derived trace entries
{ _tag: "TrustEvent",      claimId, verdict, sources }          // grounding/verification receipts
{ _tag: "RunPaused",       reason }                             // waiting on interaction/approval
{ _tag: "Abstained",       reason, missing }                    // result.abstention surfaced

// Sent by client (POST to companion endpoints)
InteractionResponse { interactionId, value }                    // validated against schema server-side
ApprovalDecision    { approvalId, decision: "approve" | "deny" }
```

Every event carries `runId`. Streams are **resumable**: client reconnects with `Last-Event-ID`-style cursor; server replays from durable run record. Protocol versioned (`protocolVersion: 1` in handshake).

### 4.3 Agent-initiated UI (the moat feature)

Mechanism mirrors the shipped approval machinery:

1. New meta-tool `request_user_input` (opt-in: `.withUserInteraction()` on the builder). Agent calls it with a typed schema (form fields / choice set / confirmation).
2. Runtime persists the pending interaction to the durable store (sibling table to `run_approvals`), emits `InteractionRequested`, and pauses the run **durably** — same pause/resume rail as approvals.
3. Client renders it (`<AgentPrompt>`, `<ChoiceCard>`, `<ApprovalGate>`). User may answer now, after a reload, or from another device.
4. `InteractionResponse` validates against the schema server-side, lands as the tool result, run resumes.

This inverts the market's render-only flow: the agent can *drive* UI and wait indefinitely. No competitor has a durable bidirectional loop.

### 4.4 Dynamic render (json-render style)

- `ui-core/registry` defines the **UI-tree node schema**: `{ type, props, children, key, action? }`, schema-constrained — the agent can only emit registered node types (structured-output schema generated **from** the app's registry, so hallucinated components are unrepresentable, not just rejected).
- Server: `.withOutputSchema(uiTreeSchema(registry))` + `.streamObject()` → `UiTreeDelta` events.
- Client: `<AgentSurface registry={...}>` renders partial trees progressively; `action` nodes round-trip through the interaction endpoint (same rail as 4.3).
- Security stance: no codegen, no eval, no arbitrary HTML. Registry is an allowlist.

### 4.5 Server endpoint helpers

`@reactive-agents/runtime` exports mount-anywhere handlers (framework-agnostic `Request → Response`, works in Next/Nuxt/SvelteKit/Bun/Express adapters):

```ts
createAgentEndpoint(agent)          // POST run + SSE stream (exists via toSSE; extend with new events)
createRunAttachEndpoint(agent)      // GET reattach + replay from cursor
createInteractionEndpoint(agent)    // POST InteractionResponse
createApprovalEndpoint(agent)       // GET pending / POST decision (wraps listPendingApprovals/approve/deny)
createInboxEndpoint(agent)          // GET durable runs by user/identity → task inbox
```

## 5. Component Families & Scope

### v1 (this build)

| Family | Components/hooks | Substrate |
|---|---|---|
| **Resume** | `useAgent({ runId })` reattach; reconnect-with-cursor in ui-core | durable runs |
| **Interact** | `useInteractions`, `<AgentPrompt>`, `<ChoiceCard>`, `<ApprovalGate>` | new `request_user_input` + existing approvals |
| **Inbox** | `useTaskInbox`, `<TaskInbox>` — async agent jobs, email-like | durable runs + gateway |
| **Render** | `<AgentSurface>` + registry + `uiTreeSchema()` | streamObject |
| **Observe (lite)** | `useRunCost` → `<CostMeter>`, `useRunSteps` → `<StepTimeline>` | budget events + EventBus |

Bindings: **React complete** (hooks + reference components). **Vue + Svelte: full hook/composable parity** (ui-core makes this cheap); reference components React-first, ported as second wave.

Styling: headless-first (hooks + unstyled primitives with data-attributes), plus a small styled reference layer for demos. No CSS framework lock-in.

### v2 (explicitly deferred)

Trust components (`<Claim>`, `<TrustBadge>`, abstention rendering beyond the raw `Abstained` event), form copilot, cost-tier routing hook (`useAgent({ tier })`), `<ReplayViewer>`, `<MemoryPanel>`, multi-agent roster (a2a). Protocol reserves event tags now (`TrustEvent` ships in v1 wire format so v2 needs no protocol bump).

### Non-goals

React Server Components/RSC codegen · arbitrary generated markup/code execution · chat-widget skinning war (we ship primitives, not a chatbot theme) · external A2A transport · new framework targets beyond react/vue/svelte.

## 6. Flagship Demo — "Ops Assistant" (`apps/ui-demo`, new Vite+React app)

One 90-second-demoable app exercising every v1 family:

1. User files a task ("research and order replacement part") → appears in `<TaskInbox>`, closes tab.
2. Agent (local model patrol tier) researches; `<CostMeter>` ticks; `<StepTimeline>` shows tool calls.
3. Agent needs a decision → `InteractionRequested` (choice card). User answers **from a fresh page load** (durability visible).
4. Spend threshold → `<ApprovalGate>` (existing durable approval).
5. Result renders as dynamic UI tree (summary card + table) via `<AgentSurface>`.
6. Kill the dev server mid-run and restart → run resumes (crash-resume as UX).

## 7. Testing Strategy

- **ui-core:** pure unit tests (protocol guards, state machines, parse-partial merge, cursor/replay logic). Property tests for partial-tree merge (fast-check precedent exists in repo).
- **Protocol round-trip:** server helper ↔ ui-core client against a real `test`-provider agent in-process; assert every event tag round-trips typed.
- **Durability e2e:** start run → drop stream → reattach with cursor → assert no event loss/dup; interaction answered after "reload" resumes run. Use existing durable-run test rails.
- **Bindings:** thin — mount hook, drive with recorded event fixtures from ui-core tests (no browser needed for logic; component render smoke via happy-dom).
- **Contract tests:** one shared fixture set consumed by react/vue/svelte binding tests so parity drift is caught mechanically.
- **CI parity rule honored:** all tests run keyless with `test` provider; no Ollama dependency (feedback_ci_parity_no_keys_no_ollama).

## 8. Phasing

1. **P1 — ui-core + protocol:** package scaffold, event types, stream client with resume cursor, state machines; move parse-partial/structured-stream out of the three bindings (dedupe, re-export for compat).
2. **P2 — server helpers:** extend toSSE event set; attach/interaction/approval/inbox endpoints; `request_user_input` meta-tool + durable interaction store + `.withUserInteraction()`.
3. **P3 — React binding + reference components** (all v1 families).
4. **P4 — Vue/Svelte hook parity** via shared contract fixtures.
5. **P5 — flagship demo app + docs** (guides: "resumable agent UI in 10 minutes", "durable human-in-the-loop form").

Each phase lands green on main independently; P1/P2 have no UI risk and immediately pay the dedupe debt.

## 9. Risks & Mitigations

- **Differentiation risk** — if v1 ships only Render, it's a streamUI clone. Mitigation: Interact + Inbox + Resume are the v1 core, Render is one family among them.
- **Three-framework drag** — mitigated by headless core + contract fixtures; components React-first.
- **Protocol churn** — version field from day 1; TrustEvent reserved; additive-only policy.
- **`@unstable` surface break** — existing react/vue/svelte exports have zero in-repo consumers; keep them working (re-export from ui-core) but mark superseded.
- **Scope creep toward Cortex rewrite** — Cortex adoption of ui-core is a *later* migration, not part of v1.

## 10. Gap-Log Mandate (dogfood deliverable)

Standing order for the whole build: every framework friction hit (missing runtime primitive, awkward Effect surface, event not exposed, approval API gap) gets an entry in `wiki/Research/2026-07-agentic-ui-gap-log.md` with production context. This log feeds the next harness wave the same way the landscape research fed v0.13.

## 11. Success Criteria

1. Demo app: full flagship script (§6) works, including reload-mid-interaction and server-restart resume.
2. A Next.js/Vite user can add a resumable agent stream in <10 lines client-side.
3. Zero duplicated parse/stream logic across binding packages.
4. All three bindings pass the shared contract fixture suite.
5. Gap log has ≥5 substantive entries (if it has zero, we weren't paying attention).
6. Docs: 2 guides + API reference pages for every exported hook/component.
