import { test, expect } from "bun:test"
import { defaultInterventionRegistry } from "../src/controller/handlers/index"
import { defaultInterventionConfig } from "../src/controller/intervention"

test("every decision type in marketed list is registered (no half-implemented features per North Star P11)", () => {
  // The RI controller census (2026-11-06) deleted temp-adjust, compress,
  // skill-activate, tool-inject, stall-detect and harness-harm (no effect or
  // never fired); WS-4 Phase 2 deleted the four advisory-only decisions.
  const MARKETED_DECISION_TYPES = [
    "early-stop", "switch-strategy", "tool-failure-redirect",
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
