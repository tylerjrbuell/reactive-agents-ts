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

  // HS-27 (GH #83): poll for JSONL flush rather than sleeping 100ms.
  const { readdirSync, existsSync } = await import("node:fs")
  const start = Date.now()
  let files: string[] = []
  while (Date.now() - start < 5000) {
    if (existsSync(dir)) {
      files = readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"))
      if (files.length > 0) break
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  expect(files.length).toBeGreaterThan(0)

  rmSync(dir, { recursive: true, force: true })
  await agent.dispose()
})
