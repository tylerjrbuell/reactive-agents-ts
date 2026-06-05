import type { Rationale } from "@reactive-agents/core"

/**
 * Best-effort extraction of a Rationale from a model-emitted JSON object.
 * Returns undefined when shape is malformed — never throws.
 */
export const extractRationale = (obj: Record<string, unknown>): Rationale | undefined => {
  const r = obj["rationale"]
  if (typeof r !== "object" || r === null) return undefined
  const rec = r as Record<string, unknown>
  if (typeof rec.why !== "string" || rec.why.length === 0) return undefined
  // Truncate overlong why (small models pad heavily) rather than dropping the
  // whole rationale — keep the captured intent, just bounded to 280 chars.
  const why = rec.why.length > 280 ? rec.why.slice(0, 280) : rec.why
  const out: Record<string, unknown> = { why }
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

// HS-cleanup-1 (2026-05-23): canonical pattern for the `<rationale call="N">`
// wrapper. Used by both the parser (extracts blocks) and the stripper
// (removes the same blocks). Single source of truth keeps them in lockstep.
const RATIONALE_BLOCK_RE = /<rationale(?:\s+call\s*=\s*["']?(\d+)["']?)?\s*>([\s\S]*?)<\/rationale>/gi

/**
 * Best-effort JSON parse for a rationale body emitted by a (often small) model.
 * Tolerates ```json / ``` fences and leading/trailing prose around the object.
 * Returns undefined on genuine failure — never throws.
 */
const parseLenientJson = (body: string): Record<string, unknown> | undefined => {
  // Strip surrounding markdown code fences (```json … ``` or ``` … ```).
  const defenced = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try {
    return JSON.parse(defenced) as Record<string, unknown>
  } catch {
    // Fall back to the first balanced {…} substring, ignoring surrounding prose.
    const start = defenced.indexOf("{")
    const end = defenced.lastIndexOf("}")
    if (start === -1 || end <= start) return undefined
    try {
      return JSON.parse(defenced.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
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
 *
 * **Does NOT mutate the input.** Use `stripRationaleBlocks` separately when
 * you need the rationale wrappers removed from the text that will be stored
 * in a step or re-shown to the model.
 */
export const parseRationaleBlocks = (text: string): Map<number, Rationale> => {
  const out = new Map<number, Rationale>()
  if (!text) return out
  // Clone the regex so concurrent calls share no `lastIndex` state.
  const blockRe = new RegExp(RATIONALE_BLOCK_RE.source, RATIONALE_BLOCK_RE.flags)
  let sequential = 0
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    sequential += 1
    const callNum = match[1] ? Number.parseInt(match[1], 10) : sequential
    const body = match[2]?.trim() ?? ""
    if (!body) continue
    const obj = parseLenientJson(body)
    if (!obj) continue
    const parsed = extractRationale({ rationale: obj })
    if (!parsed) continue
    // Honor honest, non-colliding explicit call numbers; on collision fall back
    // to the next free positional key so repeated `call="N"` (a known small-model
    // tic) yields distinct, order-preserving entries instead of overwrites.
    let key = callNum
    while (out.has(key)) key += 1
    out.set(key, parsed)
  }
  return out
}

/**
 * Strip `<rationale call="N">...</rationale>` wrappers from model text.
 *
 * Canonical root-fix for HS-105 (M2a). The framework instructs the model to
 * emit rationale blocks in its text content so the native-FC path can attach
 * structured rationale to tool calls. After `parseRationaleBlocks` lifts the
 * structured data, the raw XML is no longer needed and should NOT remain in
 * any step that may re-enter the conversation context next iteration or be
 * surfaced as user output.
 *
 * Idempotent. Collapses runs of blank lines created by stripping. Returns
 * the original string when there is nothing to strip.
 */
export const stripRationaleBlocks = (text: string): string => {
  if (!text) return text
  const blockRe = new RegExp(RATIONALE_BLOCK_RE.source, RATIONALE_BLOCK_RE.flags)
  const stripped = text.replace(blockRe, "")
  // Also strip orphan `</rationale>` and unmatched opening tags — defensive
  // for partial / truncated streams. Cheap regex, no false-positives in prose.
  const noOrphans = stripped
    .replace(/<\/rationale>\s*/gi, "")
    .replace(/<rationale\s+call\s*=\s*["']?\d+["']?[^>]*>/gi, "")
  return noOrphans.replace(/\n{3,}/g, "\n\n").trim()
}
