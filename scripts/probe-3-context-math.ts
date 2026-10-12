/**
 * Probe 3: small-context arithmetic on the local tier.
 * (a) FC wire-payload byte/token cost of the built-in toolset + meta-tools,
 *     measured through the SAME mapping think.ts:980 uses.
 * (b) tier cliff: profile-resolver outcome for common local model names.
 * (c) local vs mid toolResultMaxChars inversion (D-2026-07-30-H).
 *
 * Run: bun run scripts/probe-3-context-math.ts
 */
import { builtinTools } from "../packages/tools/src/skills/builtin.js"
import { resolveProfile, CONTEXT_PROFILES } from "../packages/reasoning/src/context/index.js"

// ── (a) replicate think.ts llmTools mapping ──
const toWire = (def: (typeof builtinTools)[number]["definition"]) => ({
  name: def.name,
  description: def.description,
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(
      (def.parameters ?? []).map((p) => [p.name, { type: p.type ?? "string", description: p.description }]),
    ),
    required: (def.parameters ?? []).filter((p) => p.required).map((p) => p.name),
  },
})
const wire = builtinTools.map((t) => toWire(t.definition))
const payload = JSON.stringify(wire)
const naive = Math.round(payload.length / 4)
const bpe = Math.round(naive * 1.35) // llama3/qwen BPE inflation on JSON ~30-50%
console.log(`(a) ${wire.length} builtin tools: ${payload.length} chars | chars/4=${naive} tok | BPE-adjusted ~${bpe} tok`)
console.log(`    per-tool top5: ${wire
  .map((t) => [t.name, JSON.stringify(t).length] as const)
  .sort((x, y) => y[1] - x[1])
  .slice(0, 5)
  .map(([n, c]) => `${n}:${c}`)
  .join(", ")}`)
console.log(`    vs num_ctx=8192 => schema alone = ${(bpe / 8192 * 100).toFixed(0)}% of window`)

// what fraction is description text (the part toolSchemaDetail could strip)?
const descOnly = JSON.stringify(wire.map((t) => t.description + Object.values(t.inputSchema.properties).map((p) => (p as { description?: string }).description ?? "").join(""))).length
console.log(`    description-text share: ${descOnly} chars (${(descOnly / payload.length * 100).toFixed(0)}% of payload) — "names-and-types" would cut the payload to ~${payload.length - descOnly} chars`)

// ── (b) tier cliff: how do real local models classify? ──
console.log("\n(b) profile-resolver classification (provider=ollama):")
for (const m of ["qwen3:4b", "qwen3:1.7b", "llama3.2:3b", "llama3.1:8b", "granite4:latest", "cogito:8b", "gemma4:e4b", "qwen2.5-coder:14b", "phi4-mini-reasoning"]) {
  const p = resolveProfile(m, undefined, "ollama")
  console.log(`    ${m.padEnd(20)} tier=${(p as { tier?: string }).tier ?? "?"}`)
}

// ── (c) the documented inversion: local preserves MORE tool-result text than mid ──
console.log("\n(c) tool-result budget inversion (D-2026-07-30-H):")
console.log(`    local.toolResultMaxChars = ${CONTEXT_PROFILES.local.toolResultMaxChars}`)
console.log(`    mid.toolResultMaxChars   = ${CONTEXT_PROFILES.mid.toolResultMaxChars}`)
console.log(`    => a 4B model classified 'mid' keeps 1200 chars; a real 'local' keeps 4000 — classification decides the opposite of the intent`)
console.log(`    local.toolSchemaDetail=${CONTEXT_PROFILES.local.toolSchemaDetail} mid.toolSchemaDetail=${CONTEXT_PROFILES.mid.toolSchemaDetail}`)
console.log(`    local.maxTokens=${CONTEXT_PROFILES.local.maxTokens} mid.maxTokens=${CONTEXT_PROFILES.mid.maxTokens}`)
