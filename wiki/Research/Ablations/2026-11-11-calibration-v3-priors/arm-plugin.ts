// Preload plugin: builds the ablation arms WITHOUT editing packages/*/src.
// Serves every packages/<pkg>/src/**/*.ts from a frozen copy (RA_ABL_SNAPSHOT = dir
// holding <pkg>/src, taken with `git archive` at the HEAD in ../HEAD.txt, so another
// warden's uncommitted edits and later commits stay out of both arms).
//
// Arms differ ONLY in which calibration JSON the loader reads. The patch prepends
// RA_ABL_CAL_DIR/<normalized-id>.json to the loader's candidate paths
// (calibrationCandidatePaths in llm-provider/src/calibration.ts), so loadCalibration,
// loadDialectPriorClaim, selectAdapter (profileOverrides -> toolResultMaxChars) and the
// runtime resolver all read the arm's file. Both arms are patched the same way:
//   committed  RA_ABL_CAL_DIR = ./committed  (copy of src/calibrations at HEAD)
//   candidate  RA_ABL_CAL_DIR = ./candidates (v3-regenerated probe fields)
// The patch must apply exactly once or the process aborts.
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_CAL_DIR=<dir> RA_ABL_ARM=<label> bun --preload ./arm-plugin.ts <driver>.ts ...
import { plugin } from "bun"
import { existsSync, readFileSync } from "node:fs"

const SNAPSHOT = process.env.RA_ABL_SNAPSHOT
if (!SNAPSHOT) throw new Error("RA_ABL_SNAPSHOT (dir with <pkg>/src copies) is required")
const CAL_DIR = process.env.RA_ABL_CAL_DIR
if (!CAL_DIR || !existsSync(CAL_DIR)) throw new Error("RA_ABL_CAL_DIR (dir with <normalized-id>.json) is required")
const arm = process.env.RA_ABL_ARM ?? "?"

const once = (src: string, from: string, to: string): string => {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`arm-plugin: expected 1 match for ${JSON.stringify(from.slice(0, 60))}, found ${n}`)
  return src.replace(from, to)
}

const TARGET = "llm-provider/src/calibration.ts"
const patch = (code: string): string =>
  once(code, "const prebakedCandidates: string[] = [];",
    `const prebakedCandidates: string[] = [path.join(${JSON.stringify(CAL_DIR)}, \`\${key}.json\`)];`)

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
process.stderr.write(`[arm-plugin] arm=${arm} cal-dir=${CAL_DIR} snapshot=${SNAPSHOT}\n`)
