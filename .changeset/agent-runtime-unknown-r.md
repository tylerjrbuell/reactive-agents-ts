---
"@reactive-agents/runtime": patch
"@reactive-agents/core": patch
---

Type tightening, no behavior change. `ReactiveAgent.runtime` is now `ManagedRuntime<unknown, never>` (was `<any, never>`): effects run through it must be requirement-free, which the unsound `any` previously let slip past the compiler. Engine tool definitions (`cachedToolDefs`) are now typed `ToolDefinition`. `@reactive-agents/core`: the `AgentEvent` union is split into domain sub-unions under `types/events/`; `services/event-bus` still re-exports every type, so imports are unchanged.
