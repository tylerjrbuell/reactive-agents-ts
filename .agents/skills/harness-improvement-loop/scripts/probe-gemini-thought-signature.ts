// Live probe (harness-warden, 2026-11-19 v0.19 QA recheck of N2).
//
// Gemini 3-family models reject a replayed functionCall without its
// thoughtSignature when the call sits in the "current turn" (history ends in
// function responses, no user text after them). Reflexion improve passes hit
// this. This probe sends exactly that shape through the real provider path,
// three calls total:
//   1. foreign  : a tool_use id the provider never saw (placeholder path)
//   2. roundtrip: a live call returns a tool call, then the history is replayed
//                 with that id and no user text after the tool result
//                 (remembered-signature path)
//
// Usage:
//   bun --env-file=<repo>/.env .agents/skills/harness-improvement-loop/scripts/probe-gemini-thought-signature.ts [--model gemini-flash-latest]
import { Effect } from "effect";
import { LLMService, createLLMProviderLayer, type LLMMessage } from "@reactive-agents/llm-provider";

const i = process.argv.indexOf("--model");
const model = i >= 0 ? (process.argv[i + 1] as string) : "gemini-flash-latest";

const tools = [{
  name: "city-population",
  description: "Return the registered population for exactly one city name.",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];
const ask: LLMMessage = { role: "user", content: "Use city-population to look up Tokyo, then report the number." };
const toolResult = (id: string): LLMMessage => ({
  role: "tool", toolCallId: id, toolName: "city-population", content: '{"city":"Tokyo","population":3141592}',
});

const program = Effect.gen(function* () {
  const llm = yield* LLMService;
  const out: string[] = [];

  // 1. foreign id: no remembered signature, provider must send the placeholder.
  const foreign = yield* Effect.either(llm.complete({
    model, tools, maxTokens: 400,
    messages: [
      ask,
      { role: "assistant", content: [{ type: "tool_use", id: "foreign-call-1", name: "city-population", input: { city: "Tokyo" } }] },
      toolResult("foreign-call-1"),
    ],
  }));
  out.push(`foreign: ${foreign._tag === "Right" ? `OK stop=${foreign.right.stopReason} text=${JSON.stringify(foreign.right.content.slice(0, 80))}` : `ERR ${String((foreign.left as { message?: string }).message ?? foreign.left).slice(0, 240)}`}`);

  // 2. roundtrip: real call, then replay with the provider-assigned id.
  const first = yield* Effect.either(llm.complete({ model, tools, maxTokens: 400, messages: [ask] }));
  if (first._tag === "Left") {
    out.push(`roundtrip step1: ERR ${String(first.left).slice(0, 240)}`);
  } else {
    const calls = first.right.toolCalls ?? [];
    out.push(`roundtrip step1: OK toolCalls=${calls.length} ids=${calls.map((c) => c.id).join(",")}`);
    if (calls.length > 0) {
      const replay = yield* Effect.either(llm.complete({
        model, tools, maxTokens: 400,
        messages: [
          ask,
          { role: "assistant", content: calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })) },
          ...calls.map((c) => toolResult(c.id)),
        ],
      }));
      out.push(`roundtrip step2: ${replay._tag === "Right" ? `OK stop=${replay.right.stopReason} text=${JSON.stringify(replay.right.content.slice(0, 80))}` : `ERR ${String((replay.left as { message?: string }).message ?? replay.left).slice(0, 240)}`}`);
    }
  }
  return out;
});

const lines = await Effect.runPromise(
  program.pipe(Effect.provide(createLLMProviderLayer("gemini", undefined, model, { temperature: 0 }))),
);
for (const l of lines) console.log(l);
process.exit(0);
