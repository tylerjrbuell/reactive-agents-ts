---
title: Verification
description: Fact-checking and output quality verification using semantic entropy, fact decomposition, NLI, and hallucination detection.
sidebar:
  order: 2
---

The verification layer fact-checks agent outputs before they reach the user. It decomposes responses into claims, measures confidence, and flags unreliable content.

## How It Works

When verification is enabled, the execution engine runs the agent's output through up to 6 verification layers after the Think/Act/Observe loop completes. Each layer produces a score, and the results are combined into an overall confidence assessment.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withVerification()   // Enable fact-checking
  .build();

const result = await agent.run("Explain the causes of World War I");
// Output is verified before being returned
```

## Verification Layers

### Semantic Entropy

Measures word diversity and detects hedging language. High entropy (diverse vocabulary) with minimal hedging indicates confident, specific output.

**Penalizes:** "might", "could", "perhaps", "possibly", "unclear", "may or may not"

**Rewards:** Specific dates, numbers, proper nouns, and concrete claims

### Fact Decomposition

Breaks the response into atomic claims and scores each for specificity:

```text
Input:  "Paris, founded around 250 BC, is the capital of France
         and has a population of approximately 2.1 million."

Claims:
  1. "Paris was founded around 250 BC"          → confidence: 0.85
  2. "Paris is the capital of France"            → confidence: 0.95
  3. "Paris has a population of ~2.1 million"    → confidence: 0.80
```

Claims with dates, numbers, and proper nouns score higher. Weasel words ("some say", "it is believed") reduce confidence.

### Self-Consistency

Checks whether statements within the response contradict each other. Inconsistent claims lower the overall score.

### NLI (Natural Language Inference)

Evaluates whether the response is entailed by (logically follows from) the input context. Catches hallucinated claims that aren't supported by the provided information.

### Multi-Source

Cross-references extracted claims against live web search results. When `TAVILY_API_KEY` is set, this layer:

1. Extracts atomic factual claims from the output via LLM
2. Runs a Tavily web search for each claim
3. Scores the claim as supported, contradicted, or unverifiable based on search results

```typescript
import { createVerificationLayer } from "@reactive-agents/verification";

const layer = createVerificationLayer({
  enableMultiSource: true,   // requires TAVILY_API_KEY
  // ...
});
```

### Hallucination Detection

Detects fabricated claims by comparing agent output against source context. Available in two modes:

**Heuristic mode** (no LLM cost): Extracts claims from sentences, classifies confidence (certain/likely/uncertain), and verifies via keyword overlap with source material.

**LLM mode**: Uses structured prompts for claim extraction and per-claim verification against source context. Falls back to heuristic mode on failure.

```typescript
import {
  checkHallucination,
  checkHallucinationLLM,
  extractClaims,
} from "@reactive-agents/verification";

// Heuristic mode — fast, no LLM cost
const result = checkHallucination(agentOutput, sourceContext);
// { passed: true, hallucinationRate: 0.05, totalClaims: 8, unverifiedClaims: 0 }

// LLM mode — more accurate, uses LLM calls
const llmResult = await checkHallucinationLLM(agentOutput, sourceContext, llm);
```

**Hallucination rate** is calculated as `unverifiedClaims / totalClaims`. The default threshold is 10% — outputs with higher rates are flagged.

Each claim is classified by confidence:
- **certain** — Contains specific facts, numbers, or proper nouns
- **likely** — General factual assertions
- **uncertain** — Contains hedging language ("might", "possibly")

## Verification Result

Each verification returns a `VerificationResult`:

```typescript
{
  overallScore: 0.82,        // 0.0 to 1.0
  passed: true,              // score >= passThreshold
  riskLevel: "low",          // "low" | "medium" | "high" | "critical"
  recommendation: "accept",  // "accept" | "review" | "reject"
  verifiedAt: Date,
  layerResults: [
    {
      layerName: "semantic-entropy",
      score: 0.88,
      passed: true,
      details: "Low hedging, diverse vocabulary",
      claims: [],
    },
    {
      layerName: "fact-decomposition",
      score: 0.78,
      passed: true,
      details: "3 claims extracted, all specific",
      claims: [
        { text: "Paris is the capital of France", confidence: 0.95, source: "input" },
      ],
    },
  ],
}
```

## Configuration

```typescript
import { createVerificationLayer } from "@reactive-agents/verification";

const verificationLayer = createVerificationLayer({
  enableSemanticEntropy: true,          // default: true
  enableFactDecomposition: true,        // default: true
  enableMultiSource: false,             // default: false
  enableSelfConsistency: true,          // default: true
  enableNli: true,                      // default: true
  enableHallucinationDetection: false,  // default: false
  hallucinationThreshold: 0.10,         // 0-1, default: 0.10
  passThreshold: 0.7,                   // 0-1, default: 0.7
  riskThreshold: 0.5,                   // 0-1, default: 0.5
});
```

## Integration with Execution Engine

Verification runs during **Phase 6 (Verify)** of the 10-phase execution lifecycle. When the verification score and risk level are computed, they're stored in the execution context metadata — accessible via lifecycle hooks:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withVerification()
  .withHook({
    phase: "verify",
    timing: "after",
    handler: (ctx) => {
      const score = ctx.metadata.verificationScore;
      const risk = ctx.metadata.riskLevel;
      console.log(`Verification: score=${score}, risk=${risk}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

## When to Use Verification

- **High-stakes outputs** — Medical, legal, financial content where accuracy matters
- **Research tasks** — When the agent synthesizes information from multiple sources
- **User-facing content** — Blog posts, reports, summaries that will be published
- **Compliance** — When you need an audit trail showing output was checked

Verification adds latency (one extra analysis pass) but catches hallucinations and vague responses before they reach users.
