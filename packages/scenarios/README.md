# @reactive-agents/scenarios

> Pre-built test scenarios and fixtures for Reactive Agents.

[![npm](https://img.shields.io/npm/v/@reactive-agents/scenarios?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/scenarios)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

A curated set of agent test scenarios — each one is a task designed to provoke a specific failure mode (loop-prone, tool-failure, context-pressure, long-horizon, schema-drift) so you can evaluate whether the reactive harness keeps an agent on track. Every scenario ships its own task prompt, success criteria, expected failure-without-harness, and preferred models for reproducible benchmarking.

## Install
```bash
bun add @reactive-agents/scenarios
# or: npm install @reactive-agents/scenarios
```

## Usage

```ts
import { allScenarios, loopProneHaiku } from "@reactive-agents/scenarios";

// Run one scenario
const scenario = loopProneHaiku;
console.log(scenario.task);                    // the prompt to send the agent
const output = await runYourAgent(scenario.task);
const passed = scenario.successCriteria(output);

// Or iterate the whole suite
for (const s of allScenarios) {
  console.log(`${s.id} — expects "${s.expectedFailureWithoutRI}" without the harness`);
}
```

Each `Scenario` exposes:

```ts
interface Scenario {
  readonly id: string;
  readonly description: string;
  readonly task: string;
  readonly tags: readonly ScenarioTag[];
  readonly expectedFailureWithoutRI: FailureMode;
  readonly successCriteria: (output: string) => boolean;
  readonly preferredModels: readonly string[];
  readonly setup?: () => Promise<{ tools?: unknown; teardown?: () => Promise<void> }>;
}
```

## API

- `allScenarios` — array of every bundled scenario.
- Individual scenarios: `loopProneHaiku`, `toolFailureWebSearch`, `contextPressureNoisy`, `longHorizonRepoTriage`, `schemaDriftSql`.
- Types: `Scenario`, `ScenarioTag`, `FailureMode`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [full documentation](https://docs.reactiveagents.dev).
