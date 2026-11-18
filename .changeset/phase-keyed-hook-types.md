---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

`.withHook()` handlers are now typed with the context each phase actually receives. `LifecycleHook` is a union keyed by `phase` (and `timing` for per-turn phases):

- Engine phases (`bootstrap`, `guardrail`, ..., `complete`) get the full `ExecutionContext`, as before.
- `think`, `act` and `observe` get `KernelTurnHookContext | ExecutionContext`. The kernel fires them once per turn with `{ phase, iteration, state }`; the engine also fires `think` once around each reasoning call, and `act`/`observe` only for a custom (non-kernel) `ReasoningService`. Narrow with `"metadata" in ctx`. `on-error` on these phases gets `KernelTurnErrorHookContext` (`{ phase, iteration }`, no state) or `ExecutionContext`.
- Kernel-fired hooks now receive the kernel `state` they are typed with (they used to get only `phase` and `iteration`).

Possible TypeScript break: code that read `ctx.metadata`, `ctx.toolResults`, `ctx.selectedStrategy` or other engine fields in a `think`/`act`/`observe` hook without narrowing no longer compiles. Those fields were always `undefined` on the per-turn firings. `LifecycleHook` is now a type alias, so `interface X extends LifecycleHook` must become an intersection. Returning the received `ctx` still type-checks. New exported types: `KernelTurnHookContext`, `KernelTurnErrorHookContext`, `KernelTurnPhase`, `EngineLifecyclePhase`, `EngineLifecycleHook`, `KernelTurnLifecycleHook`, `KernelTurnErrorLifecycleHook`. `RawHookResult` takes an optional context type parameter (default `ExecutionContext`).

`.withMinIterations(n)` docs now say what it does: the run continues until it reaches N kernel turns, the unit `metadata.iterations` reports.
