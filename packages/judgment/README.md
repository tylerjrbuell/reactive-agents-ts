# @reactive-agents/judgment

> Typed, provider-abstracted judgment for Reactive Agents: ask Noul (TypeSafe's name for a yes/no question; the answer is a probability), Choice or Score questions and get typed answers with probabilities.

> **Stability:** experimental. Shapes may change between any releases.

## Install

```bash
bun add @reactive-agents/judgment
# or: npm install @reactive-agents/judgment
# The facade exposes it through the builder: bun add reactive-agents
```

## Usage

`JudgmentService.ask` takes a `state` to judge and a named set of questions, and returns one typed answer per question.

```ts
import { Effect } from "effect";
import {
  JudgmentService,
  makeJudgmentServiceLive,
  makeOllamaBackend,
} from "@reactive-agents/judgment";

const program = Effect.gen(function* () {
  const judgment = yield* JudgmentService;
  const { risky } = yield* judgment.ask({
    state: { action: "delete all files in /tmp" },
    questions: {
      risky: { type: "noul", instructions: "Is this action destructive?" },
    },
  });
  if (risky.kind === "noul") console.log(risky.probability);
});

// Needs a local Ollama server with the "nimble" model pulled.
const layer = makeJudgmentServiceLive(makeOllamaBackend());
await Effect.runPromise(program.pipe(Effect.provide(layer)));
```

Failures are typed (`JudgmentTimeout`, `JudgmentUnauthorized`, `JudgmentUnsupported`, and others); callers should degrade to a heuristic or LLM path, not fail the run. Answers from the LLM backend carry `calibrated: false`.

## API

| Export | Use it when |
|---|---|
| `JudgmentService`, `makeJudgmentServiceLive` | You ask questions through a backend. |
| `makeJevBackend` | You use the TypeSafe Jev model (API key from config or `TYPESAFE_API_KEY`). |
| `makeLlmBackend` | You have no judgment vendor: it emulates judgment over an `LLMService`, uncalibrated. |
| `makeOllamaBackend` | You want a local System One backend over Ollama. |
| `makeSystemOneHttpBackend` | You wire System One to another HTTP provider through a `SystemOneProviderDescriptor`. |
| `passes` | You gate an answer on `minProbability` (and `minConfidence` for Choice/Score). |
| `capabilitiesOf` | You need a backend's limits (supported kinds, images, calibration) before asking. |
| `withEvents` | You want `judgment:*` events on the `EventBus`. |
| `QuestionSpecs`, `JudgmentAnswers`, `JudgmentBackend` | You type questions and answers, or implement a backend. |

## Documentation

- [Judgment layer](https://docs.reactiveagents.dev/features/judgment-layer/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
