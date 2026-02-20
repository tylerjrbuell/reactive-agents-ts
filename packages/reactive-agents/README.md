# reactive-agents

**The composable AI agent framework built on Effect-TS.**

Type-safe from prompt to production.

[![CI](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/reactive-agents)](https://www.npmjs.com/package/reactive-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

This is the **meta-package** — it re-exports everything from the 14 individual `@reactive-agents/*` packages so you can get started with a single install.

## Installation

```bash
bun add reactive-agents effect
```

## Quick Start

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withReasoning()
  .withGuardrails()
  .build();

const result = await agent.run("Summarize the key findings from this paper");
console.log(result.output);
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY for OpenAI
```

## What's Included

| Sub-package | Exported as |
|-------------|-------------|
| `@reactive-agents/runtime` | `ReactiveAgents`, `createRuntime` |
| `@reactive-agents/core` | `AgentService`, `EventBus`, ... |
| `@reactive-agents/llm-provider` | `createLLMLayer` |
| `@reactive-agents/memory` | `createMemoryLayer` |
| `@reactive-agents/reasoning` | `createReasoningLayer` |
| `@reactive-agents/tools` | `createToolsLayer` |
| `@reactive-agents/guardrails` | `createGuardrailsLayer` |
| `@reactive-agents/verification` | `createVerificationLayer` |
| `@reactive-agents/cost` | `createCostLayer` |
| `@reactive-agents/identity` | `createIdentityLayer` |
| `@reactive-agents/observability` | `createObservabilityLayer` |
| `@reactive-agents/interaction` | `createInteractionLayer` |
| `@reactive-agents/orchestration` | `createOrchestrationLayer` |
| `@reactive-agents/prompts` | `createPromptsLayer` |

## Modular Install

Prefer installing only what you need? Use the individual scoped packages:

```bash
bun add @reactive-agents/core @reactive-agents/runtime @reactive-agents/llm-provider effect
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
