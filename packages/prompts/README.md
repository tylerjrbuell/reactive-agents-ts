# @reactive-agents/prompts

Prompt management for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

A version-controlled template engine with `{{variable}}` interpolation, type-safe variable bindings, and a built-in library of agent prompts covering reasoning strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion), evaluation judges (accuracy, relevance, completeness, safety), and tier-adaptive system prompts (frontier vs. local models).

## Installation

```bash
bun add @reactive-agents/prompts
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Features

- **Template engine** — `{{variable}}` interpolation with required/optional variables, defaults, and type guards
- **Built-in template library** — reasoning, verification, evaluation, and default agent system prompts
- **Tier-adaptive variants** — separate `react-system-frontier`, `react-system-local`, `react-thought-frontier`, `react-thought-local` for cost-aware prompt routing
- **Version-controlled** — every template carries a `version` integer; `PromptService` looks up the latest unless pinned
- **Token estimator** — `estimateTokens()` for budget planning before render
- **A/B experiments** — `ExperimentService` (unstable) for prompt variant evaluation

## Quick Example

```typescript
import { interpolate } from "@reactive-agents/prompts";

const rendered = interpolate(
  "You are a {{role}} expert. Answer in {{language}}.",
  { role: "TypeScript", language: "English" },
);
```

## Built-in Templates

### Reasoning

| Template                                  | Strategy / phase                          |
| ----------------------------------------- | ----------------------------------------- |
| `reactTemplate`                           | High-level ReAct loop prompt              |
| `reactSystemTemplate`                     | ReAct system prompt                       |
| `reactThoughtTemplate`                    | ReAct thought-step prompt                 |
| `reactSystemFrontierTemplate` / `reactSystemLocalTemplate` | Tier-adaptive system variants |
| `reactThoughtFrontierTemplate` / `reactThoughtLocalTemplate` | Tier-adaptive thought variants |
| `planExecuteTemplate`                     | Plan-Execute high-level                   |
| `planExecutePlanTemplate`                 | Plan phase                                |
| `planExecuteExecuteTemplate`              | Execute phase                             |
| `planExecuteReflectTemplate`              | Reflect phase                             |
| `treeOfThoughtTemplate`                   | ToT high-level                            |
| `treeOfThoughtExpandTemplate`             | Expand candidate thoughts                 |
| `treeOfThoughtScoreTemplate`              | Score candidates                          |
| `treeOfThoughtSynthesizeTemplate`         | Synthesize chosen branch                  |
| `reflexionTemplate`                       | Reflexion high-level                      |
| `reflexionGenerateTemplate`               | Generate attempt                          |
| `reflexionCritiqueTemplate`               | Critique prior attempt                    |
| `adaptiveClassifyTemplate`                | Classify task complexity for routing      |

### Verification

| Template            | Use                              |
| ------------------- | -------------------------------- |
| `factCheckTemplate` | Fact-check decomposed claims     |

### Evaluation (judges)

| Template                       | Dimension       |
| ------------------------------ | --------------- |
| `judgeAccuracyTemplate`        | Accuracy        |
| `judgeRelevanceTemplate`       | Relevance       |
| `judgeCompletenessTemplate`    | Completeness    |
| `judgeSafetyTemplate`          | Safety          |
| `judgeGenericTemplate`         | Generic rubric  |

### Agent

| Template                  | Use                                     |
| ------------------------- | --------------------------------------- |
| `defaultSystemTemplate`   | Default agent system prompt             |

`allBuiltinTemplates` is a flat array of every template above — useful for bulk registration.

## Builder Integration

```typescript
import { ReactiveAgents } from "reactive-agents";

// Enable all built-in templates
const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic", { model: "claude-sonnet-4-20250514" })
  .withPrompts()
  .build();

// Or register custom templates at build time
const customAgent = await ReactiveAgents.create()
  .withName("custom")
  .withProvider("anthropic")
  .withPrompts({
    templates: [
      {
        id: "custom.system",
        name: "Custom System Prompt",
        version: 1,
        template: "You are a {{role}} expert. Answer in {{language}}.",
        variables: [
          { name: "role", required: true, type: "string" },
          { name: "language", required: false, type: "string", defaultValue: "English" },
        ],
      },
    ],
  })
  .build();
```

## Direct Service Usage

```typescript
import { Effect } from "effect";
import { PromptService, PromptServiceLive } from "@reactive-agents/prompts";

const program = Effect.gen(function* () {
  const prompts = yield* PromptService;
  const compiled = yield* prompts.compile("react.system", {
    role: "research assistant",
    tools: ["web_search", "calculator"],
  });
  return compiled.text;
});
```

## A/B Experiments (unstable)

```typescript
import { ExperimentService } from "@reactive-agents/prompts";
// Variant assignment, outcome capture, results aggregation.
// See AUDIT-overhaul-2026.md §11 #41 — surface may change in v0.10.x.
```

## Key Exports

| Export                                           | Purpose                                        |
| ------------------------------------------------ | ---------------------------------------------- |
| `PromptService`, `PromptServiceLive`             | Template registration + compilation            |
| `interpolate`, `estimateTokens`                  | Pure template-engine helpers                   |
| `allBuiltinTemplates`                            | Bulk registration array                        |
| `createPromptLayer`                              | Factory for the runtime layer                  |
| `ExperimentService`, `ExperimentServiceLive`     | A/B experimentation (unstable)                 |
| `PromptTemplate`, `CompiledPrompt`, `PromptVariable` | Schemas + types                            |
| `PromptError`, `TemplateNotFoundError`, `VariableError` | Tagged errors                          |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
