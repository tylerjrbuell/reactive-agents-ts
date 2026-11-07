// Estimated paid spend from traces: sum llm-exchange response tokensIn/tokensOut x list price.
// gemini-2.5-flash list (paid tier, text): $0.30 / M input, $2.50 / M output (thinking billed as output).
//   bun cost.ts <results.json>...
import { readFileSync, existsSync } from "node:fs"
// gpt-4o-mini list: $0.15 / M input, $0.60 / M output. PRICE env selects: "gemini" | "4o-mini" (default).
const [IN, OUT] = process.env.PRICE === "gemini" ? [0.3 / 1e6, 2.5 / 1e6] : [0.15 / 1e6, 0.6 / 1e6]
let total = 0
for (const f of process.argv.slice(2)) {
  if (!existsSync(f)) continue
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Array<{ cellId: string; traceFile: string | null; billedTokens: number | null; tokens: number; accuracy: number | null }> }
  for (const c of r.cells) {
    let tin = 0, tout = 0, fw = 0
    if (c.traceFile && existsSync(c.traceFile)) {
      for (const l of readFileSync(c.traceFile, "utf8").trim().split("\n")) {
        const e = JSON.parse(l) as { kind: string; response?: { tokensIn?: number; tokensOut?: number }; totalCostUsd?: number }
        if (e.kind === "llm-exchange") { tin += e.response?.tokensIn ?? 0; tout += e.response?.tokensOut ?? 0 }
        if (e.kind === "run-completed") fw = e.totalCostUsd ?? 0
      }
    }
    // Fallback when the trace lacks per-call counts: price every billed token at the output rate (upper bound).
    const est = tin + tout > 0 ? tin * IN + tout * OUT : (c.billedTokens ?? c.tokens) * OUT
    total += est
    console.log(`${c.cellId} acc=${c.accuracy} in=${tin} out=${tout} billed=${c.billedTokens} est=$${est.toFixed(4)} framework=$${fw.toFixed(4)}`)
  }
}
console.log(`TOTAL_EST_USD=${total.toFixed(4)}`)
