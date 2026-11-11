---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Structured output can now be saved with an agent, reported, and asked for on a single turn.

- `.withOutputSchema()` also accepts a plain JSON Schema object, validated deterministically without a model call. Unsupported keywords throw `OutputSchemaError` naming the keyword and its path.
- `AgentConfig.outputSchema` holds the schema as JSON Schema. `toConfig()` writes it for any schema with a JSON Schema form (Effect, Zod, Valibot, ArkType, JSON Schema), and `agentConfigToBuilder()` / `agentConfigToSource()` apply it again with `outputSchemaOptions`.
- `result.objectReport` says how `result.object` was obtained, or why it failed (layer, attempts, repairs, coercion, field errors). `StructuredOutputError.report` carries it in throw mode.
- `runStream(task, { outputSchema })` applies a schema to one turn: `StreamCompleted` carries `object`, `objectError` and `objectReport`, and `AgentStream.collect()` copies them onto the result.
- At density `"full"`, `ToolCallStarted` stream events carry the call's `args`, and `StructuredOutputReported` bus events are forwarded as stream events.
