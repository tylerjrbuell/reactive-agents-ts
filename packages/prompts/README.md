# @reactive-agents/prompts

Prompt management for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

A template engine with variable interpolation and a built-in library of agent prompts for common use cases.

## Installation

```bash
bun add @reactive-agents/prompts effect
```

## Features

- **Template engine** — `{{variable}}` interpolation with type-safe bindings
- **Prompt library** — pre-built system prompts for researcher, coder, analyst, and more
- **Versioning** — store and retrieve prompt versions

## Usage

```typescript
import { PromptTemplate, PromptLibrary } from "@reactive-agents/prompts";

// Use a built-in prompt
const systemPrompt = PromptLibrary.get("researcher");

// Or define your own
const template = PromptTemplate.create({
  template: "You are a {{role}} expert. Answer in {{language}}.",
  variables: { role: "TypeScript", language: "English" },
});

const prompt = template.render({ role: "React", language: "Spanish" });
```

With the builder:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withPrompts({
    system: PromptLibrary.get("researcher"),
  })
  .build();
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
