---
title: The Process Model
description: >-
  Agents are processes: inspect a live run, pause and fork it from any
  checkpoint, and get a signed trust receipt grading how the answer was
  produced.
sidebar:
  order: 22
---

An agent run in Reactive Agents behaves like an OS process, not a fire-and-forget function call. Every durable run has an identity (`runId`), a live control plane (pause / resume / stop / inspect), an on-disk checkpoint history you can fork from, and a graded evidence trail — the trust receipt — attached to its result.

Runnable end-to-end demo: [`apps/examples/src/advanced/process-model-demo.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/advanced/process-model-demo.ts) (local Ollama, no API key).

## The process model

`agent.runStream()` returns a `RunHandle` — an async iterator of stream events that is also the run's control plane:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")
  .withTools({ tools: [calculatorTool] })
  .withReasoning()
  .withDurableRuns({ dir })   // checkpoints + fork/resume need this
  .build();

const handle = agent.runStream("Compute 137*89, add 4455, divide by 7 — use the calculator for every step.");

handle.status();   // "running" | "paused" | "stopped" | "terminated" | "completed"
handle.pause();    // freeze at the next iteration boundary
handle.resume();   // continue from paused
handle.stop();     // graceful: synthesize, emit StreamCompleted
handle.inspect();  // live kernel-state snapshot (below)
```

### `inspect()` — live kernel-state introspection

`handle.inspect()` projects the most recent iteration-boundary checkpoint into a small, stable shape — while the run is still going:

```typescript
const snap = handle.inspect();
// {
//   status: "running",
//   iteration: 2,
//   stepsCount: 6,
//   messagesCount: 5,
//   lastThought: "The product is 12193, now I need to add 4455…",  // ≤500 chars
//   pendingToolCalls: ["calculator"],
//   capturedAt: 1751712000000,
// }
```

It returns `undefined` before the first iteration boundary and on non-kernel paths (`inspect()` requires `.withReasoning()` — the kernel notes a checkpoint at every iteration boundary). It never throws, and a run that never calls `inspect()` pays zero serialization cost: the snapshot is a lazy thunk, only invoked when you ask.

### `fork()` — counterfactual restart from a checkpoint

`agent.fork(runId, opts?)` starts a **brand-new run** seeded from any checkpoint of a prior durable run:

```typescript
const result = await agent.fork(runId, { at: 1 });     // restart from iteration ≤ 1
// result is a normal AgentResult (fork mirrors resume, not runStream)

const runs = await agent.listRuns();
// the fork row: runId "<src>-fork-3f2a", forkedFrom: "<src>", forkedAtIteration: 1
```

Options: `at` (checkpoint iteration, defaults to the latest), `task` (override the re-run input), `model` (override the model for this run only).

**Honest scoping — this is a counterfactual restart, not time-travel.** The forked run replays *nothing*: it restores the recorded kernel state at the fork point and then continues with **live, fresh LLM calls** against the current provider. Same state, new future. Fork requires `.withDurableRuns()` and the kernel path (`.withReasoning()`); v1 forks under the same agent instance (same tools and system prompt). Two known caveats:

- A run currently paused awaiting approval/interaction may not have flushed its latest checkpoint — forking it can see a stale or absent checkpoint row.
- The `model` override has no effect when `.withModelRouting()` is enabled (the routing phase recomputes the model independently — known v1 gap). Don't combine them.

## The trust receipt

Every terminal result carries `result.receipt` — **graded evidence about HOW the answer was produced, not a truth certificate**. It grades the run's evidence trail (did the answer come from tool observations, or from the model's own head?), never the factual correctness of the output.

```typescript
const result = await agent.run("Compute 137*89 with the calculator.");
result.receipt;
// {
//   verdict: "tool-grounded",
//   method: "heuristic",
//   confidence: 0.8,
//   toolsUsed: ["calculator"],
//   toolCallStats: { ok: 3, failed: 0 },
//   terminatedBy: "final_answer",
//   modelId: "qwen3:4b",
//   computedAt: 1751712000000,
// }
```

It is computed from in-memory run data at result assembly — present even with tracing disabled — and attached on both the promise path (`result.receipt`) and the streaming path (`StreamCompleted.receipt`, plus a `TrustEvent` before it; `AgentStream.collect()` carries it through). Paused runs (awaiting approval/interaction) get **no** receipt: receipts belong to terminal results only.

### Deliverable truth (`receipt.deliverables[]`)

When the run's compiled contract declared at least one concrete deliverable (a file to write, an answer section, a structured object), the receipt carries a `deliverables[]` array naming each one as produced or missing:

```typescript
result.receipt?.deliverables;
// [
//   { spec: "produce the file ./report.md",  produced: true  },
//   { spec: "produce the file ./summary.md", produced: false },  // never landed
// ]
```

Each entry is `{ spec: string; produced: boolean }`. `produced: false` names a **missing** output — so a partial multi-file run reports exactly which deliverables never landed instead of claiming success. The check runs against the run's append-only evidence ledger (which records artifacts written by the built-in file-write tool as well as by code-execute / shell / MCP tools, each with a content digest). The field is **absent** for pure Q&A runs that declared no deliverable, keeping those receipts byte-identical to before. Declare deliverables explicitly with [`.withContract()`](/reference/builder-api/); the harness also infers them from task phrasing that names files or outputs.

