import type { HealingAction } from "../drivers/tool-calling-driver.js"
import { editDistance } from "./edit-distance.js"

interface HealToolNameResult {
  readonly resolved: string | null
  readonly action: HealingAction | null
}

export function healToolName(
  attempted: string,
  registeredNames: readonly string[],
  knownAliases: Record<string, string>,
): HealToolNameResult {
  // 1. Exact match
  if (registeredNames.includes(attempted)) return { resolved: attempted, action: null }

  // 2. Alias map
  const aliased = knownAliases[attempted]
  if (aliased && registeredNames.includes(aliased)) {
    return { resolved: aliased, action: { stage: "tool-name", from: attempted, to: aliased } }
  }

  // 3. Edit distance (≤ 2 edits)
  let bestName: string | null = null
  let bestDist = Infinity
  for (const name of registeredNames) {
    const dist = editDistance(attempted.toLowerCase(), name.toLowerCase())
    if (dist < bestDist) { bestDist = dist; bestName = name }
  }
  if (bestDist <= 2 && bestName !== null) {
    return { resolved: bestName, action: { stage: "tool-name", from: attempted, to: bestName } }
  }

  return { resolved: null, action: null }
}
