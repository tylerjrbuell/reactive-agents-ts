import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { checkSemanticEntropyLLM } from "../src/layers/semantic-entropy.js";
import { checkFactDecompositionLLM } from "../src/layers/fact-decomposition.js";
import type { VerificationLLM } from "../src/types.js";

// Regression: these helper layers used to hardcode an Anthropic model id, which
// resolved to `<agent-provider>/claude-haiku-...` on non-Anthropic agents (e.g.
// ollama), tripping the conservative capability fallback (numCtx=2048,
// toolCallDialect="none"). They must run on the agent's own provider+model by
// omitting `model` from the request.
const makeSpyLLM = (record: { reqs: unknown[] }): VerificationLLM => ({
  complete: (req) => {
    record.reqs.push(req);
    // Return parseable JSON so neither layer throws before recording.
    return Effect.succeed({ content: "[]" });
  },
  embed: (texts) => Effect.succeed(texts.map(() => [0, 0, 0])),
});

describe("verification helper layers — provider-correct model", () => {
  test("checkSemanticEntropyLLM does not pin a model", async () => {
    const record = { reqs: [] as unknown[] };
    await Effect.runPromise(
      checkSemanticEntropyLLM("Some response text.", "Some question?", makeSpyLLM(record)),
    );
    expect(record.reqs.length).toBeGreaterThan(0);
    for (const req of record.reqs) {
      expect("model" in (req as object)).toBe(false);
    }
  });

  test("checkFactDecompositionLLM does not pin a model", async () => {
    const record = { reqs: [] as unknown[] };
    await Effect.runPromise(
      checkFactDecompositionLLM("Some response text.", makeSpyLLM(record)),
    );
    expect(record.reqs.length).toBeGreaterThan(0);
    for (const req of record.reqs) {
      expect("model" in (req as object)).toBe(false);
    }
  });
});
