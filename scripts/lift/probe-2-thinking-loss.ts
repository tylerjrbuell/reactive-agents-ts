/**
 * Live probe #2: does the framework's Ollama provider surface `thinking` from
 * thinking-capable local models (qwen3:4b) through complete() and stream()?
 *
 * Hypothesis under test (Tier-1 finding #2): the StreamEvent union has no
 * thinking variant and local.ts's stream loop forwards only content+tool_calls,
 * so the kernel's `providerThinking` (think.ts:1329) is always undefined and
 * the answer-in-thinking rescue is dead on the stream path. Code inspection
 * confirms; this probe demonstrates it live against real qwen3:4b.
 *
 * Run: bun run scripts/probe-2-thinking-loss.ts   (needs ollama running)
 */
import { Effect, Console, Stream } from "effect"
import { LLMService, createLLMProviderLayer } from "@reactive-agents/llm-provider"

const MODEL = process.env.PROBE_MODEL ?? "qwen3:4b"

const program = Effect.gen(function* () {
  const llm = yield* LLMService

  // ── complete(): does the non-streaming path surface thinking? (code says yes, local.ts:523) ──
  const res = yield* llm.complete({
    messages: [{ role: "user", content: "I thought of a number, multiplied by 3, added 10, got 40. What was my number? Reply with just the number." }],
    maxTokens: 400,
  })
  const thinkingOnComplete = (res as unknown as { thinking?: string }).thinking
  yield* Console.log(`complete(): content=${JSON.stringify(res.content.slice(0, 80))} thinking surfaced? ${thinkingOnComplete ? `YES len=${thinkingOnComplete.length}` : "NO"}`)

  // ── stream(): the kernel's ONLY path. Do any events carry thinking? ──
  const stream = yield* llm.stream({
    messages: [{ role: "user", content: "I thought of a number, multiplied by 3, added 10, got 40. What was my number? Reply with just the number." }],
    maxTokens: 400,
  })
  const events = Array.from(yield* Stream.runCollect(stream))
  const kinds = events.map((e) => e.type)
  const uniqueKinds = [...new Set(kinds)]
  const thinkingCarriers = events.filter((e) => "thinking" in (e as object))
  yield* Console.log(`stream(): ${events.length} events, kinds = ${uniqueKinds.join(", ")}`)
  yield* Console.log(`stream(): events carrying a 'thinking' field = ${thinkingCarriers.length}`)

  // ── raw control: prove Ollama DOES emit thinking on the same stream ──
  const rawEvents = yield* Effect.tryPromise(() =>
    fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        options: { num_ctx: 8192, num_predict: 400 },
        messages: [{ role: "user", content: "I thought of a number, multiplied by 3, added 10, got 40. What was my number? Reply with just the number." }],
      }),
    })
      .then((r) => r.body!.getReader())
      .then(async (reader) => {
        const decoder = new TextDecoder()
        let buf = ""
        let chunksWithThinking = 0
        let thinkingChars = 0
        let contentChars = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.trim()) continue
            const obj = JSON.parse(line) as { message?: { content?: string; thinking?: string } }
            if (obj.message?.thinking) {
              chunksWithThinking++
              thinkingChars += obj.message.thinking.length
            }
            contentChars += obj.message?.content?.length ?? 0
          }
        }
        return { chunksWithThinking, thinkingChars, contentChars }
      }),
  )
  yield* Console.log(`raw Ollama stream control: ${rawEvents.chunksWithThinking} chunks carried thinking (${rawEvents.thinkingChars} chars); visible content only ${rawEvents.contentChars} chars`)

  const verdict = thinkingCarriers.length === 0 && rawEvents.chunksWithThinking > 0
  yield* Console.log(`\nVERDICT: finding #2 ${verdict ? "CONFIRMED live — thinking channel exists, framework stream path drops it" : "NOT reproduced"}`)
})

const layer = createLLMProviderLayer("ollama", undefined, MODEL, { numCtx: 8192 })

Effect.runPromise(
  program.pipe(
    Effect.provide(layer),
    Effect.timeout("4 minutes"),
    Effect.catchAllDefect((d) => Effect.log(`defect: ${String(d)}`).pipe(Effect.as(undefined))),
  ),
)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("PROBE FAILED:", e)
    process.exit(1)
  })
