// Run: bun test packages/reasoning/tests/kernel/embedded-call-end-turn.test.ts --timeout 20000
//
// The end_turn trivial-exit fast path (dispatch-think-response.ts) must defer
// to the assistant-turn disposition (assistant-turn.ts). Real models end a
// prose reply that embeds a call (`const x = fileRead("/abs")`) with
// stopReason end_turn; the shape detector does not flag that text, so the
// fast path completed the run BEFORE the resolved turn was read:
//   (a) a RESOLVED embedded call was never dispatched;
//   (b) an UNRESOLVED (refused) embedded call shipped as a successful final
//       answer, violating "a call-shaped reply is never a final answer" (D4).
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type StreamEvent, type LLMErrors } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js"

const FILE = "/abs/probe.txt"
const EMBEDDED = `I will read it:\n\n\`\`\`js\nconst x = fileRead(${JSON.stringify(FILE)})\n\`\`\``

const schema = (riskLevel: "low" | "medium") => ({
  name: "file-read",
  description: "Read a file",
  parameters: [{ name: "path", type: "string", description: "absolute path", required: true }],
  riskLevel,
})

function run(riskLevel: "low" | "medium") {
  const inner = TestLLMService([{ text: EMBEDDED }, { text: "The file says hello." }])
  const llmCalls: number[] = []
  const executed: { name: string; args: unknown }[] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        llmCalls.push(1)
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
      },
    }),
  )
  const tools = mockToolServiceLayer({
    execute: (input: { toolName: string; arguments: unknown }) => {
      executed.push({ name: input.toolName, args: input.arguments })
      return Effect.succeed({ success: true, result: "hello" })
    },
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "path", type: "string", required: true }] }),
  } as never)
  const result = Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: `Read ${FILE} and report its contents.`,
        taskType: "simple",
        memoryContext: "",
        availableTools: ["file-read"],
        availableToolSchemas: [schema(riskLevel)],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, tools))),
    ),
  )
  return { llmCalls, executed, result }
}

describe("end_turn fast path defers to the assistant-turn disposition", () => {
  test("(a) a resolved embedded call is dispatched, not delivered as the answer", async () => {
    const { executed, result } = run("low")
    const r = await result
    expect(executed.map((e) => e.name)).toContain("file-read")
    expect(JSON.stringify(r.output)).not.toContain("fileRead(")
  }, 20000)

  test("(b) an unresolved embedded call never completes the run as its final answer", async () => {
    const { llmCalls, result } = run("medium")
    const r = await result
    // Fast path would stop after ONE llm call with the raw call text as output.
    expect(llmCalls.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(r.output)).not.toContain("fileRead(")
  }, 20000)
})
