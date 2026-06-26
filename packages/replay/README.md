# @reactive-agents/replay

> Deterministic re-run of recorded reactive-agent traces with prompt/model overrides

[![npm](https://img.shields.io/npm/v/@reactive-agents/replay?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/replay)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

**Deterministic agent replay** for Reactive Agents. Record an agent run once, then re-run it against a different model, system prompt, or temperature **without re-calling any tools** — recorded tool results are served back by hash, so you isolate the change you actually care about. Get a structural diff of iterations, tool sequence, output, tokens, cost, and duration between the original and the replay. Ideal for **regression testing, prompt iteration, and model comparison** on real traces.

## Install
```bash
bun add @reactive-agents/replay
# or: npm install @reactive-agents/replay
```

## Usage
Load a recorded run, then replay it through a builder function with overrides. Tool calls resolve from the recorded tool table instead of executing.

```typescript
import { loadRecordedRun, replay } from "@reactive-agents/replay";

// 1. Load a recorded run (ULID resolved under ~/.reactive-agents/traces/, or a path).
const run = await loadRecordedRun("latest");

// 2. Replay with overrides — the builder returns an agent with a run(task) method.
const result = await replay(
  run,
  async (ctx) => {
    // build your agent using ctx.overrides / ctx.recordedRun, then:
    return { run: async (task) => /* agent.run(task) */, dispose: async () => {} };
  },
  { model: "gpt-4o-mini", systemPrompt: "be concise", onMissingToolResult: "strict" },
);

// 3. Compare original vs. replay.
console.log(result.diff.identical, result.diff.tokensDelta, result.diff.toolSequenceDiff);
```

## API
- `replay(recordedRun, builderFn, overrides?)` — re-execute a run through `builderFn`, returning `{ original, replay, diff }`. `overrides`: `{ systemPrompt?, model?, temperature?, onMissingToolResult?: "strict" | "lenient" }`.
- `loadRecordedRun(idOrPath)` — parse a recorded JSONL trace into a `RecordedRun` (task, model, provider, config, trace, tool table).
- `makeReplayController(...)` / `makeReplayToolLayer(...)` — lower-level pieces that serve recorded tool results back to the kernel.
- `buildToolTable(...)` / `computeArgsHash(...)` — build the tool-result lookup table and hash tool args for matching.
- `snapshotFromRecordedRun(...)` / `snapshotFromAgentResult(...)` — produce comparable `TraceSnapshot`s.
- `diffTraces(a, b)` — structural `ReplayDiff` between two snapshots.
- Types: `RecordedRun`, `RecordedToolResult`, `ReplayOverrides`, `ReplayResult`, `TraceSnapshot`, `ReplayDiff`, `ToolSeqEdit`, `BuilderFn`, `BuildContext`, `AgentRunOutcome`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Observability docs](https://docs.reactiveagents.dev) and the [full documentation](https://docs.reactiveagents.dev).
