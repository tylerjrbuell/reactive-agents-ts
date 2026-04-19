import { test, expect } from "bun:test"
import { defaultInterventionRegistry } from "../src/controller/handlers/index"
import { defaultInterventionConfig } from "../src/controller/intervention"

test("every decision type in marketed list is either registered or explicitly advisory", () => {
  const MARKETED_DECISION_TYPES = [
    "early-stop", "temp-adjust", "switch-strategy", "skill-activate",
    "prompt-switch", "tool-inject", "memory-boost", "skill-reinject",
    "human-escalate", "compress",
  ] as const
  const registered = new Set(defaultInterventionRegistry.map((h) => h.type))
  const missing: string[] = []
  for (const t of MARKETED_DECISION_TYPES) {
    const mode = defaultInterventionConfig.modes[t as keyof typeof defaultInterventionConfig.modes]
    if (!registered.has(t) && mode !== "advisory" && mode !== "off") {
      missing.push(t)
    }
  }
  expect(missing).toEqual([])
})
