---
title: Prompt Templates
description: Version-controlled prompt templates with variable interpolation and composition.
sidebar:
  order: 7
---

The prompts layer provides a template engine for managing, versioning, and composing prompts. Define reusable templates with typed variables, track versions, and compose complex prompts from smaller pieces.

## Quick Start

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withPrompts()   // Enable prompt template engine
  .build();
```

## Defining Templates

Templates use `{{variable}}` syntax for interpolation:

```typescript
import { PromptService } from "@reactive-agents/prompts";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const prompts = yield* PromptService;

  // Register a template
  yield* prompts.register({
    id: "research-task",
    name: "Research Task",
    version: 1,
    template: `You are a {{role}} researching {{topic}}.

Your goal is to {{objective}}.

Focus on these aspects:
{{#each aspects}}
- {{this}}
{{/each}}

Provide your findings in {{format}} format.`,
    variables: [
      { name: "role", required: true, type: "string", description: "Agent's role" },
      { name: "topic", required: true, type: "string", description: "Research topic" },
      { name: "objective", required: true, type: "string", description: "Research goal" },
      { name: "aspects", required: false, type: "array", description: "Focus areas" },
      { name: "format", required: false, type: "string", description: "Output format", defaultValue: "markdown" },
    ],
    metadata: {
      author: "team",
      description: "General-purpose research prompt",
      tags: ["research", "analysis"],
      maxTokens: 4096,
    },
  });
});
```

## Compiling Templates

Compile a template by interpolating variables:

```typescript
const compiled = yield* prompts.compile("research-task", {
  role: "senior analyst",
  topic: "quantum computing applications",
  objective: "identify the top 5 commercial applications",
  format: "bullet points",
});

console.log(compiled.content);
// "You are a senior analyst researching quantum computing applications..."

console.log(compiled.tokenEstimate);
// Estimated token count for the compiled prompt
```

### Token-Aware Compilation

Set a max token budget — the template engine truncates if the compiled prompt exceeds it:

```typescript
const compiled = yield* prompts.compile("research-task", variables, {
  maxTokens: 1000,  // Truncate to fit within 1000 tokens
});
```

## Composing Prompts

Combine multiple compiled prompts into one:

```typescript
const systemPrompt = yield* prompts.compile("system-context", { agent: "researcher" });
const taskPrompt = yield* prompts.compile("research-task", { topic: "CRISPR" });
const formatPrompt = yield* prompts.compile("output-format", { format: "academic" });

const combined = yield* prompts.compose(
  [systemPrompt, taskPrompt, formatPrompt],
  { separator: "\n\n---\n\n", maxTokens: 8000 },
);

console.log(combined.content);       // All three prompts joined
console.log(combined.tokenEstimate); // Total token estimate
```

## Version Control

Templates are automatically versioned. Register a new version by using the same `id`:

```typescript
// Version 1
yield* prompts.register({
  id: "research-task",
  name: "Research Task",
  version: 1,
  template: "Original template...",
  variables: [...],
});

// Version 2 (improved)
yield* prompts.register({
  id: "research-task",
  name: "Research Task v2",
  version: 2,
  template: "Improved template with better instructions...",
  variables: [...],
});

// Get specific version
const v1 = yield* prompts.getVersion("research-task", 1);

// Get all versions
const history = yield* prompts.getVersionHistory("research-task");
// Sorted by version number
```

## Built-in Templates

The framework includes templates for internal reasoning strategies:

| Template | Used By |
|----------|---------|
| `react` | ReAct reasoning strategy |
| `plan-execute` | Plan-Execute-Reflect strategy |
| `reflexion` | Reflexion self-improvement strategy |
| `tree-of-thought` | Tree-of-Thought exploration strategy |
| `fact-check` | Verification layer |

These are used internally by the reasoning and verification layers — you don't need to register them manually.

## Template Variables

Each variable has a type and can be required or optional:

| Type | Description |
|------|-------------|
| `string` | Text value |
| `number` | Numeric value |
| `boolean` | True/false |
| `array` | List of values |
| `object` | Key-value map |

Optional variables can have a `defaultValue` that's used when the variable isn't provided during compilation.
