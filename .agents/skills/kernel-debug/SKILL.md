---
name: kernel-debug
description: Debug agent reasoning failures using the composable kernel phase map. Maps symptoms to specific files and `repo find` queries. Use when an agent is not calling tools, looping, producing wrong output, or failing silently.
user-invocable: false
---

# Kernel Debug — Symptom to Phase Map

The composable kernel maps every failure symptom to a specific phase and file. Use this table to find the right code immediately rather than doing broad codebase exploration.

## Symptom → Phase → File

> Paths below are under `packages/reasoning/src/` (capability layout `kernel/capabilities/<cap>/`).
> Context assembly: `assembly/project.ts` is the sole live assembler (`ContextManager` was deleted 2026-07-07).
> Find a symbol: `bun run repo find "<symbol>" --code`; list a file's exports: `bun run repo outline <file>`.

| Symptom | Capability | Files to Read |
|---------|------------|--------------|
| Agent never calls tools | `think.ts` (FC parsing) + `guard.ts` | `kernel/capabilities/reason/think.ts`, `kernel/capabilities/act/guard.ts`, `kernel/capabilities/act/tool-execution.ts` |
| Agent repeats the same tool call | `guard.ts` (dedup guard) | `kernel/capabilities/act/guard.ts` → `deduplicationGuard` |
| Infinite thought loop (no tools) | `loop-detector.ts` | `kernel/capabilities/reflect/loop-detector.ts` → `maxConsecutiveThoughts: 3` |
| Agent never reaches final answer | `act.ts` (final-answer gate) + `think.ts` (oracle) | `kernel/capabilities/act/act.ts` → final-answer gate, `kernel/capabilities/reason/think.ts` → oracle hard gate |
| Tool call silently rejected | `guard.ts` | `kernel/capabilities/act/guard.ts` → `defaultGuards[]` + `GuardOutcome` |
| Context too large / compaction fired | context assembly | `assembly/project.ts` (`project()`) + `assembly/stages/` |
| Agent fails immediately with 0 tokens | `execution-engine.ts` (withheld error) | `packages/runtime/src/execution-engine.ts` → withheld error pattern |
| `max_output_tokens` error surfaces immediately | `runner.ts` (missing recovery) | `kernel/loop/runner.ts` → `withheldError` + recovery count |
| System prompt not reaching LLM | context assembly | `kernel/capabilities/attend/context-utils.ts` → `buildSystemPrompt()` |
| Tool schemas not in LLM call | context assembly | `kernel/capabilities/attend/context-utils.ts` → `buildToolSchemas()` |
| EventBus events not firing | `execution-engine.ts` | `packages/runtime/src/execution-engine.ts` → ManagedRuntime shared instance |
| Memory not persisting between turns | `think.ts` / `act.ts` | `state.messages[]` vs `state.steps[]` — see Two Records section |

## Two State Records — Which to Inspect

```
state.messages[]  ← What the LLM sees (multi-turn FC conversation thread)
                     Inspect for: wrong context, missing tool results, bad message order
                     Modified by: assembly/project.ts, think.ts, act.ts

state.steps[]     ← What systems observe (entropy scoring, metrics, debrief)
                     Inspect for: wrong step counts, entropy values, tool stats
                     Modified by: act.ts, kernel/loop/runner.ts post-step hooks
```

Debug LLM behavior issues → `state.messages[]`
Debug metrics/entropy/observability issues → `state.steps[]`

## Find it fast

`bun run repo find "<term>" --code`, one query per symptom: `buildToolSchemas` / `fc_strategy` (tools not offered), `defaultGuards` / `GuardOutcome` (call blocked), `maxConsecutiveThoughts` (loop), `readyToAnswer` / `hardGate` (no final answer), `withheldError` / `recoveryCount` (0-token failure), `contextPressure` (compaction). To diagnose a recorded run instead, `rax-diagnose cause <runId|path>`.

## Enable Full Prompt Logging

When you need to see the exact prompts and responses the LLM is receiving:

```typescript
// In your agent builder:
ReactiveAgents.create()
  .withLogModelIO(true)  // Logs all LLM requests + responses to console
  .build()
```

Or set the environment variable:

```bash
RAX_LOG_MODEL_IO=true bun run your-script.ts
```

This outputs the full system prompt, message thread, and tool schemas sent on each turn, plus the raw LLM response. The highest-signal debug tool for LLM behavior issues.

## Common Root Causes

### "Agent not calling tools" — 3 most common causes

1. **Tools not in FC schema**: `buildToolSchemas()` in `attend/context-utils.ts` filtered them out. Check `requiredTools` threading.
2. **All tools blocked by guard**: A guard in `defaultGuards[]` is blocking all calls. Check `guard.ts`.
3. **FC strategy mismatch**: Agent is using text-based tool call format but provider expects native FC. Check `fc_strategy` negotiation in `think.ts`.

### "Infinite loop" — 2 most common causes

1. **`maxConsecutiveThoughts: 3` not triggering**: Nudge observations need to reset the counter. Check if `loop-detector.ts` is receiving the right signals.
2. **Oracle not firing**: `readyToAnswer` signal is being sent but the oracle gate in `think.ts` isn't triggering exit. Check entropy threshold.

### "Silent LLM failure" — check this first

Before diving into kernel code, confirm the LLM call itself is not failing:

`bun run repo find "LLMError" --code` (provider errors live in `packages/llm-provider/src/providers/`).

## Debug Workflow

1. Read the symptom → find the phase in the table above
2. `bun run repo find` the symbol for that symptom
3. Enable `logModelIO` to see the actual LLM input/output
4. Read the specific phase file — it's small (100–200 lines)
5. Add targeted test that reproduces the symptom (see `agent-tdd` skill)
6. Fix in the phase, verify test passes