### Verdicts

Deterministic rules, evaluated in order — first match wins:

| Verdict | Rule | Confidence |
| --- | --- | --- |
| `abstained` | the run ended by declining (`terminatedBy: "abstained"`) — wins over everything | 0.95 |
| `failed` | the run did not succeed | 0.95 |
| `tool-grounded` | ≥1 successful substantive tool call and the goal wasn't marked unachieved | 0.8 |
| `partially-grounded` | tools were attempted but none succeeded | 0.6 |
| `ungrounded` | zero substantive tool calls — the model answered from itself. Fine for pure-knowledge tasks, and now *visible* | 0.8 |

`confidence` is confidence in the **verdict itself**, not in the answer.

Two honest footnotes:

- **"Substantive" tool calls** exclude the kernel's own meta/termination/memory-retrieval tools (`final-answer`, `task-complete`, `recall`, `checkpoint`, `abstain`, …). Every kernel run terminates through `final-answer` — if it counted, `ungrounded` would be unreachable and the receipt would be meaningless. Only real work counts as grounding evidence.
- **`toolCallStats.ok` means executor-level success** — the tool ran without erroring. It does not grade the semantic quality of what the tool returned.

### Signing (optional, Ed25519)

Configure a key and every receipt is signed:

```typescript
import { generateReceiptKeyPair, verifyReceipt } from "@reactive-agents/runtime";

const { privateKeyJwk } = await generateReceiptKeyPair();

const agent = await ReactiveAgents.create()
  /* … */
  .withReceiptSigning({ privateKeyJwk })   // or env: RA_RECEIPT_KEY (JWK JSON)
  .build();

const result = await agent.run("…");
await verifyReceipt(result.receipt!);      // true — public key is embedded in the signature
```

The signature certifies **provenance**: *this receipt, for this run, untampered* — the receipt bytes were produced by the holder of the embedded key and haven't been altered since. It never certifies that the answer is correct, and it doesn't change what `verdict` means. Unsigned is the default (zero overhead).

## CLI: `rax ps` and `rax attach`

Durable runs live in `~/.reactive-agents/<agentId>/runs.db` (or the `.withDurableRuns({ dir })` you configured). The CLI reads the same substrate:

```bash
rax ps                 # active (non-terminal) runs across ~/.reactive-agents/*/runs.db
rax ps --all           # include completed / failed
rax ps --db ./runs.db  # scan one specific RunStore db
```

```text
Runs
  RUN ID           STATUS               AGENT            TASK
  2he5bx8bquo6k-fork-acc1 completed     process-model-demo Compute 137*89… [FORKED-FROM 2he5bx8bquo6k@1]
  2he5bx8bquo6k    completed            process-model-demo Compute 137*89…
```

`rax attach <runId>` tails a run's status and checkpoint iteration (1s poll) until it reaches a terminal status — Ctrl-C detaches without stopping the run:

```text
Attaching to 2he5bx8bquo6k
  status: running
  iteration: 1
  iteration: 2
  iteration: 3
  status: completed
```

## Exact replay

Recorded runs (JSONL traces with `llm-exchange` events) can be re-executed with **zero LLM tokens** via `makeReplayLLMLayer` from `@reactive-agents/replay`:

```typescript
import { loadRecordedRun, makeReplayLLMLayer } from "@reactive-agents/replay";

const run = await loadRecordedRun("r-abc123");           // resolves ~/.reactive-agents/traces/r-abc123.jsonl
const llmLayer = makeReplayLLMLayer(run.llmTable);        // dispenses recorded LLM responses
// provide llmLayer in place of the live provider — the whole run re-executes
// from the recording: same thoughts, same tool calls, zero tokens.
```

**Honest scoping — this is exact-replay only, not general deterministic re-execution.** Responses are keyed on a hash of the exact recorded request (system prompt + messages). Any change that alters the rendered prompt — a model swap, a prompt-template edit, a tool-schema change — produces a different key and **misses loudly** (the run dies with a descriptive error) rather than silently falling back to a live call. Unchanged prompts and config replay for free; anything else needs a re-recording. Tool-result replay (the `replay()` API with frozen tool tables and diffing) is documented separately in [Snapshot & Replay](/features/snapshot-replay/).

## Putting it together

The 90-second arc, from the demo script:

1. `runStream()` a multi-step tool task on a durable agent.
2. Call `handle.inspect()` while it runs — watch `iteration`/`stepsCount` advance.
3. On `StreamCompleted`, read `receipt` — `tool-grounded`, with the actual tool names as evidence.
4. `agent.fork(runId, { at: 1 })` — a second, live run continues from iteration 1's state.
5. `agent.listRuns()` / `rax ps --all` — the fork row carries `forkedFrom` lineage.

```bash
bun apps/examples/src/advanced/process-model-demo.ts
```
