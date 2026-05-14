import type { Rationale } from "@reactive-agents/core"

/**
 * Best-effort extraction of a Rationale from a model-emitted JSON object.
 * Returns undefined when shape is malformed — never throws.
 */
export const extractRationale = (obj: Record<string, unknown>): Rationale | undefined => {
  const r = obj["rationale"]
  if (typeof r !== "object" || r === null) return undefined
  const rec = r as Record<string, unknown>
  if (typeof rec.why !== "string" || rec.why.length === 0 || rec.why.length > 280) return undefined
  const out: Record<string, unknown> = { why: rec.why }
  if (Array.isArray(rec.refs) && rec.refs.every((s) => typeof s === "string")) out.refs = rec.refs
  if (Array.isArray(rec.alternatives)) {
    const alts: { option: string; rejectedBecause: string }[] = []
    for (const alt of rec.alternatives) {
      if (typeof alt !== "object" || alt === null) continue
      const a = alt as Record<string, unknown>
      if (typeof a.option === "string" && typeof a.rejectedBecause === "string" && a.rejectedBecause.length <= 160) {
        alts.push({ option: a.option, rejectedBecause: a.rejectedBecause })
      }
    }
    if (alts.length > 0) out.alternatives = alts
  }
  if (typeof rec.confidence === "number" && rec.confidence >= 0 && rec.confidence <= 1) {
    out.confidence = rec.confidence
  }
  return out as Rationale
}

/**
 * Parse `<rationale call="N">{...}</rationale>` blocks from model text.
 * Returns Map keyed by 1-indexed call number → Rationale.
 *
 * Used by native-FC path to attach intentional, model-emitted rationale to
 * tool calls whose provider FC events have no sibling rationale field.
 *
 * Tolerates: single/double quotes around the call attribute, missing call
 * attribute (assigned sequentially as 1, 2, 3…), JSON parse failures (skipped).
 */
export const parseRationaleBlocks = (text: string): Map<number, Rationale> => {
  const out = new Map<number, Rationale>()
  if (!text) return out
  const blockRe = /<rationale(?:\s+call\s*=\s*["']?(\d+)["']?)?\s*>([\s\S]*?)<\/rationale>/gi
  let sequential = 0
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    sequential += 1
    const callNum = match[1] ? Number.parseInt(match[1], 10) : sequential
    const body = match[2]?.trim() ?? ""
    if (!body) continue
    let parsed: Rationale | undefined
    try {
      const obj = JSON.parse(body) as Record<string, unknown>
      parsed = extractRationale({ rationale: obj })
    } catch {
      continue
    }
    if (parsed) out.set(callNum, parsed)
  }
  return out
}
