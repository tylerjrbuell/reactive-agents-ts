// Zero-token render of model-visible internal prose per tier / dialect / calibration.
// Run: bun <this file>   (imports workspace src directly; no LLM calls)
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages";
const { builtinTools, metaToolDefinitions, todoTool, activateSkillTool, shellExecuteTool, requestUserInputTool } =
  await import(`${ROOT}/tools/src/index.ts`);
const { buildFinalAnswerDescription, buildFinalAnswerOutputDescription } = await import(`${ROOT}/tools/src/skills/final-answer.ts`);
const { buildSystemPrompt } = await import(`${ROOT}/reasoning/src/kernel/capabilities/attend/context-utils.ts`);
const { buildEnvironmentContext, buildToolReference, buildRules } = await import(`${ROOT}/reasoning/src/context/context-engine.ts`);
const { callConstraintNote, compactToolDescription } = await import(`${ROOT}/reasoning/src/kernel/capabilities/attend/tool-formatting.ts`);
const tpd = await import(`${ROOT}/tools/src/drivers/text-parse-driver.ts`).catch(() => undefined);

type Def = { name: string; description: string; parameters: ReadonlyArray<{ name: string; type: string; description?: string; required?: boolean; enum?: readonly string[] }> };
const tok = (s: string): number => Math.ceil(s.length / 4); // chars/4 estimate

const defs: Def[] = [
  ...builtinTools.map((t: { definition: Def }) => t.definition),
  ...metaToolDefinitions,
  todoTool, activateSkillTool, shellExecuteTool, requestUserInputTool,
].filter(Boolean);

const wireJson = (d: Def, desc: string, keepParamDesc: boolean) =>
  JSON.stringify({
    name: d.name,
    description: desc,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(d.parameters.map((p) => [p.name, { type: p.type, ...(keepParamDesc && p.description ? { description: p.description } : {}), ...(p.enum ? { enum: p.enum } : {}) }])),
      required: d.parameters.filter((p) => p.required).map((p) => p.name),
    },
  });
console.log("## Tool description sizes");
console.log("tool | desc chars | param-desc chars | full wire ~tok | callConstraintNote chars | compact wire ~tok (no param desc)");
let totFull = 0, totCompact = 0;
for (const d of defs) {
  const pd = d.parameters.reduce((n, p) => n + (p.description?.length ?? 0), 0);
  const full = tok(wireJson(d, d.description, true));
  const note = callConstraintNote(d as never);
  const compact = tok(wireJson(d, note, false));
  totFull += full; totCompact += compact;
  console.log(`${d.name} | ${d.description.length} | ${pd} | ${full} | ${note.length} | ${compact}`);
}
console.log(`TOTAL (${defs.length} tools): full ~${totFull} tok, compact ~${totCompact} tok`);

console.log("\n## Persona (buildSystemPrompt) by tier");
for (const tier of ["local", "mid", "large", "frontier"] as const) {
  const a = buildSystemPrompt("", undefined, tier, true);
  const b = buildSystemPrompt("", undefined, tier, false);
  console.log(`${tier}: ${a.length} chars (tools) | ${b.length} chars (no tools) :: ${JSON.stringify(a)}`);
}
console.log(`\nEnvironment block: ${buildEnvironmentContext().length} chars`);

const sample = defs.filter((d) => ["web-search", "file-read", "file-write", "crypto-price"].includes(d.name));
console.log("\n## In-prompt tool reference (non-native-FC only), 4 tools, web-search required");
for (const tier of ["local", "mid", "large", "frontier"]) {
  const r = buildToolReference("", sample as never, ["web-search"], "full", tier);
  console.log(`${tier}: ${r.length} chars`);
}
for (const tier of ["local", "mid", "frontier"] as const) {
  const r = buildRules(sample as never, ["web-search"], tier);
  console.log(`RULES (verboseRules opt-in) ${tier}: ${r.length} chars`);
}
if (tpd) {
  const Ctor = (tpd as Record<string, unknown>).TextParseDriver as (new () => { buildPromptInstructions(t: unknown[]): string }) | undefined;
  if (Ctor) {
    const s = new Ctor().buildPromptInstructions(sample);
    console.log(`\nTextParseDriver instructions (4 tools): ${s.length} chars`);
  } else console.log("text-parse driver exports:", Object.keys(tpd));
}

console.log("\n## final-answer description by systemPromptAttention");
for (const a of ["strong", "moderate", "weak", undefined] as const) {
  for (const fmt of [null, "code"] as const) {
    const d = buildFinalAnswerDescription({ systemPromptAttention: a, outputFormat: fmt as never });
    console.log(`attention=${a ?? "unset"} fmt=${fmt ?? "none"}: ${d.length} chars`);
  }
}
console.log(`final-answer output param (generic): ${buildFinalAnswerOutputDescription({}).length} chars`);
