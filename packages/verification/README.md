# @reactive-agents/verification

> Post-LLM output verification for Reactive Agents: layered checks that score an answer and recommend accept, review or reject.

> **Stability:** unstable. `.withVerification(options)` takes options today; a replaceable verifier is not shipped, and layer behaviour may change between minors.

## Install

```bash
bun add @reactive-agents/verification
# or: npm install @reactive-agents/verification
# The facade re-exports it: bun add reactive-agents
```

## Usage

Through the builder:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("fact-checker")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withVerification({ passThreshold: 0.7, hallucinationDetection: true })
  .build();

const result = await agent.run("In what year did the Berlin Wall fall?");
```

Directly, with the service:

```ts
import { Effect } from "effect";
import { VerificationService, createVerificationLayer } from "@reactive-agents/verification";

const program = Effect.gen(function* () {
  const verifier = yield* VerificationService;
  const result = yield* verifier.verify(
    "Canberra is the capital of Australia.",
    "What is the capital of Australia?",
  );
  console.log(result.overallScore, result.recommendation); // 0-1, "accept" | "review" | "reject"
});

await Effect.runPromise(program.pipe(Effect.provide(createVerificationLayer())));
```

`createVerificationLayer()` runs the heuristic layers with no model calls. Pass `{ useLLMTier: true }` with an `llm`, or use `createVerificationLayerWithRuntimeLlm()` inside a runtime that provides `LLMService`, to enable the LLM-backed layers.

## API

Layers (each has a heuristic form; entropy, decomposition, multi-source and hallucination also have an `...LLM` form):

| Export | Use it when |
|---|---|
| `VerificationService`, `createVerificationLayer` | You want the composite verdict from all enabled layers. |
| `checkSemanticEntropy` | You want a consistency signal for an answer. |
| `checkFactDecomposition` | You want atomic claims checked one by one. |
| `checkNli` | You want an entailment-style check of answer against question. |
| `checkMultiSource` | You want cross-source corroboration. |
| `checkSelfConsistency` | You want an internal-consistency check of the answer text. |
| `checkHallucination`, `extractClaims` | You want claim extraction and hallucination detection. |
| `defaultVerificationConfig`, `VerificationConfig` | You tune layers and thresholds. |

## Documentation

- [Verification](https://docs.reactiveagents.dev/features/verification/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
