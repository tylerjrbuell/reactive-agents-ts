// Preload plugin: builds the ablation arms WITHOUT editing packages/*/src.
// Under Bun every @reactive-agents/* import resolves to packages/<pkg>/src (root
// tsconfig paths), so src is live and other wardens were editing it during the run.
// This plugin serves every packages/<pkg>/src/**/*.ts from a frozen copy
// (RA_ABL_SNAPSHOT = dir holding <pkg>/src, copied 2026-11-10T19:27:34-05:00), so all
// arms run one identical tree. Arm via RA_ABL_ARM:
//   base   shipped default (snapshot unchanged)
//   nofam  (4) off: namedToolFamily returns []  (pre-change: keyword relevance only)
//   nocon  (5) off: callConstraintNote returns "" and compact enum rendering reverts
//          to p.type (pre-change: compact profile clears descriptions)
//   off    both off
// Each patch must apply exactly once or the process aborts.
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts <driver>.ts ...
import { plugin } from "bun"
import { existsSync, readFileSync } from "node:fs"

const SNAPSHOT = process.env.RA_ABL_SNAPSHOT
if (!SNAPSHOT) throw new Error("RA_ABL_SNAPSHOT (dir with <pkg>/src copies) is required")
const arm = process.env.RA_ABL_ARM ?? "base"
if (!["base", "nofam", "nocon", "off"].includes(arm)) throw new Error(`unknown RA_ABL_ARM ${arm}`)

const once = (src: string, from: string, to: string): string => {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`arm-plugin: expected 1 match for ${JSON.stringify(from.slice(0, 60))}, found ${n}`)
  return src.replace(from, to)
}

const patchFormatting = (code: string): string => {
  let c = code
  if (arm === "nofam" || arm === "off") {
    c = once(c, "): readonly ToolSchema[] {\n  const taskWords = new Set(wordsOf(taskDescription));",
      "): readonly ToolSchema[] {\n  if (taskDescription !== null) return [];\n  const taskWords = new Set(wordsOf(taskDescription));")
  }
  if (arm === "nocon" || arm === "off") {
    c = once(c, "export function callConstraintNote(tool: ToolSchema): string {",
      "export function callConstraintNote(tool: ToolSchema): string {\n  if (tool !== null) return \"\";")
    c = once(c, `const type = p.enum !== undefined && p.enum.length > 0 ? p.enum.join("|") : p.type;`, "const type = p.type;")
  }
  // Probe hooks (zero-token trigger census only).
  return `${c}\nexport { namedToolFamily as __ablNamedToolFamily, callConstraintNote as __ablCallConstraintNote };\n`
}

const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/"
let served = 0
plugin({
  name: "ablation-arm",
  setup(build) {
    build.onLoad({ filter: /\/packages\/[^/]+\/src\/.*\.ts$/ }, (args) => {
      const rel = args.path.startsWith(ROOT) ? args.path.slice(ROOT.length) : undefined
      const snap = rel ? `${SNAPSHOT}/${rel}` : undefined
      const src = snap && existsSync(snap) ? readFileSync(snap, "utf8") : readFileSync(args.path, "utf8")
      if (snap && existsSync(snap)) served++
      const contents = rel === "reasoning/src/kernel/capabilities/attend/tool-formatting.ts" ? patchFormatting(src) : src
      return { contents, loader: "ts" }
    })
  },
})
process.on("exit", () => process.stderr.write(`[arm-plugin] arm=${arm} files-from-snapshot=${served}\n`))
process.stderr.write(`[arm-plugin] arm=${arm} snapshot=${SNAPSHOT}\n`)
