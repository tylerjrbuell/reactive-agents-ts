import { test, expect } from "bun:test"
import { ReactiveAgents } from "../src/builder"
import { rmSync } from "node:fs"

test(".withTracing() persists JSONL for a run", async () => {
  const dir = `/tmp/tracing-test-${Date.now()}`
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ match: "ping", text: "pong" }])
    .withTracing({ dir })
    .build()

  const result = await agent.run("ping")
  expect(result.output).toContain("pong")

  // Give a moment for async flush
  await new Promise((r) => setTimeout(r, 100))

  // Find a JSONL file in dir (runId may vary)
  const { readdirSync } = await import("node:fs")
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"))
  expect(files.length).toBeGreaterThan(0)

  rmSync(dir, { recursive: true, force: true })
  await agent.dispose()
})
