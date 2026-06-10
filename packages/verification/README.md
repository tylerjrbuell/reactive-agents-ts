# @reactive-agents/verification

Post-LLM output verification for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

Reduces hallucinations by combining multiple complementary techniques: semantic entropy (consistency across samples), fact decomposition (atomic claim checking), NLI-based hallucination detection, multi-source corroboration, and self-consistency voting. Each layer is independent — pick the ones that fit your latency and cost budget.

## Installation

```bash
bun add @reactive-agents/verification
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Techniques

| Layer                | Approach                                                          | Function                                  |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Semantic entropy     | Sample N times; entail-cluster outputs; high entropy → low confidence | `checkSemanticEntropy(LLM)`         |
| Fact decomposition   | Break output into atomic claims, verify each independently        | `checkFactDecomposition(LLM)`             |
| NLI hallucination    | Detect entailment between claim and source via NLI model          | `checkNli`, `checkHallucination(LLM)`     |
| Multi-source         | Cross-check the answer against multiple retrieval sources         | `checkMultiSource(LLM)`                   |
| Self-consistency     | Majority vote over N independent samples                          | `checkSelfConsistency`                    |

Each `check*` function returns a `LayerResult` with confidence, evidence, and risk classification.

## Quick Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("fact-checker")
  .withProvider("anthropic", { model: "claude-sonnet-4-6" })
  .withVerification()
  .build();

const result = await agent.run("In what year did the Berlin Wall fall?");
console.log(result.metadata.confidence); // 0.0–1.0 composite confidence
console.log(result.metadata.verification); // per-layer evidence
```

When confidence falls below the configured threshold, the agent can re-sample, escalate to the user (when paired with `@reactive-agents/interaction`), or surface a `VerificationFailed` error.

## Direct Layer Usage

Use individual layers without the full builder pipeline:

```typescript
import { Effect } from "effect";
import { checkSemanticEntropyLLM, checkHallucinationLLM } from "@reactive-agents/verification";
import { LLMService } from "@reactive-agents/llm-provider";

const program = Effect.gen(function* () {
  const llm = yield* LLMService;
  const entropy = yield* checkSemanticEntropyLLM({
    llm,
    question: "What is the capital of Australia?",
    answer: "Canberra",
    samples: 5,
  });
  return entropy; // { confidence, riskLevel, evidence }
});
```

## Configuration

```typescript
.withVerification({
  layers: ["semantic-entropy", "fact-decomposition", "nli"],
  threshold: 0.7,
  samples: 5,
  judgeModel: "claude-haiku-4-5-20251001",
})
```

## Key Exports

| Export                                              | Purpose                                                |
| --------------------------------------------------- | ------------------------------------------------------ |
| `VerificationService`, `VerificationServiceLive`    | Composite verification entry point                     |
| `checkSemanticEntropy`, `checkSemanticEntropyLLM`   | Entropy across N samples                               |
| `checkFactDecomposition`, `checkFactDecompositionLLM` | Per-claim verification                                |
| `checkNli`                                          | NLI-based entailment check                             |
| `checkHallucination`, `extractClaims`               | Claim extraction + hallucination detection             |
| `checkMultiSource`, `checkSelfConsistency`          | Corroboration and majority-vote layers                 |
| `createVerificationLayer`                           | Factory for the runtime layer                          |
| `RiskLevel`, `ConfidenceScore`, `LayerResult`       | Schemas + types                                        |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Pairs with [`@reactive-agents/guardrails`](https://www.npmjs.com/package/@reactive-agents/guardrails) for *pre*-LLM safety filtering

## License

MIT
