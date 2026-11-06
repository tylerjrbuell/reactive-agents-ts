import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type StreamEvent, type LLMErrors } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js"
import {
  unavailableToolHint,
  unavailableToolsOf,
} from "../../src/kernel/capabilities/reason/unavailable-tool-hint.js"

// Surface-hiding spike fix A (wiki/Research/Harness-Reports/2026-11-06-tool-surface-hiding-spike.md):
// a call to a tool that is not on the surface must reach the model as guidance on
// its next turn, with or without requiredTools; after the strike cap the prose
// instruction says the action was not performed. Zero-token (scripted LLM).

const WEB_SEARCH = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
}
const schema = (name: string) => ({ name, description: name, parameters: [] })

function run(scenario: Parameters<typeof TestLLMService>[0], requiredTools: string[] = []) {
  const inner = TestLLMService(scenario)
  const requests: { tools: number; wire: string }[] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        requests.push({ tools: request.tools?.length ?? 0, wire: JSON.stringify(request.messages) })
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
      },
    }),
  )
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: { results: [{ title: "hit", content: "data" }] } }),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
  })
  const result = Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "Read notes.txt and tell me what it says.",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        requiredTools,
        availableToolSchemas: [WEB_SEARCH],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, tools))),
    ),
  )
  return { requests, result }
}

const HIDDEN_NATIVE = { toolCall: { name: "file-read", args: { path: "notes.txt" } } }
const HIDDEN_PRINTED = { text: '{"name":"file-write","arguments":{"path":"notes.txt","content":"x"}}' }
const ANSWER = { text: "FINAL ANSWER: I could not read notes.txt because file-read is not enabled." }

describe("unavailable-tool hint reaches the next request (runner)", () => {
  test("native call to a hidden builtin, no requiredTools", async () => {
    const { requests, result } = run([HIDDEN_NATIVE, ANSWER])
    await result
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests[0]!.wire).not.toContain("Tool call not executed")
    expect(requests[1]!.wire).toContain("file-read is not enabled for this run")
    expect(requests[1]!.wire).toContain("The action was not performed")
    expect(requests[1]!.wire).toMatch(/Tools you can call: [^"]*web-search/)
    expect(requests[1]!.tools).toBeGreaterThan(0)
  })

  test("printed (text) call to a hidden builtin, no requiredTools", async () => {
    const { requests, result } = run([HIDDEN_PRINTED, ANSWER])
    await result
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests[1]!.wire).toContain("file-write is not enabled for this run")
    expect(requests[1]!.wire).toMatch(/Tools you can call: [^"]*web-search/)
  })

  test("native call to a name the run does not know at all", async () => {
    const { requests, result } = run([{ toolCall: { name: "write_file", args: { path: "a" } } }, ANSWER])
    await result
    expect(requests[1]!.wire).toContain("write_file is not a tool in this run")
  })

  test("with requiredTools the hint rides alongside the required-tools nudge", async () => {
    const { requests, result } = run(
      [HIDDEN_NATIVE, { toolCall: { name: "web-search", args: { query: "x" } } }, ANSWER],
      ["web-search"],
    )
    await result
    // The ICS step (iterate-guard-seams.ts) adds its steer; the unavailable-tool
    // fact must survive it (writers merge by kind, seam-guidance-merge.test.ts).
    expect(requests[1]!.wire).toContain("file-read is not enabled for this run")
    expect(requests[1]!.wire).toMatch(/REQUIRED tools not yet called: web-search|Now call web-search/)
  })

  test("after the strike cap: tools withheld, and the prose instruction says nothing ran", async () => {
    const { requests, result } = run([HIDDEN_NATIVE, HIDDEN_NATIVE, ANSWER])
    await result
    expect(requests.length).toBeGreaterThanOrEqual(3)
    expect(requests[2]!.tools).toBe(0)
    expect(requests[2]!.wire).toContain("file-read is not enabled for this run")
    expect(requests[2]!.wire).toContain("do not claim their actions were done")
    // Tools are withheld, so the instruction names no callable tool.
    expect(requests[2]!.wire).not.toContain("Tools you can call")
  })
})

describe("unavailableToolsOf / unavailableToolHint (seam)", () => {
  const universe = [schema("web-search"), schema("recall")]
  test("an offered name is a parse problem, not an availability one", () => {
    expect(unavailableToolsOf({ nativeCallNames: ["web-search"], text: "", universe, knownNames: [] })).toEqual([])
  })
  test("dedupes and classifies: builtin or known = exists, else unknown", () => {
    const got = unavailableToolsOf({
      nativeCallNames: ["file-read", "file-read", "crm-lookup", "nope"],
      text: "",
      universe,
      knownNames: ["crm-lookup"],
    })
    expect(got).toEqual([
      { name: "file-read", exists: true },
      { name: "crm-lookup", exists: true },
      { name: "nope", exists: false },
    ])
  })
  test("no off-surface name: no hint", () => {
    expect(unavailableToolHint([], universe)).toBeUndefined()
  })
  test("empty callable surface says so; long surfaces are counted, not dropped", () => {
    const one = [{ name: "x", exists: false }]
    expect(unavailableToolHint(one, [])).toContain("No tools are callable right now.")
    const many = Array.from({ length: 15 }, (_, i) => schema(`t${i}`))
    expect(unavailableToolHint(one, many)).toContain("(+3 more)")
  })
})

describe("drift pin: one producer, guidance-channel only", () => {
  const SRC = join(import.meta.dir, "../../src")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : []
    })
  test("only unavailable-tool-hint.ts words the hint", () => {
    const owners = walk(SRC).filter((p) => /Tool call not executed|is not enabled for this run/.test(readFileSync(p, "utf8")))
    expect(owners.map((p) => p.slice(SRC.length + 1))).toEqual(["kernel/capabilities/reason/unavailable-tool-hint.ts"])
  })
  test("the thinking handler and strike guard write guidance only through the channel producer", () => {
    for (const f of ["continue-thinking.ts", "unresolved-tool-call.ts"]) {
      const src = readFileSync(join(SRC, "kernel/capabilities/reason", f), "utf8")
      const writes = src.split("\n").filter((l) => /pendingGuidance:/.test(l) && !l.trim().startsWith("//"))
      expect(writes.length).toBeGreaterThan(0)
      for (const l of writes) expect(l).toContain("contributeGuidance(")
    }
  })
})
