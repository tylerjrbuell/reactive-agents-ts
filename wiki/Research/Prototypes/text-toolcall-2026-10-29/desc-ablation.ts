// One-variable ablation: tool/param descriptions present vs empty (what compact profile sends). Raw Ollama, same system/user as the kernel sends.
const MODEL = process.argv[2] ?? "llama3.2:3b"; const N = Number(process.argv[3] ?? 20);
const mk = (desc: boolean) => [
 { type: "function", function: { name: "web-search", description: desc ? "Search the web for current information. Use only when the answer needs fresh or external facts." : "", parameters: { type: "object", required: ["query"], properties: { query: { type: "string", ...(desc ? { description: "The search query" } : {}) }, maxResults: { type: "number", ...(desc ? { description: "Max results" } : {}) } } } } },
 { type: "function", function: { name: "todo", description: desc ? "Manage a multi-step task checklist (add/update/list items)." : "", parameters: { type: "object", required: ["action"], properties: { action: { type: "string", ...(desc ? { description: "add | update | list" } : {}) }, items: { type: "array", items: { type: "string" } }, id: { type: "number" } } } } },
];
const msgs = [{ role: "system", content: "Environment:\nDate: Thursday, October 29, 2026\nYou are a helpful assistant. Use the provided tools when needed to complete tasks.\n\nGoal: What is 12 x 15? Answer with the number only." }, { role: "user", content: "What is 12 x 15? Answer with the number only.\n\nOutstanding requirements:\n- [answer] produce a substantive answer that addresses the task" }];
const names = new Set(["web-search", "todo"]);
for (const desc of [false, true]) {
  let textHall = 0, nativeReal = 0, nativeHall = 0, plain = 0;
  for (let i = 0; i < N; i++) {
    const m = (await (await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({ model: MODEL, stream: false, messages: msgs, tools: mk(desc), options: { temperature: 0.7 } }) })).json()).message;
    if (m.tool_calls?.length) { names.has(m.tool_calls[0].function.name) ? nativeReal++ : nativeHall++; }
    else if (/^\s*[\[{]\s*"(name|tool)"/.test(m.content ?? "")) textHall++;
    else plain++;
  }
  console.log(JSON.stringify({ model: MODEL, descriptions: desc, n: N, textToolShaped: textHall, nativeRealTool: nativeReal, nativeHallucinatedName: nativeHall, plainAnswer: plain }));
}
