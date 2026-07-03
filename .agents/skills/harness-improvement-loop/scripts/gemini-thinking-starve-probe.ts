// Isolated probe: confirm Gemini 2.5 thinking-mode starves the visible-output
// budget at the harness's tier cap (mid=2000, frontier=4000) because
// buildGeminiConfig never sets thinkingConfig.thinkingBudget.
//
// Run from repo root:
//   GOOGLE_API_KEY=... RA_GEMINI_DEBUG=1 \
//   bun .claude/skills/harness-improvement-loop/scripts/gemini-thinking-starve-probe.ts
import { Effect, Layer, Stream } from "effect";
import {
  GeminiProviderLive,
  LLMConfig,
  LLMService,
  llmConfigFromEnv,
} from "../../../../packages/llm-provider/src/index.js";

const MODEL = process.env.PROBE_MODEL ?? "gemini-2.5-flash";
const BUDGETS = (process.env.PROBE_BUDGETS ?? "1000,2000,4000")
  .split(",")
  .map((n) => Number(n));

// Hard, multi-constraint reasoning prompt that induces long hidden thinking on
// thinking-mode models (2.5-pro thinks by default).
const PROMPT =
  "Five houses in a row, each a different color, owner nationality, drink, and pet. " +
  "The Brit lives in the red house. The Swede keeps dogs. The Dane drinks tea. " +
  "The green house is immediately left of the white house. The green-house owner drinks coffee. " +
  "The person who smokes Pall Mall keeps birds. The owner of the yellow house smokes Dunhill. " +
  "The man in the center drinks milk. The Norwegian lives in the first house. " +
  "Work through the full constraint propagation step by step, then state who owns the fish.";

const layer = GeminiProviderLive.pipe(
  Layer.provide(Layer.succeed(LLMConfig, llmConfigFromEnv)),
);

const run = (maxTokens: number) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const stream = yield* llm.stream({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      maxTokens,
      temperature: 0.2,
    });
    let text = "";
    let outTok = 0;
    let errored: string | undefined;
    yield* stream.pipe(
      Stream.runForEach((ev) =>
        Effect.sync(() => {
          if (ev.type === "text_delta") text += ev.text;
          else if (ev.type === "usage") outTok = ev.usage.outputTokens;
          else if (ev.type === "error")
            errored = String((ev as { error?: string }).error ?? "error");
        }),
      ),
    );
    return { maxTokens, text, outTok, errored };
  }).pipe(Effect.provide(layer));

const main = async () => {
  console.log(`\n=== Gemini thinking-starvation probe — model=${MODEL} ===`);
  for (const b of BUDGETS) {
    try {
      const { text, outTok, errored } = await Effect.runPromise(run(b));
      const starved = text.length === 0;
      console.log(
        `maxTokens=${b}\toutChars=${text.length}\toutTok=${outTok}\t${errored ? `ERROR=${errored.slice(0, 90)}` : starved ? "STARVED(empty)" : `ok preview="${text.slice(0, 50).replace(/\n/g, " ")}"`}`,
      );
    } catch (e) {
      console.log(`maxTokens=${b}\tTHROW: ${String((e as { message?: string }).message ?? e).slice(0, 160)}`);
    }
  }
  console.log("=== done ===\n");
};

main();
