// Does a deterministic reprompt recover when the model emitted a hallucinated-name text tool call?
// Raw Ollama /api/chat; tools = web-search + todo (same 2 as the Cortex surface). n per model.
const MODEL = process.argv[2] ?? "llama3.2:3b"; const N = Number(process.argv[3] ?? 10);
const tools = [
 { type: "function", function: { name: "web-search", description: "Search the web", parameters: { type: "object", required: ["query"], properties: { query: { type: "string" }, maxResults: { type: "number" } } } } },
 { type: "function", function: { name: "todo", description: "Manage a todo list", parameters: { type: "object", required: ["action"], properties: { action: { type: "string" } } } } },
];
const chat = async (messages: any[], useTools = true) => (await (await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({ model: MODEL, stream: false, messages, ...(useTools ? { tools } : {}), options: { temperature: 0.7 } }) })).json()).message;
const names = new Set(["web-search", "todo"]);
const isShape = (s: string) => /^\s*[\[{]\s*"(name|tool)"/.test(s);
let first = 0, textFirst = 0, recovered = 0, recoveredNoTools = 0, stillText = 0;
for (let i = 0; i < N; i++) {
  const base = [{ role: "system", content: "You are a helpful assistant. Use tools only when needed." }, { role: "user", content: "What is 12 x 15? Answer with the number only." }];
  const m = await chat(base); first++;
  if (m.tool_calls?.length || !isShape(m.content ?? "")) continue;
  textFirst++;
  let nm = ""; try { nm = JSON.parse(m.content).name } catch {}
  const hint = { role: "user", content: `Tool call used unavailable name(s): ${nm}. Available tools: web-search, todo. If no tool is needed, answer directly in plain text.` };
  const m2 = await chat([...base, { role: "assistant", content: m.content }, hint]);
  if (m2.tool_calls?.length || isShape(m2.content ?? "")) stillText++; else if (/180/.test(m2.content ?? "")) recovered++;
  const m3 = await chat([...base, { role: "assistant", content: m.content }, hint], false);
  if (/180/.test(m3.content ?? "") && !isShape(m3.content ?? "")) recoveredNoTools++;
}
console.log(JSON.stringify({ model: MODEL, n: N, textFirst, recoveredWithTools: recovered, stillToolShapedWithTools: stillText, recoveredWithoutTools: recoveredNoTools }));
