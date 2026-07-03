# Agentic UI Kit → Cortex Showcase — Scoping

**Date:** 2026-07-02
**Status:** Scoping (follow-on to the agentic-UI-kit foundation branch `worktree-agentic-ui-kit`)
**Depends on:** foundation merged (ui-core + runtime server rail + `.withUserInteraction()`)

## Cortex architecture reality (corrects the "SvelteKit +server.ts" assumption)

Cortex is a **split two-process app**, NOT a SvelteKit-server app:
- **Server:** Elysia (Bun) — `apps/cortex/server/index.ts`; REST routers `server/api/*.ts` + two WebSockets (`/ws/live/:agentId`, `/ws/ingest`).
- **UI:** SvelteKit 2.15 / Svelte 5.16 **static-adapter SPA** in `apps/cortex/ui/`, talks to Elysia over `CORTEX_SERVER_URL` (REST + WS). No SvelteKit server endpoints.

No runtime version blocker — same monorepo, all kit surfaces are `workspace:*`. UI already depends on `@reactive-agents/svelte`; server on `@reactive-agents/runtime`. It simply uses none of the new kit surfaces yet.

**Three transports today:** WS (observability/desk view, hand-rolled reconnect in `ui/src/lib/stores/ws-client.ts`), hand-rolled SSE (chat, `server/api/chat.ts:300` + parser `chat-store.ts:304-597`), and a **dormant** `@reactive-agents/svelte` path (`ui/src/lib/stores/framework.ts:11-35`) pointing at non-existent `/api/agent/run`/`/api/agent/stream`.

**Existing HITL:** Cortex already has durable-runs + approval on its OWN REST+polling stack (`build-cortex-agent.ts:368-379` wires `.withDurableRuns()`+`.withApprovalPolicy({mode:"detach"})`; `runner-service.ts` approve/deny; `ApprovalPanel.svelte` + `approval-watcher.ts` poll). It does NOT use the runtime endpoint helpers.

## Green-field gaps (biggest showcase value)
- **No `request_user_input` / `.withUserInteraction()` anywhere** — zero hits in server/ + ui/. The runtime fully supports it; Cortex exposes none. **Flagship, zero-competition demo.**
- **No cursor-based attach/resume** — reattach is WS replay-from-store, not `createRunAttachEndpoint(?cursor=N)`.

## Ranked opportunities (file-anchored)

**A. Interact panel (`request_user_input` HITL) — FLAGSHIP.**
- Server: add `POST /api/runs/interaction` in `server/api/runs.ts` (mirror approve/deny at :225-258) → `agent.respondToInteraction`, OR mount `createInteractionEndpoint`. Add `.withUserInteraction()` in `build-cortex-agent.ts:374` inside the `if (durableRuns.enabled)` guard (satisfies the builder.ts:2214 invariant).
- UI: `InteractPanel.svelte` beside `ApprovalPanel`, mounted on `routes/runs/+page.svelte:431` and/or `RunDetail.svelte`; reuse `approval-watcher.ts` polling pattern.
- Shows: agent pausing durably to ask the user a form/choice/confirmation — entirely new Cortex UX.

**B. Swap the ad-hoc chat SSE reader for `connectRunStream` + `reduceRunState`.**
- File: `ui/src/lib/stores/chat-store.ts:373-562` — replace ~200-line hand-rolled `getReader()`/`\n\n` loop with `connectRunStream` (ui-core) feeding `reduceRunState`/`initialRunState`. Server `chat.ts:300` already emits `data:` SSE → drop-in.
- Shows: resumable SSE client + pure state machine; hardens a fragile bespoke parser.

**C. Cursor attach/resume route + "Resume" affordance.**
- Server: mount `createRunAttachEndpoint` as `GET /api/runs/:runId/attach?cursor=N`.
- UI: in `RunDetail.svelte` (:181 uses `GET /:runId/events`+WS) add reconnect-from-cursor via `connectRunStream`.
- Shows: survives reload/disconnect without losing tail.

