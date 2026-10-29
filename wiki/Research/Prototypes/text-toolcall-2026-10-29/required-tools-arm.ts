// Live check of F1+F2 chain with the fast path disabled (requiredTools set). args: MODEL N PROMPT_IDX
import { ReactiveAgents } from "reactive-agents";
const [MODEL = "llama3.2:3b", NS = "5", PI = "0"] = process.argv.slice(2);
const PROMPTS = ["What is 12 x 15? Answer with the number only.", "Explain what a hash map is in two sentences.", "Say hello in one word."];
const SHAPE = /^\s*[\[{]\s*"(name|tool|tool_name)"|<\|?tool_call|^\s*[\w-]+\(.*\)\s*$/s;
const calls: { tools: number }[] = [];
const rf = globalThis.fetch;
globalThis.fetch = (async (i: any, init?: any) => { try { const b = JSON.parse(String(init?.body)); if (/\/api\/chat/.test(String(i?.url ?? i))) { calls.push({ tools: b.tools?.length ?? 0 }); if (process.env.TRACEREQ) console.log('REQ ' + JSON.stringify({ tools: b.tools?.length ?? 0, last: b.messages.slice(-2).map((m: any) => m.role + ':' + String(m.content).slice(-260)) })); } } catch { /* */ } return rf(i, init); }) as typeof fetch;
for (let r = 0; r < Number(NS); r++) {
  calls.length = 0;
  const agent = await ReactiveAgents.create().withProvider("ollama").withModel(MODEL).withTools({ allowedTools: ["web-search"] } as any)
    .withRequiredTools({ tools: ["web-search"], maxRetries: 1 }).withReasoning({ defaultStrategy: "reactive" } as any).withMaxIterations(8).withTracing({ dir: "/tmp/ttc-traces" }).build();
  let out = "", tb = "", ok = false, toks = 0, it = 0;
  try { const res: any = await agent.run(PROMPTS[Number(PI)]!); out = String(res.output ?? ""); tb = String(res.terminatedBy ?? res.metadata?.terminatedBy ?? ""); toks = res.metadata?.tokensUsed ?? 0; it = res.metadata?.stepsCount ?? 0; ok = !!res.success; } catch (e) { out = "ERR " + String(e).slice(0, 80); }
  console.log("RUN " + JSON.stringify({ model: MODEL, prompt: Number(PI), r, shaped: SHAPE.test(out), tb, ok, toks, it, llmCalls: calls.length, noToolCalls: calls.filter(c => c.tools === 0).length, out: out.slice(0, Number(process.env.OUTLEN ?? 90)) }));
  await (agent as any).dispose?.();
}
