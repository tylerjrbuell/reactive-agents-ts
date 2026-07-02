# Cortex ⇄ Framework: Dynamic Capability Sync, Parity, and Run-Control Hardening

**Date:** 2026-07-02
**Status:** Design (approved sections → spec)
**Scope:** `packages/runtime`, `packages/guardrails`, `packages/reasoning`, `apps/cortex`
**Sequence:** B → A → C → D

---

## Problem

Cortex reflects the framework through **hand-maintained wiring across ~5 files** per capability
(`ui/src/lib/types/agent-config.ts`, `server/services/runner-service.ts`,
`server/services/gateway-process-manager.ts`, `server/api/runs.ts`,
`ui/src/routes/lab/+page.svelte`, plus the mapping in
`server/services/cortex-to-agent-config.ts`). A `config-parity.test.ts` guard exists but only
**detects** drift; it does not prevent it. As a result Cortex is already behind the framework:

- **Strategies:** framework registry has `reactive`(+`react`), `reflexion`, `plan-execute-reflect`,
  `tree-of-thought`, `adaptive`, `direct`, `code-action`, `blueprint`(+`rewoo`). Cortex UI enum
  exposes only 5 — **missing `direct`, `code-action`, `blueprint`.**
- **Builder methods:** `withModelRouting` (cost-aware routing) and other `with*` methods have **no
  Cortex surface.**
- **Run control:** `agent.stop()` / `agent.terminate()` on the `agent.run()` path (what Cortex uses)
  are honored **only at phase boundaries** (`execution-engine.ts` `checkLifecycle` →
  `ks.waitIfPaused` / `ks.isTriggered`). The `AbortSignal → fetch` cancellation that actually kills
  an in-flight Ollama generation exists **only on the `runStream()` / `RunController` path**. So a
  terminate mid-generation on a slow local model waits for the generation to complete.
- **Detail screen:** no rerun/retry; stop/terminate controls not present on the run detail view.

## Goals

1. **Zero-drift by construction:** a new strategy or builder method in the framework surfaces in
   Cortex without editing Cortex, and cannot silently disappear.
2. **Full parity now:** blueprint / code-action / direct strategies + `withModelRouting` usable from
   the desk.
3. **Immediate, graceful stop:** `terminate` cancels in-flight LLM calls (incl. Ollama fetch) at
   once, then disposes; `stop` wraps up gracefully. Agents (MCP containers, subscriptions, abort
   controllers) are always disposed.
4. **Rerun from detail:** one-click rerun + edit-and-rerun from a per-run config snapshot.

## Non-Goals

- Rewriting Cortex ingest/event flow.
- Migrating Cortex from `agent.run()` to `agent.runStream()`.
- Secret store (existing `{{secret.X}}` placeholder unchanged).

---

## B — Capability Manifest (foundation)

### Framework: `getCapabilityManifest()`

New export from `@reactive-agents/runtime`:

```ts
interface CapabilityManifest {
  version: string;                 // manifest schema version, bumped on shape change
  strategies: StrategyDescriptor[];
  builderMethods: BuilderMethodDescriptor[];
  configFields: ConfigFieldDescriptor[];
}

interface StrategyDescriptor {
  name: string;                    // canonical registry key, e.g. "blueprint"
  aliases: string[];               // e.g. ["rewoo"]
  label: string;                   // human label, e.g. "Blueprint (ReWOO)"
  description: string;
  multiStep: boolean;              // hint for UI grouping
}

interface BuilderMethodDescriptor {
  name: string;                    // e.g. "withModelRouting"
  kind: "config" | "overlay";      // config = maps to an AgentConfigSchema field; overlay = built in build-cortex-agent
  configPath?: string;             // dotted path into AgentConfig when kind === "config"
  description: string;
}

interface ConfigFieldDescriptor {
  path: string;                    // dotted path, e.g. "reasoning.defaultStrategy"
  type: "string" | "number" | "boolean" | "enum" | "object" | "array";
  enumValues?: string[];
  default?: unknown;
  optional: boolean;
  title?: string;                  // from Schema annotation
  description?: string;            // from Schema annotation
}
```

**Sources (single source of truth):**

- `strategies` ← a new **static `STRATEGY_CATALOG`** exported beside
  `packages/reasoning/src/services/strategy-registry.ts`. The registry's registration map and the
  catalog are asserted equal by a framework guard test (see below). Aliases (`react`, `rewoo`) are
  marked and de-duplicated to their canonical entry.
