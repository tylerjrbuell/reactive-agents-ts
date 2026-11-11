// Zero-token census, part 2: callConstraintNote over EVERY ToolDefinition exported by
// @reactive-agents/tools (meta tools included): which compact schemas does (5) change?
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=base bun --preload ./arm-plugin.ts census-meta.ts
import * as T from "@reactive-agents/tools"
import { callConstraintNote, type ToolSchema } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts"

const isDef = (v: unknown): v is ToolSchema =>
  typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string" && Array.isArray((v as { parameters?: unknown }).parameters)
const seen = new Set<string>()
for (const [exp, v] of Object.entries(T)) {
  if (!isDef(v) || seen.has(v.name)) continue
  seen.add(v.name)
  const note = callConstraintNote(v)
  const enums = v.parameters.filter((p) => p.enum?.length).map((p) => `${p.name}=${p.enum!.join("|")}`)
  if (note || enums.length) console.log(`${v.name} (${exp}): note=${JSON.stringify(note.slice(0, 160))} enums=[${enums.join("; ")}]`)
}
console.log(`defs scanned: ${seen.size}`)
process.exit(0)
