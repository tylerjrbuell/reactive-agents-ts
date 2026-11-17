# @reactive-agents/replay

> Re-run a recorded Reactive Agents trace against a different model, prompt or temperature, serving recorded tool results back, and diff the outcome.

[![npm](https://img.shields.io/npm/v/@reactive-agents/replay?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/replay)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/features/snapshot-replay/)

> **Stability:** stable. The replay API (`loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`) is listed as tier-1 in the stability reference.

## Install

```bash
bun add @reactive-agents/replay
# or: npm install @reactive-agents/replay
```

## Usage

Load a recorded run, replay it through an agent factory with overrides, and read the structural diff. Tool calls resolve from the recorded tool table (matched by args hash) instead of executing, so only the change you made moves.

```ts
import { loadRecordedRun, replay, type AgentRunOutcome } from "@reactive-agents/replay";

// Your own agent: anything with run(task) returning an AgentRunOutcome.
declare const myAgent: { run(task: string): Promise<AgentRunOutcome> };

// A run ID (resolved under ~/.reactive-agents/traces/) or a path to a .jsonl trace.
const run = await loadRecordedRun("<runId>");

const result = await replay(
  run,
  async (ctx) => {
    // Build your agent from ctx.overrides and ctx.recordedRun.
    // Return an object with run(task) and optional dispose().
    return {
      run: async (task: string): Promise<AgentRunOutcome> => myAgent.run(task),
      dispose: async () => {},
    };
  },
  { model: "gpt-4o-mini", systemPrompt: "be concise", onMissingToolResult: "strict" },
);

console.log(result.diff.identical, result.diff.tokensDelta, result.diff.toolSequenceDiff);
```

`myAgent` is declared above only so the block type-checks; swap in your own agent. The factory is where you wire `makeReplayToolLayer` so recorded results are served. A full runnable example lives in `src/e2e.test.ts` in the repository.

## API

| Export | Use it when |
|---|---|
| `replay(recordedRun, builderFn, overrides?)` | You want `{ original, replay, diff }` for a recorded run. Overrides: `systemPrompt`, `model`, `temperature`, `onMissingToolResult` (`"strict"` or `"lenient"`). |
| `loadRecordedRun(idOrPath)` | You need a `RecordedRun` (task, model, provider, config, trace, tool table) from a JSONL trace. |
| `makeReplayController` / `makeReplayToolLayer` | You build the replay harness yourself and need recorded tool results served to the kernel. |
| `makeReplayLLMLayer` / `buildLLMTable` | You want recorded model exchanges served back too. |
| `buildToolTable` / `computeArgsHash` | You need the tool-result lookup table or the args hash used to match calls. |
| `snapshotFromRecordedRun` / `snapshotFromAgentResult` | You want comparable `TraceSnapshot`s. |
| `diffTraces(a, b)` | You want a structural `ReplayDiff` (iterations, tool sequence, output, tokens, cost, duration) between two snapshots. |

## Documentation

- [Snapshot and replay](https://docs.reactiveagents.dev/features/snapshot-replay/)
- [Decision tracing](https://docs.reactiveagents.dev/concepts/decision-tracing/)
- [`@reactive-agents/diagnose` on npm](https://www.npmjs.com/package/@reactive-agents/diagnose) prints recorded-run metadata with `rax-diagnose replay-run <runId>`.

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
