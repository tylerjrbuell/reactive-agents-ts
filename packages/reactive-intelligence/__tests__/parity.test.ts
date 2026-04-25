import { test, expect } from "bun:test"
import { defaultInterventionRegistry } from "../src/controller/handlers/index"
import { defaultInterventionConfig } from "../src/controller/intervention"

test("every decision type in marketed list is registered (no half-implemented features per North Star P11)", () => {
  // Updated post P0 cleanup: prompt-switch / memory-boost / skill-reinject /
  // human-escalate were advisory-only with no dispatch handler — they fired
  // ControllerDecisions that the dispatcher always suppressed. Removed from
  // both controller-service.ts and defaultInterventionConfig.modes; their
  // ControllerDecision union members are kept in types.ts so the schema
  // is recoverable when handlers eventually ship.
  const MARKETED_DECISION_TYPES = [
    "early-stop", "temp-adjust", "switch-strategy", "skill-activate",
    "tool-inject", "tool-failure-redirect", "compress",
    "stall-detect", "harness-harm",
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
