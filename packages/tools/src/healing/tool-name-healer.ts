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

  // 3. Edit distance, guarded against over-healing short names (`todo`, `find`,
  //    `pulse`...): both names >= 6 chars allow 2 edits, >= 5 allow 1, shorter
  //    names heal only on a case-insensitive match. A tie between two
  //    equally-close names is ambiguous and stays unresolved.
  let bestName: string | null = null
  let bestDist = Infinity
  let tie = false
  for (const name of registeredNames) {
    const dist = editDistance(attempted.toLowerCase(), name.toLowerCase())
    if (dist < bestDist) { bestDist = dist; bestName = name; tie = false }
    else if (dist === bestDist) tie = true
  }
  if (bestName !== null && !tie) {
    const shortest = Math.min(attempted.length, bestName.length)
    const maxDist = shortest >= 6 ? 2 : shortest >= 5 ? 1 : 0
    if (bestDist <= maxDist) {
      return { resolved: bestName, action: { stage: "tool-name", from: attempted, to: bestName } }
    }
  }

  return { resolved: null, action: null }
}
