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

// Enable built-in prompt templates (reasoning, evaluation, agent)
const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withPrompts()          // registers all built-in templates
  .build();

// Or register custom templates at build time:
const customAgent = await ReactiveAgents.create()
  .withName("custom")
  .withProvider("anthropic")
  .withPrompts({
    templates: [{
      id: "custom.system",
      name: "Custom System Prompt",
      version: 1,
      template: "You are a {{role}} expert. Answer in {{language}}.",
      variables: [
        { name: "role", required: true, type: "string" },
        { name: "language", required: false, type: "string", defaultValue: "English" },
      ],
    }],
  })
  .build();
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