- `configFields` ← derived by walking the **`AgentConfigSchema`** (Effect `Schema` AST): field
  paths, types, enum literals, defaults, optionality, and `title`/`description` annotations. Where
  annotations are missing, we add them to the schema (improves the framework's own self-description).
- `builderMethods` ← a **declared descriptor table** in `packages/runtime` listing every public
  `with*` method, each tagged `config` (with `configPath`) or `overlay`. This covers Cortex overlay
  capabilities (`skills`, `agentTools`, `metaTools`, `dynamicSubAgents`, `taskContext`, …) that have
  no direct `AgentConfigSchema` field.

### Framework: drift guard test

A single framework test (`packages/runtime/test/capability-manifest.test.ts`) asserts:

1. Every key registered in `StrategyRegistry` appears in `STRATEGY_CATALOG` (and vice versa).
2. Every public `with*` method on the builder appears in `builderMethods` (reflection over the
   builder prototype / the `types.ts` interface, whichever is authoritative).
3. Every `AgentConfigSchema` field appears in `configFields`.

Drift now fails at the **source**, not in Cortex. Adding a strategy without cataloguing it is a red
build.

### Cortex: `GET /api/capabilities`

- New router `server/api/capabilities.ts` returns `getCapabilityManifest()` (cached; the manifest is
  static per process). No DB.
- Test: response shape + presence of the three previously-missing strategies + `withModelRouting`.

### Cortex: field-driven UI (full)

Chosen approach: **manifest drives the config UI; a Cortex-side presentation map adds polish and is
guard-tested for coverage.**

- **`ui/src/lib/capabilities.ts`** — loads `/api/capabilities` once (SvelteKit `load`), exposes a
  typed store.
- **`ui/src/lib/config-presentation.ts`** — a map keyed by `ConfigFieldDescriptor.path`/strategy
  name providing UI hints the manifest doesn't carry: widget (`toggle`, `slider`, `select`,
  `textarea`, `tag-input`, …), group (`Model`, `Reasoning`, `Execution`, `Tools`, `Memory`,
  `Guardrails`, `Observability`, `Durable`, …), display order, and conditional-visibility
  predicates (e.g. show `terminalShell*` only when `terminalTools`).
- **Generic renderer** (`ConfigFieldControl.svelte`) renders any manifest field from
  `(descriptor, presentationHint?)`. A field with **no** presentation hint renders with a sensible
  default widget inferred from `descriptor.type` — so a brand-new framework field appears
  automatically (unstyled but functional) rather than vanishing.
- **`AgentConfigPanel.svelte`** is refactored to iterate manifest groups instead of a hardcoded
  field list. Bespoke composite controls (MCP picker, agent-tools builder, skills paths) remain
  custom components slotted by `path`.
- **UI guard test** (`ui/src/lib/config-presentation.test.ts`): every manifest `configFields.path`
  and every strategy either has a presentation hint **or** intentionally falls through to the
  default widget (asserted allow-list), so we notice new fields at test time and can style them.

**Drift outcome:** framework guard keeps the manifest complete; Cortex UI guard keeps presentation
coverage visible. A new capability is worst-case *functional-but-plain* in Cortex with **zero code
changes**, and the UI test nudges a polish follow-up.

---

## A — Parity (falls out of B)

- `blueprint`, `code-action`, `direct` surface automatically once `STRATEGY_CATALOG` is populated
  and the UI reads the manifest. Add presentation hints (labels/help) for the three.
- **`withModelRouting`** (cost-aware routing, v0.13): add the `AgentConfig` field(s) + descriptor,
  wire once through the `LaunchParams` → `buildCortexAgent` path (`build-cortex-agent.ts` overlay,
  since routing config is richer than a scalar), presentation hint under a **Model / Routing** group.
- Any remaining `with*` the framework guard flags: wire config-backed ones through the pipeline;
  overlay ones through `build-cortex-agent.ts`.
- Keep `config-parity.test.ts` but re-point it to assert against the manifest (it becomes a thin
  wiring check rather than a hand-maintained field list).

---

## C — Run Control (correctness fix)

### Framework: AbortSignal on the `agent.run()` path

Today only `RunController` (stream path) holds an `AbortController` whose `signal` reaches
`local.ts` fetch. The `agent.run()` path gates on the killswitch only at phase boundaries.

Change:

1. **`KillSwitchService`** (`packages/guardrails/src/kill-switch.ts`) gains a per-agent
   `AbortController`. `terminate(agentId, reason)` calls `.abort()` in addition to marking triggered.
   Expose `signal(agentId): AbortSignal | undefined`.
