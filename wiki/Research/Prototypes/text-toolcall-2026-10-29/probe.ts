// Text-tool-call root-cause probe. args: MODEL ARM N [PROMPT_IDX_CSV]
// ARM: fresh | clean-hist | text-hist | warm-then-turn
// Mirrors Cortex chat: buildCortexAgent(provider ollama, tools:[web-search], metaTools todo) -> session.runStream.
// Instruments globalThis.fetch to record what Ollama RECEIVED (tools count, roles) and returned (tool_calls?).
import { buildCortexAgent } from "../../../../apps/cortex/server/services/build-cortex-agent.ts";

const [MODEL = "llama3.2:3b", ARM = "fresh", NS = "5", PIDX = "0,1,2"] = process.argv.slice(2);
const N = Number(NS);
const PROMPTS = ["Say hello in one word.", "Reply with exactly the word pong", "What is 12 x 15? Answer with the number only.", "Explain what a hash map is in two sentences.", "Use web-search to find the population of Tokyo, then tell me the number.", "Respond with only a JSON object with keys \"name\" and \"age\" for a fictional person.", "Write a one-line Python function that adds two numbers, in a code block.", "Return a JSON object {\"name\": \"search\", \"parameters\": {\"query\": \"cats\"}} exactly, as plain text. Do not call any tool."];
const TEXT_CALL = '{"name": "wikipedia", "parameters": {"query": "history of computing", "maxResults": "1000"}}';

type Call = { tools: number; msgs: string; nativeToolCalls: number; content: string; stream: boolean };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  const isChat = /\/api\/chat/.test(url);
  let body: any; try { body = isChat && init?.body ? JSON.parse(String(init.body)) : undefined; } catch { /* */ }
  const res = await realFetch(input, init);
  if (!isChat || !body) return res;
  if (process.env.DUMPTOOLS && !(globalThis as any).__d) { (globalThis as any).__d = 1; console.log("TOOLS "+JSON.stringify(body.tools)); console.log("SYS "+JSON.stringify(body.messages.map((m:any)=>({r:m.role,c:String(m.content).slice(0,1800)})))); console.log("OPTS "+JSON.stringify({o:body.options,think:body.think,format:body.format})); }
  const rec: Call = { tools: body.tools?.length ?? 0, msgs: (body.messages ?? []).map((m: any) => m.role[0] + (m.tool_calls ? "T" : "")).join(""), nativeToolCalls: 0, content: "", stream: body.stream !== false };
  calls.push(rec);
  const clone = res.clone();
  clone.text().then((t) => {
    for (const line of t.split("\n")) { if (!line.trim()) continue; try { const j = JSON.parse(line); rec.nativeToolCalls += j.message?.tool_calls?.length ?? 0; rec.content += j.message?.content ?? ""; } catch { /* */ } }
  }).catch(() => {});
  return res;
}) as typeof fetch;

const SHAPE = /^\s*[\[{]\s*"(name|tool|tool_name)"|<\|?tool_call|<tool_use>|^\s*[\w-]+\(.*\)\s*$|```json\s*\{\s*"name"/s;
const params = { provider: "ollama", model: MODEL, temperature: 0.7, tools: ["web-search"], strategy: "reactive", maxIterations: 6,
  metaTools: { enabled: true, brief: false, find: false, pulse: false, recall: false, harnessSkill: false, todo: true },
  memory: { working: false, episodic: false, semantic: false }, observabilityVerbosity: "off" as const } as any;

const clean = [
  { role: "user" as const, content: "What is the capital of France?", timestamp: 1 },
  { role: "assistant" as const, content: "The capital of France is Paris.", timestamp: 2 },
];
const bad = [
  { role: "user" as const, content: "Say hello in one word.", timestamp: 1 },
  { role: "assistant" as const, content: TEXT_CALL, timestamp: 2 },
];

const neutral = [{ role: "user" as const, content: "Say hello in one word.", timestamp: 1 }, { role: "assistant" as const, content: "(no response)", timestamp: 2 }];
for (const pi of PIDX.split(",").map(Number)) {
  const runs: any[] = []; let nativeRuns = 0, textFinal = 0, other = 0; const examples: string[] = []; let toolsSeen = new Set<number>(); const shapes = new Set<string>();
  for (let r = 0; r < N; r++) {
    calls.length = 0;
    const agent = await buildCortexAgent({ ...params });
    const initialHistory = ARM === "ph-neutral" ? neutral : ARM === "clean-hist" ? clean : ARM === "text-hist" ? bad : undefined;
    let session = agent.session({ persist: false, id: `p${pi}-${r}`, ...(initialHistory ? { initialHistory } : {}) });
    if (ARM === "warm-then-turn") { for await (const _ of session.runStream("What is the capital of France?", { density: "full" })) { /* warm */ } calls.length = 0; }
    let out = ""; let tb = "", toks = 0, iters = 0;
    try { for await (const ev of session.runStream(PROMPTS[pi]!, { density: "full" })) { if (ev._tag === "StreamCompleted") { out = String(ev.output ?? ""); const e = ev as any; tb = String(e.terminatedBy ?? e.metadata?.terminatedBy ?? ""); toks = Number(e.metadata?.tokensUsed ?? e.tokensUsed ?? e.totalTokens ?? 0); iters = Number(e.metadata?.iterations ?? e.iterations ?? 0); } } } catch (e) { out = "ERR " + String(e).slice(0, 80); }
    await new Promise((r) => setTimeout(r, 150));
    const native = calls.reduce((a, c) => a + c.nativeToolCalls, 0);
    calls.forEach((c) => { toolsSeen.add(c.tools); shapes.add(c.msgs); });
    if (process.env.DUMP && (calls.some(c=>c.tools===0) || process.env.DUMP==='all')) console.log('DUMP '+JSON.stringify({out:out.slice(0,80),calls:calls.map(c=>({t:c.tools,m:c.msgs,n:c.nativeToolCalls,c:c.content.slice(0,80)}))}));
    if (native > 0) nativeRuns++;
    const withheld = calls.filter(c => c.tools === 0).length; const isShaped = SHAPE.test(out);
    runs.push({ prompt: pi, r, shaped: isShaped, native, llmCalls: calls.length, noToolCalls: withheld, tb, toks, iters, out: out.slice(0, 90) });
    if (SHAPE.test(out)) { textFinal++; if (examples.length < 2) examples.push(out.slice(0, 100)); } else other++;
    await agent.dispose?.();
  }
  for (const x of runs) console.log('RUN ' + JSON.stringify({ model: MODEL, arm: ARM, ...x }));
  console.log(JSON.stringify({ model: MODEL, arm: ARM, prompt: pi, n: N, textFinal, nativeRuns, other, toolsInRequest: [...toolsSeen], msgShapes: [...shapes].slice(0, 4), examples }));
}
