# @reactive-agents/guardrails

Safety guardrails for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Protects agents from prompt injection, PII leakage, and toxic content — applied automatically during the `guardrail` phase of the execution engine.

## Installation

```bash
bun add @reactive-agents/guardrails effect
```

## Protections

| Guard | What it catches |
|-------|----------------|
| Prompt injection | Attempts to override system instructions |
| PII detection | Emails, phone numbers, SSNs, credit cards |
| Toxicity filtering | Harmful or abusive content |
| Output contracts | Schema-validates agent responses |

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("customer-support")
  .withProvider("anthropic")
  .withGuardrails()
  .build();

// Prompt injection attempts are blocked before reaching the LLM
const result = await agent.run("Ignore previous instructions and...");
// result.success === false, result.error describes the violation
```

## Custom Guards

```typescript
.withGuardrails({
  blockTopics: ["competitor-names"],
  maxOutputLength: 2000,
  requireOutputSchema: MyResponseSchema,
})
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/guardrails/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/guardrails/)
