# @reactive-agents/prompts

> A versioned prompt template engine with built-in agent, reasoning and judge prompts for Reactive Agents.

> **Stability:** unstable. Template ids and variables may change between minors; `ExperimentService` (A/B variants) may change shape.

## Install

```bash
bun add @reactive-agents/prompts
# or: npm install @reactive-agents/prompts
```

The `reactive-agents` facade (`bun add reactive-agents`) re-exports the builder that enables this package.

## Usage

```ts
import { Effect } from "effect";
import { interpolate } from "@reactive-agents/prompts";

const template = {
  id: "custom.system",
  name: "Custom System Prompt",
  version: 1,
  template: "You are a {{role}} expert. Answer in {{language}}.",
  variables: [
    { name: "role", required: true, type: "string" },
    { name: "language", required: false, type: "string", defaultValue: "English" },
  ],
} as const;

// interpolate takes a template object and returns Effect<string, VariableError>.
const rendered = await Effect.runPromise(
  interpolate(template, { role: "TypeScript", language: "English" }),
);
```

Through the builder, `.withPrompts()` registers every built-in template. Pass `{ templates: [...] }` to add your own:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("custom")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
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

## API

| Export | Use it when |
|---|---|
| `PromptService`, `PromptServiceLive` | You register and compile templates in Effect code |
| `interpolate`, `estimateTokens` | You render or size a template without the service |
| `allBuiltinTemplates` | You bulk-register the built-in library (reasoning, verification, judge, default system prompts, tier variants) |
| `createPromptLayer` | You build the runtime layer yourself |
| `ExperimentService`, `ExperimentServiceLive` | You run A/B prompt experiments (unstable) |
| `PromptTemplate`, `CompiledPrompt`, `PromptVariable` | You type templates |
| `PromptError`, `TemplateNotFoundError`, `VariableError` | You handle tagged errors |

The full template list and experiment lifecycle live in the docs.

## Documentation

- [Prompts](https://docs.reactiveagents.dev/features/prompts/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
