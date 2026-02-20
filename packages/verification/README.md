# @reactive-agents/verification

Output verification for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Reduces hallucinations by measuring semantic entropy (consistency across multiple samples) and decomposing claims into verifiable facts.

## Installation

```bash
bun add @reactive-agents/verification effect
```

## Techniques

| Technique | How it works |
|-----------|-------------|
| Semantic entropy | Samples the LLM N times; high variance → low confidence |
| Fact decomposition | Breaks output into atomic claims, checks each independently |

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("fact-checker")
  .withProvider("anthropic")
  .withVerification()
  .build();

const result = await agent.run("What year did the Berlin Wall fall?");
console.log(result.metadata.confidence); // 0.0–1.0
```

When confidence is below the threshold, the agent can re-sample or escalate to the user depending on the active interaction mode.

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
