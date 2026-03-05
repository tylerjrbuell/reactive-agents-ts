---
name: verification-pipeline-design
description: Build a layered verification pipeline with semantic entropy, fact decomposition, NLI, multi-source checks, and hallucination detection.
compatibility: Reactive Agents projects using @reactive-agents/verification and guardrails.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Verification Pipeline Design

Use this skill to harden agent outputs before action or delivery.

## Agent objective

When implementing verification-first agents, generate code that:

- Treats high-risk contradictions/hallucinations as blocking failures.
- Emits structured confidence and provenance metadata.
- Applies verification before irreversible side effects.

## Layers to enforce

1. Semantic entropy and confidence scoring.
2. Fact decomposition and claim-level verification.
3. NLI and contradiction detection.
4. Multi-source consistency checks.
5. Hallucination/fact-grounding checks.

## Implementation pattern

- Mark high-risk hallucination/contradiction outcomes as blocking where required.
- Mark lower-confidence outcomes as review-required when appropriate.
- Emit structured verification metadata for observability.

## Example objective

- Reject outputs with strong contradiction signals.
- Flag low-grounding claims for human review.

## Code Examples

### Multi-Layer Verification

This example demonstrates how to enable the multi-layer verification pipeline for an agent. The `.withVerification()` builder method activates a series of checks to assess the quality and factual accuracy of the agent's responses.

The pipeline includes:
-   **Semantic Entropy**: Checks for consistency across response variations.
-   **Fact Decomposition**: Breaks the output into atomic claims for individual verification.
-   **Multi-Source Checking**: Cross-references claims using an LLM and optionally the Tavily search API if `TAVILY_API_KEY` is set.

*Source: [apps/examples/src/trust/13-verification.ts](apps/examples/src/trust/13-verification.ts)*

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// ...

const verifiedAgent = await ReactiveAgents.create()
  .withName("verified-agent")
  .withProvider("anthropic")
  .withVerification()
  .build();

const result = await verifiedAgent.run("State three facts about the Eiffel Tower.");

console.log(`Output: ${result.output}`);
console.log(`Success: ${result.success}`);
```

## Expected implementation output

- Builder usage with `.withVerification()` and complementary guardrails where needed.
- Clear pass/block/review outcome handling for each verification stage.
- Testable scenarios covering contradiction, low confidence, and grounding failures.

## Pitfalls to avoid

- Treating all failures as warnings.
- Running verification after irreversible actions.
- Omitting confidence and error provenance in reports.
