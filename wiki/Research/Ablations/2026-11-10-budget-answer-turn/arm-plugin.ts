// Preload plugin: builds the ablation arms WITHOUT editing packages/*/src.
// Under Bun every @reactive-agents/* import resolves to packages/<pkg>/src (root
// tsconfig paths). This plugin serves every packages/<pkg>/src/**/*.ts from a frozen
// copy (RA_ABL_SNAPSHOT = dir holding <pkg>/src, copied 2026-11-10T21:27:50-05:00 at
// HEAD 76f5fe1dd), so all arms run one identical tree. Arm via RA_ABL_ARM:
//   on   shipped default (snapshot unchanged)
//   off  budgetAnswerTurnRecord returns undefined -> reserveBudgetAnswerTurn never
//        reserves (state unchanged, no events); budgetAnswerTurnTaken stays false
//        because no record carries answerTurnAt from this path.
// The patch must apply exactly once or the process aborts.
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts <driver>.ts ...
import { plugin } from "bun"
import { existsSync, readFileSync } from "node:fs"

const SNAPSHOT = process.env.RA_ABL_SNAPSHOT
if (!SNAPSHOT) throw new Error("RA_ABL_SNAPSHOT (dir with <pkg>/src copies) is required")
const arm = process.env.RA_ABL_ARM ?? "on"
if (!["on", "off"].includes(arm)) throw new Error(`unknown RA_ABL_ARM ${arm}`)

const once = (src: string, from: string, to: string): string => {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`arm-plugin: expected 1 match for ${JSON.stringify(from.slice(0, 60))}, found ${n}`)
  return src.replace(from, to)
}

const TARGET = "reasoning/src/kernel/loop/budget-answer-turn.ts"
const patch = (code: string): string =>
  arm === "off"
    ? once(code, "): ExitGateRecord | undefined {\n  if (state.status !== \"thinking\"",
        "): ExitGateRecord | undefined {\n  if (state !== null) return undefined;\n  if (state.status !== \"thinking\"")
    : code

const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/"
let served = 0
let patched = 0
plugin({
  name: "ablation-arm",
  setup(build) {
    build.onLoad({ filter: /\/packages\/[^/]+\/src\/.*\.ts$/ }, (args) => {
      const rel = args.path.startsWith(ROOT) ? args.path.slice(ROOT.length) : undefined
      const snap = rel ? `${SNAPSHOT}/${rel}` : undefined
      const fromSnap = snap !== undefined && existsSync(snap)
      const src = readFileSync(fromSnap ? snap : args.path, "utf8")
      if (fromSnap) served++
      if (rel === TARGET) patched++
      return { contents: rel === TARGET ? patch(src) : src, loader: "ts" }
    })
  },
})
process.on("exit", () => process.stderr.write(`[arm-plugin] arm=${arm} files-from-snapshot=${served} target-loaded=${patched}\n`))
process.stderr.write(`[arm-plugin] arm=${arm} snapshot=${SNAPSHOT}\n`)
