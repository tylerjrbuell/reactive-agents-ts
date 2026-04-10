---
name: quality-assurance
description: Enable output verification (hallucination detection, semantic entropy, self-consistency), add post-run verification steps, and run LLM-scored evals across 5 quality dimensions.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Quality Assurance

## Agent objective

Produce a builder with verification enabled and the right detectors active, plus an understanding of how to run LLM-scored evals against agent output using the `@reactive-agents/eval` package.

## When to load this skill

- Agent output must be factually accurate or grounded in retrieved content
- Detecting hallucinated or fabricated responses before returning them to users
- Running batch evaluation of agent quality across test cases
- Adding a post-reasoning reflection or self-check step to the pipeline

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 15 })
  .withTools({ allowedTools: ["web-search", "http-get", "checkpoint"] })
  .withVerification({
    semanticEntropy: true,      // estimate output confidence via entropy
    selfConsistency: true,      // check consistency across response variations
    hallucinationDetection: true,
    hallucinationThreshold: 0.15,  // flag if hallucination score > 0.15
    passThreshold: 0.75,           // reject outputs scoring below 0.75
  })
  .withVerificationStep({ mode: "reflect" })  // add a reflection phase at the end
  .build();
```

## Key patterns

### withVerification() — runtime output checking

```ts
.withVerification()
// Enables defaults: semanticEntropy=true, factDecomposition=true,
// selfConsistency=true, nli=true, passThreshold=0.7, riskThreshold=0.5

.withVerification({
  semanticEntropy: true,        // estimate output uncertainty via entropy
  factDecomposition: true,      // decompose and verify individual claims
  multiSource: true,            // cross-reference against multiple sources (default: false)
  selfConsistency: true,        // run variations and check consistency
  nli: true,                    // natural language inference entailment check
  hallucinationDetection: false, // dedicated hallucination layer (default: false)
  hallucinationThreshold: 0.10, // score above which output is flagged (0-1)
  passThreshold: 0.70,          // overall pass threshold (0-1)
  riskThreshold: 0.50,          // outputs below this risk score are flagged
})
```

### withVerificationStep() — post-reasoning verification pass

```ts
// Adds a dedicated verification phase after the main reasoning loop:

.withVerificationStep({ mode: "reflect" })
// Agent reflects on its own output for accuracy and completeness.
// Uses the same provider/model as the main agent.

.withVerificationStep({ mode: "loop" })
// Runs multiple verification passes until the output passes or max retries reached.

.withVerificationStep({
  mode: "reflect",
  prompt: "Check your answer for factual accuracy. Cite sources where possible.",
})
// Custom verification prompt.
```

### Eval scoring with @reactive-agents/eval

Run LLM-scored evaluations against a dataset of test cases:

```ts
import { EvalService, EvalServiceLive, makeEvalServiceLive } from "@reactive-agents/eval";
import { Effect } from "effect";

const evalSuite = {
  name: "agent-quality",
  cases: [
    {
      id: "test-1",
      input: "What is the capital of France?",
      expectedOutput: "Paris",
      context: "Geography question",
    },
  ],
};

const program = Effect.gen(function* () {
  const evalSvc = yield* EvalService;
  const run = yield* evalSvc.runSuite(evalSuite, agent);
  console.log(`Pass rate: ${run.summary.passRate * 100}%`);
  console.log(`Avg score: ${run.summary.averageScore}`);
});

await Effect.runPromise(
  Effect.provide(program, makeEvalServiceLive(anthropicLLM))
);
```

### 5 eval scoring dimensions

| Dimension | Scorer | What it measures |
|-----------|--------|-----------------|
| Accuracy | `scoreAccuracy` | Factual correctness vs expected output |
| Relevance | `scoreRelevance` | How well the response addresses the input |
| Completeness | `scoreCompleteness` | Coverage of required information |
| Safety | `scoreSafety` | Absence of harmful, biased, or dangerous content |
| Cost efficiency | `scoreCostEfficiency` | Tokens used relative to task complexity |

## VerificationOptions reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `semanticEntropy` | `boolean` | `true` | Uncertainty estimation via entropy |
| `factDecomposition` | `boolean` | `true` | Decompose and verify individual claims |
| `multiSource` | `boolean` | `false` | Cross-reference multiple sources |
| `selfConsistency` | `boolean` | `true` | Consistency across response variations |
| `nli` | `boolean` | `true` | Natural language inference entailment |
| `hallucinationDetection` | `boolean` | `false` | Dedicated hallucination detection layer |
| `hallucinationThreshold` | `number` | `0.10` | Flag score threshold (0-1) |
| `passThreshold` | `number` | `0.70` | Overall pass threshold (0-1) |
| `riskThreshold` | `number` | `0.50` | Risk score threshold (0-1) |

## Pitfalls

- `withVerification()` adds LLM calls — each verification check costs additional tokens; `multiSource` is the most expensive option (disabled by default)
- `withVerificationStep()` is separate from `withVerification()` — one adds a reasoning phase, the other adds runtime output checks; they can be used together
- `passThreshold: 0.7` is conservative — lower it (e.g., 0.6) for creative tasks where strict factual grounding is not required
- Eval scoring via `@reactive-agents/eval` uses an LLM judge — the scoring model must be separate from the agent under test for unbiased results
- `hallucinationDetection: true` adds significant latency — only enable it for high-stakes outputs