2. **`execution-engine.ts`** run path threads that signal into the LLM call options (same seam the
   stream path uses — `complete()`/`stream()` accept `signal`). On abort, the in-flight fetch
   (incl. Ollama, which already forwards `signal` to `fetch` — `local.ts:351-365`) cancels
   immediately; the resulting AbortError is mapped to a clean `AgentTerminated`.
3. `stop()` (graceful) is unchanged in mechanism — it still resolves at the next boundary and runs
   synthesis — but is now clearly distinct from `terminate()` in the UI.
4. Guard test: with a `test`-provider slow/hanging completion, `terminate()` rejects the in-flight
   call promptly (assert elapsed ≪ the artificial delay) and emits `AgentTerminated`.

### Cortex: Stop vs Terminate + guaranteed dispose

- **Runner** (`server/services/runner-service.ts`): keep `stop` → `agent.stop()`; **add `terminate`
  → `agent.terminate()`**. Both must run `agent.dispose()` and remove the active entry. Refactor the
  current `.finally` dispose into a shared `finalizeRun(runId)` helper invoked from the normal
  completion path **and** from stop/terminate, so containers/subscriptions never leak on manual stop.
  (Today dispose only runs in the normal-completion `.finally`.)
- **`CortexRunnerService` interface** + `captureRunnerLayer` test stub gain `terminate`.
- **API** (`server/api/runs.ts`): add `POST /api/runs/:runId/terminate` alongside the existing
  stop/pause/resume actions.
- **UI:** active runs show **Stop** (graceful) and **Terminate** (immediate, styled as
  destructive). Terminate confirms only if a partial result would be lost.

---

## D — Detail-Screen UX

### Config snapshot per run

- **Schema:** `cortex_runs` gains a `launch_params_json` column (the resolved `LaunchParams` at
  start, minus secrets). Written in `runner-service.start` at `ensureRunRow` time.
- **API:** `GET /api/runs/:runId` includes the snapshot.

### Rerun (both modes)

- **`POST /api/runs/:runId/rerun`** — rebuilds `LaunchParams` from the stored snapshot and calls
  `runner.start`; returns the new `{ agentId, runId }`. Exact repeat.
- **Edit-and-rerun** — UI prefills the builder/config panel from the snapshot and routes through the
  normal `POST /api/runs`; no new endpoint.
- Guard: rerun of a run whose snapshot references a now-removed tool/MCP server surfaces a clear
  error rather than silently dropping it.

### Detail-screen controls

- Live **Stop / Terminate** buttons on `/runs/[runId]` (mirroring the grid), wired to the new
  endpoints, shown only while the run is active.
- **Config snapshot panel** rendering the manifest-labeled settings that produced the run (reuses
  the field-driven renderer read-only), and the entry point for **Rerun** / **Edit & Rerun**.

---

## Data Flow

```
Framework (runtime)
  STRATEGY_CATALOG ─┐
  AgentConfigSchema ─┼─► getCapabilityManifest() ──► Cortex GET /api/capabilities
  builderMethods[] ─┘                                     │
                                                          ▼
                            ui/lib/capabilities (store) + config-presentation (hints)
                                                          │
                                                          ▼
                              AgentConfigPanel (generic renderer, grouped)
                                                          │  POST /api/runs {config}
                                                          ▼
   runner.start ──► buildCortexAgent ──► agent.run(prompt,{taskId})
        │                                      │  events → ingest
        │  writes launch_params_json           ▼
        │                              KillSwitchService(signal) ──abort──► LLM fetch (Ollama)
        ▼
   finalizeRun(): unsubscribe + agent.dispose() + drop active   (stop | terminate | complete)
```

## Testing Strategy

- **Framework:** manifest completeness guard (strategies/builder/schema); terminate-aborts-in-flight
  timing test; manifest snapshot test.
- **Cortex server:** `/api/capabilities` shape + parity; `terminate` runner method disposes; rerun
  rebuilds params from snapshot; `launch_params_json` persisted.
- **Cortex UI:** presentation-coverage guard; generic renderer renders each field type; new-field
  fallthrough renders a default widget.

## Rollout / Risk

- B is additive (new export, new route) — no behavior change until the UI switches to the manifest.
- The `AgentConfigPanel` refactor is the largest UI change; land behind the generic renderer with
  the existing bespoke composites preserved to limit regression surface.
- C touches core runtime (`guardrails` + `execution-engine`) — smallest possible seam (reuse the
  existing `signal` option already consumed by the stream path); gated by the timing guard test.

## Open Questions (resolved)

- Manifest scope → **full field-driven UI** (with presentation-hint polish layer + guard).
- Rerun → **both** exact + edit-and-rerun.
- C scope → **framework fix + Cortex wiring** (genuine in-flight abort for Ollama).
