/**
 * Independent Ollama FC (Function Calling) test harness.
 * Tests different prompt patterns with cogito:14b to find optimal tool calling behavior.
 */
import { Ollama } from "ollama";

const client = new Ollama({ host: "http://localhost:11434" });
const MODEL = "cogito:14b";

const FILE_WRITE_TOOL = {
  type: "function" as const,
  function: {
    name: "file-write",
    description: "Write content to a file at the specified path",
    parameters: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string", description: "The file path to write to" },
        content: { type: "string", description: "The content to write" },
      },
    },
  },
};

const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web-search",
    description: "Search the web for information",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "The search query" },
      },
    },
  },
};

type TestCase = {
  name: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: any[] }>;
  tools: any[];
  think?: boolean;
  numPredict?: number;
};

const FAKE_SEARCH_RESULT = `Here are the search results for "AI agents 2026":
1. AI Agents are transforming enterprise workflows in 2026
2. Top frameworks: LangGraph, CrewAI, AutoGen, Reactive Agents
3. Multi-agent systems seeing rapid adoption
4. Focus on cost optimization and local model support`;

const tests: TestCase[] = [
  // ─── TEST 1: Single tool, simple instruction ───
  {
    name: "1. file-write only, simple ask",
    messages: [
      { role: "user", content: "Write a short greeting to ./hello.md" },
    ],
    tools: [FILE_WRITE_TOOL],
  },

  // ─── TEST 2: Two tools, ask to write ───
  {
    name: "2. Two tools, ask to write file",
    messages: [
      { role: "user", content: "Write a short greeting to ./hello.md" },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 3: Post-search context — model already has data, needs to write ───
  {
    name: "3. Post-search: has data, must write to file",
    messages: [
      { role: "user", content: "Research AI agents then write a report to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
      { role: "user", content: "Good, you have the search results. Now write the report to ./report.md using file-write." },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 4: System prompt emphasizing tool use ───
  {
    name: "4. System prompt: 'you MUST use tools'",
    messages: [
      { role: "system", content: "You are a helpful assistant. You MUST use the available tools to complete tasks. Never respond with text when a tool call is needed. Always call the appropriate tool." },
      { role: "user", content: "Write 'Hello World' to ./hello.md" },
    ],
    tools: [FILE_WRITE_TOOL],
  },

  // ─── TEST 5: Post-search, file-write only tool ───
  {
    name: "5. Post-search: file-write is ONLY available tool",
    messages: [
      { role: "system", content: "You are a research assistant. Use the available tools." },
      { role: "user", content: "Research AI agents then write a report to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
      { role: "user", content: "Now write the summary to ./report.md" },
    ],
    tools: [FILE_WRITE_TOOL],
  },

  // ─── TEST 6: Thinking mode ON + file-write ───
  {
    name: "6. Thinking enabled + file-write only",
    messages: [
      { role: "user", content: "Write a short AI trends summary to ./report.md based on this data:\n" + FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL],
    think: true,
  },

  // ─── TEST 7: Thinking mode OFF + file-write ───
  {
    name: "7. Thinking disabled + file-write only",
    messages: [
      { role: "user", content: "Write a short AI trends summary to ./report.md based on this data:\n" + FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL],
    think: false,
  },

  // ─── TEST 8: Multiple tools, after search, explicit system instruction ───
  {
    name: "8. All tools + system: 'call file-write next'",
    messages: [
      { role: "system", content: "You are a research assistant with access to tools. You have already completed the web search. Your next step is to call file-write to save the report. Do NOT call web-search again." },
      { role: "user", content: "Research AI agents then write a report to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 9: Conversation continuation with assistant acknowledgment ───
  {
    name: "9. Assistant acknowledges, then user says write",
    messages: [
      { role: "system", content: "You are a research assistant. Use tools to complete tasks." },
      { role: "user", content: "Research AI agents and write to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
      { role: "assistant", content: "I've gathered the search results about AI agents in 2026. Let me now write the report." },
      { role: "user", content: "Yes, please write the report to ./report.md now using the file-write tool." },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 10: No system prompt at all ───
  {
    name: "10. No system prompt, just user + tools",
    messages: [
      { role: "user", content: "Use the file-write tool to write 'Hello World' to the file ./hello.md" },
    ],
    tools: [FILE_WRITE_TOOL],
  },

  // ─── TEST 11: Last message is tool result (no user follow-up) ───
  {
    name: "11. Tool result is last msg (no user follow-up)",
    messages: [
      { role: "system", content: "You are a research assistant. Use tools to complete tasks. After searching, write the report using file-write." },
      { role: "user", content: "Research AI agents and write to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 12: Tool result → user "now write" (explicit user nudge) ───
  {
    name: "12. Tool result → user says 'now write'",
    messages: [
      { role: "system", content: "You are a research assistant." },
      { role: "user", content: "Research AI agents and write to ./report.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
      { role: "user", content: "Now write the report to ./report.md using file-write." },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 13: Heavy system prompt (mimics kernel) + tool result last ───
  {
    name: "13. Heavy system prompt + tool result last",
    messages: [
      { role: "system", content: `# Meta-Tools Quick Reference
- brief() — see all tools, documents, context budget
- find(query) — search documents, memory, or web
- pulse() — check progress
- recall(key, content) to store notes

Role: An assistant that researches topics and summarizes findings.
Instructions: Use web-search once or twice if needed, then you MUST call file-write to save the report to the exact path the user names. Do not finish with only search results — the deliverable is the markdown file on disk.

## RULES
1. You have access to the listed tools. Call them by name with the right arguments.
2. REQUIRED tools must be called before you can finish: web-search, file-write
3. After calling required tools, call final-answer to conclude.
4. Think step-by-step. Use available tools when needed.` },
      { role: "user", content: "Research the latest news and trends for AI Agents and AI Agent Frameworks, then summarize the key points into a concise but comprehensive report and write it to ./agent-news.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 14: Same as 13 but with user nudge after tool result ───
  {
    name: "14. Heavy system + tool result + user nudge",
    messages: [
      { role: "system", content: `# Meta-Tools Quick Reference
- brief() — see all tools, documents, context budget
- find(query) — search documents, memory, or web
- pulse() — check progress
- recall(key, content) to store notes

Role: An assistant that researches topics and summarizes findings.
Instructions: Use web-search once or twice if needed, then you MUST call file-write to save the report to the exact path the user names. Do not finish with only search results — the deliverable is the markdown file on disk.

## RULES
1. You have access to the listed tools. Call them by name with the right arguments.
2. REQUIRED tools must be called before you can finish: web-search, file-write
3. After calling required tools, call final-answer to conclude.
4. Think step-by-step. Use available tools when needed.` },
      { role: "user", content: "Research the latest news and trends for AI Agents and AI Agent Frameworks, then summarize the key points into a concise but comprehensive report and write it to ./agent-news.md" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "web-search", arguments: { query: "AI agents 2026" } } }] },
      { role: "tool", content: FAKE_SEARCH_RESULT },
      { role: "user", content: "Good. Now use file-write to save the report to ./agent-news.md" },
    ],
    tools: [FILE_WRITE_TOOL, WEB_SEARCH_TOOL],
  },

  // ─── TEST 15: Low num_predict (500) — does truncation break FC? ───
  {
    name: "15. Low num_predict=500 (truncation test)",
    messages: [
      { role: "user", content: "Write a detailed AI trends report to ./report.md based on:\n" + FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL],
    numPredict: 500,
  },

  // ─── TEST 16: Very low num_predict (200) — does truncation break FC? ───
  {
    name: "16. Very low num_predict=200 (truncation test)",
    messages: [
      { role: "user", content: "Write a detailed AI trends report to ./report.md based on:\n" + FAKE_SEARCH_RESULT },
    ],
    tools: [FILE_WRITE_TOOL],
    numPredict: 200,
  },
];

async function runTest(test: TestCase) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`TEST: ${test.name}`);
  console.log(`${"─".repeat(70)}`);

  try {
    const start = Date.now();
    const response = await client.chat({
      model: MODEL,
      messages: test.messages,
      tools: test.tools,
      stream: false,
      ...(test.think !== undefined ? { think: test.think } : {}),
      keep_alive: "5m",
      options: { temperature: 0.2, num_predict: test.numPredict ?? 2048 },
    });
    const elapsed = Date.now() - start;

    const hasToolCalls = response.message?.tool_calls && response.message.tool_calls.length > 0;
    const textContent = response.message?.content?.trim() || "(empty)";
    const thinking = (response.message as any)?.thinking;

    if (hasToolCalls) {
      console.log(`  RESULT: ✅ TOOL CALL(S)`);
      for (const tc of response.message.tool_calls!) {
        console.log(`    → ${tc.function.name}(${JSON.stringify(tc.function.arguments)})`);
      }
    } else {
      console.log(`  RESULT: ❌ TEXT RESPONSE (no tool call)`);
    }

    if (textContent !== "(empty)") {
      console.log(`  TEXT: ${textContent.slice(0, 200)}${textContent.length > 200 ? "..." : ""}`);
    }
    if (thinking) {
      console.log(`  THINKING: ${thinking.slice(0, 150)}${thinking.length > 150 ? "..." : ""}`);
    }
    console.log(`  done_reason: ${(response as any).done_reason ?? "n/a"} | ${elapsed}ms | ${response.prompt_eval_count ?? 0}+${response.eval_count ?? 0} tok`);

    return { name: test.name, toolCall: hasToolCalls, elapsed };
  } catch (err) {
    console.log(`  RESULT: ⚠️ ERROR: ${(err as Error).message}`);
    return { name: test.name, toolCall: false, elapsed: 0 };
  }
}

// Run all tests sequentially
console.log(`\nOllama FC Test Harness — Model: ${MODEL}`);
console.log(`${"═".repeat(70)}`);

const results: Awaited<ReturnType<typeof runTest>>[] = [];
for (const test of tests) {
  results.push(await runTest(test));
}

console.log(`\n\n${"═".repeat(70)}`);
console.log("SUMMARY");
console.log(`${"═".repeat(70)}`);
for (const r of results) {
  console.log(`  ${r.toolCall ? "✅" : "❌"} ${r.name} (${r.elapsed}ms)`);
}
const passed = results.filter((r) => r.toolCall).length;
console.log(`\n  ${passed}/${results.length} tests produced tool calls`);
