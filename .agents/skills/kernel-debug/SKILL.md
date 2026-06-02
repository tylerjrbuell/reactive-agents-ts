---
name: kernel-debug
description: Debug agent reasoning failures using the composable kernel phase map. Maps symptoms to specific files and grep commands. Use when an agent is not calling tools, looping, producing wrong output, or failing silently.
user-invocable: false
---

# Kernel Debug — Symptom to Phase Map

The composable kernel maps every failure symptom to a specific phase and file. Use this table to find the right code immediately rather than doing broad codebase exploration.

## Symptom → Phase → File

> Kernel paths reflect the Stage-5 capability layout (`kernel/capabilities/<cap>/`). The
> old `strategies/kernel/phases/` + `kernel-runner.ts` tree no longer exists.
>
> **Context assembly is mid-migration (branch `overhaul/agentic-core-2026-05-31`):** the
> LIVE default is `assembly/project()` + `assembly/stages/` (`RA_ASSEMBLY` default-on);
> `context/context-manager.ts` (`ContextManager.build` / `curate()`) is the LEGACY fallback,
> reached only under `RA_ASSEMBLY=0`, slated for deletion. The shared low-level builders
> `buildSystemPrompt`/`buildToolSchemas` (`attend/context-utils.ts`) are used by BOTH paths.

| Symptom | Capability | Files to Read |
|---------|------------|--------------|
| Agent never calls tools | `think.ts` (FC parsing) + `guard.ts` | `kernel/capabilities/reason/think.ts`, `kernel/capabilities/act/guard.ts`, `kernel/capabilities/act/tool-execution.ts` |
| Agent repeats the same tool call | `guard.ts` (dedup guard) | `kernel/capabilities/act/guard.ts` → `deduplicationGuard` |
| Infinite thought loop (no tools) | `loop-detector.ts` | `kernel/capabilities/reflect/loop-detector.ts` → `maxConsecutiveThoughts: 3` |
| Agent never reaches final answer | `act.ts` (final-answer gate) + `think.ts` (oracle) | `kernel/capabilities/act/act.ts` → final-answer gate, `kernel/capabilities/reason/think.ts` → oracle hard gate |
| Tool call silently rejected | `guard.ts` | `kernel/capabilities/act/guard.ts` → `defaultGuards[]` + `GuardOutcome` |
| Context too large / compaction fired | context assembly | LIVE: `assembly/project()` + `assembly/stages/`. LEGACY (`RA_ASSEMBLY=0`): `context/context-manager.ts` (`ContextManager.build`) |
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
                     Modified by: context-manager.ts (ContextManager.build), think.ts, act.ts

state.steps[]     ← What systems observe (entropy scoring, metrics, debrief)
                     Inspect for: wrong step counts, entropy values, tool stats
                     Modified by: act.ts, kernel/loop/runner.ts post-step hooks
```

Debug LLM behavior issues → `state.messages[]`
Debug metrics/entropy/observability issues → `state.steps[]`

## Targeted Grep Commands

```bash
# "Agent not calling tools" — check FC strategy negotiation
grep -n "toolSchemas\|buildToolSchemas\|fc_strategy" \
  packages/reasoning/src/kernel/capabilities/attend/context-utils.ts

# "Tool call blocked" — check guard chain
grep -n "defaultGuards\|GuardOutcome\|block:" \
  packages/reasoning/src/kernel/capabilities/act/guard.ts

# "Loop detected" — check loop detector thresholds
grep -n "maxConsecutiveThoughts\|loopDetected\|nudge" \
  packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts

# "Final answer never fires" — check oracle and final-answer gate
grep -n "final.answer\|oracle\|readyToAnswer\|hardGate" \
  packages/reasoning/src/kernel/capabilities/act/act.ts \
  packages/reasoning/src/kernel/capabilities/reason/think.ts

# "0 token failure" — check withheld error pattern
grep -n "withheld\|recoveryCount\|max_output_tokens" \
  packages/runtime/src/execution-engine.ts \
  packages/reasoning/src/kernel/loop/runner.ts

# "Context too large" — check compaction trigger
grep -n "compact\|contextPressure\|budget" \
  packages/reasoning/src/context/context-manager.ts \
  packages/reasoning/src/kernel/capabilities/attend/context-utils.ts
```

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

1. **Tools not in FC schema**: `buildToolSchemas()` in `context-builder.ts` filtered them out. Check `requiredTools` threading.
2. **All tools blocked by guard**: A guard in `defaultGuards[]` is blocking all calls. Check `guard.ts`.
3. **FC strategy mismatch**: Agent is using text-based tool call format but provider expects native FC. Check `fc_strategy` negotiation in `think.ts`.

### "Infinite loop" — 2 most common causes

1. **`maxConsecutiveThoughts: 3` not triggering**: Nudge observations need to reset the counter. Check if `loop-detector.ts` is receiving the right signals.
2. **Oracle not firing**: `readyToAnswer` signal is being sent but the oracle gate in `think.ts` isn't triggering exit. Check entropy threshold.

### "Silent LLM failure" — check this first

Before diving into kernel code, confirm the LLM call itself is not failing:

```bash
# Check for provider-level errors
grep -n "LLMError\|providerError\|status.*429\|status.*500" \
  packages/llm-provider/src/providers/
```

## Debug Workflow

1. Read the symptom → find the phase in the table above
2. Run the grep command for that symptom
3. Enable `logModelIO` to see the actual LLM input/output
4. Read the specific phase file — it's small (100–200 lines)
5. Add targeted test that reproduces the symptom (see `agent-tdd` skill)
6. Fix in the phase, verify test passes