**D. Task Inbox route backed by `createInboxEndpoint`.**
- Server: mount `createInboxEndpoint` as `GET /api/inbox`. UI: `routes/inbox/+page.svelte` (clone `routes/runs/+page.svelte` scaffold), durable runs per identity → `run/[runId]`.
- Shows: durable runs per identity + owner-scoping.

**E. Structured-output live preview.**
- File: `RunFinalDeliverable.svelte`/`DebriefPanel.svelte` — runs already support `outputSchema` (`runs.ts:70`, `build-cortex-agent.ts:358`). Use `createStructuredStream`/`parsePartialObject` (already re-exported from `@reactive-agents/svelte`) to render partial object as it streams.
- Shows: progressive structured render on an already-configured feature — lowest friction.

**Sequencing:** A (unique) + B (de-risks fragile parser) first; C/D for durability/resume; E as a quick visual win.

## Interplay with `worktree-cortex-dynamic-sync` (changes this plan)

A parallel branch makes Cortex read framework surfaces **dynamically** via `getCapabilityManifest()` (`packages/runtime/src/capability/manifest.ts`) → `GET /api/capabilities` → UI renders controls from data. The manifest derives `strategies` (STRATEGY_CATALOG), `builderMethods` (builder-prototype reflection), `configFields` (AgentConfigSchema); kept honest by parity tests. **It covers the CONFIG surface only — NOT the runtime event/wire surface.** These are complementary, not overlapping: dynamic-sync = "what can I configure" (build-time); this kit = "what happens at run time + how the UI reacts to run events."

**How it changes the showcase:**
1. **Enablement of `.withUserInteraction()` is FREE.** Once both branches merge, `deriveBuilderMethods()` reflects the builder prototype → `.withUserInteraction()` auto-appears in `AgentConfigPanel.svelte`. Opportunity **A** no longer hand-wires an enable toggle — the config control is generated. The showcase work shifts entirely to rendering the runtime INTERACTION EVENT (the panel that shows the agent's question + captures the response) and the `POST /api/runs/interaction` handler. Config-surface = automatic; runtime-surface = the real build.
2. **Adopt the manifest's anti-drift philosophy for the EVENT surface.** dynamic-sync proves the pattern (derive-from-source + parity-test). Extend it: make ui-core's versioned `UiStreamEvent` THE canonical event surface, delete Cortex's 3 hand-copies (GH #163), and add a runtime↔ui-core parity test (manifest-style: fails when runtime emits a `_tag` ui-core doesn't declare). This unifies both efforts into one story — **"Cortex is dynamic to ALL framework surfaces: config (manifest) + events (versioned protocol)."** The manifest does NOT solve GH #163; this kit is the natural fix for it.
3. **Merge order (low conflict):** both branches add export lines to `packages/runtime/src/index.ts` (trivial). Only dynamic-sync edits `apps/cortex/**`; this kit only scoped it. Recommend merge dynamic-sync FIRST (config-surface infra + the `agent-config.ts` 5→8 ReasoningStrategy fix), then this kit (runtime endpoints/protocol + the builder method the manifest auto-surfaces), then execute this showcase ON TOP of both.

## Blockers / watch-items
- **Event-shape divergence (GH #163):** Cortex hand-maintains 3 copies of the stream-event union (`runtime/stream-types.ts` canonical, `packages/svelte/src/types.ts` lossy, `chat-store.ts:21-51` local). Kit's `UiStreamEvent` is a 4th shape. **Converge on the kit's versioned protocol; do not add a 5th mirror.** Check `reduceRunState` against Cortex `_tag` variants (TextDelta, IterationProgress, ThoughtEmitted, LLMRequestCompleted, StreamCompleted…).
- **Transport impedance:** desk live view = WS; kit = SSE/journal. Adopt on chat + new attach/inbox first; converting the WS desk to SSE is a separate, larger effort — out of showcase scope.
- **Dormant framework path** (`framework.ts`) 404s today; mounting `createAgentEndpoint` on the server would make it real (companion to C/D).
- **HITL needs durable runs:** the Interact demo (A) must run with `durableRuns.enabled: true`.
