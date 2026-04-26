// bare-vs-harness-probe.ts — Pinpoint where the harness adds friction

// vs the model's actual capability.
//
// User's hypothesis: "the model is capable of completing them; the harness
// is getting in the way and overcomplicating it."
//
// Methodology: run the SAME task at three levels of abstraction:
//   A) Bare Ollama SDK call with the tool result inlined into the prompt
//      (no tool-calling, no agent loop — just synthesize-from-context)
//   B) Bare Ollama SDK with tool-calling support but no harness scaffolding
//      (let the model call the tool itself, then synthesize)
//   C) Our harness (ReactiveAgents) with tools registered
//
// For each level, measure:
//   - Did the output match the requested format?
//   - Did the output cite real values from the data?
//   - Did the output contain framework compression markers (echo failure)?
//   - Tokens used / wall time
//
// The diff between A and B isolates "tool-calling overhead vs raw synthesis"
// The diff between B and C isolates "what the harness adds to a tool-calling loop"
//
// Run: bun run .agents/skills/harness-improvement-loop/scripts/bare-vs-harness-probe.ts [model]
// Default model: gemma4:e4b. Override: PROBE_MODEL=cogito:14b bun ...

import { Ollama } from "ollama";
import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";

const MODEL = process.env.PROBE_MODEL ?? "gemma4:e4b";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

// ── Cached HN data so all three levels see identical source ────────────────
type HnPost = {
  id: number;
  title: string;
  score: number;
  url: string;
  by?: string;
  descendants?: number;
};

const HN_CACHE: HnPost[] = await (async () => {
  const ids = ((await (await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
  )).json()) as number[]).slice(0, 15);
  const items = await Promise.all(
    ids.map(async (id) => {
      const r = await (
        await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      ).json();
      return r as Partial<HnPost>;
    }),
  );
  return items.map((it, i): HnPost => ({
    id: ids[i] as number,
    title: it.title ?? "(no title)",
    score: it.score ?? 0,
    by: it.by,
    descendants: it.descendants ?? 0,
    url: it.url ?? `https://news.ycombinator.com/item?id=${ids[i]}`,
  }));
})();

console.log(`Cached ${HN_CACHE.length} HN posts. All three levels see identical data.\n`);

const HN_DATA_AS_TEXT = HN_CACHE.map(
  (p, i) => `${i + 1}. ${p.title} (score: ${p.score})`,
).join("\n");

const HN_DATA_AS_JSON = JSON.stringify(HN_CACHE, null, 2);

const TASK =
  `List the top ${HN_CACHE.length} Hacker News posts as a numbered markdown list, one line per post, using this exact format: '1. TITLE (score: SCORE)'. Use exact titles and scores. Output ONLY the numbered list.`;

// ── Quality scorer (same as task-quality-gate) ─────────────────────────────
function scoreSynthesis(output: string): {
  composite: number;
  faith: number;
  format: number;
  echoDetected: boolean;
  notes: string[];
} {
  const titlesFound = HN_CACHE.filter((p) => output.includes(p.title.slice(0, 30))).length;
  const scoresFound = HN_CACHE.filter((p) => output.includes(`${p.score}`)).length;
  const isNumberedList = /^\s*1\.|^\s*1\)/m.test(output);
  const lineCount = output.split("\n").filter((l) => /^\s*\d+[\.\)]/.test(l)).length;
  const echoDetected =
    output.includes("[recall result") ||
    output.includes("compressed preview") ||
    output.includes("_tool_result_") ||
    /^Type:\s*Array/m.test(output) ||
    output.includes("[STORED:");

  const faith = (titlesFound + scoresFound) / (HN_CACHE.length * 2);
  const format = isNumberedList && lineCount >= HN_CACHE.length ? 1.0 : isNumberedList ? 0.5 : 0;
  const composite = echoDetected ? 0 : faith * 0.5 + format * 0.3 + (titlesFound / HN_CACHE.length) * 0.2;

  return {
    composite,
    faith,
    format,
    echoDetected,
    notes: [
      `${titlesFound}/${HN_CACHE.length} titles cited`,
      `${scoresFound}/${HN_CACHE.length} scores cited`,
      `${lineCount} numbered lines`,
      isNumberedList ? "numbered list ✓" : "no numbered list ✗",
      echoDetected ? "★ tool-preview echo" : "real synthesis",
    ],
  };
}

// ── LEVEL A: Bare Ollama, tool result pre-inlined ─────────────────────────
async function levelA_bareInlined(): Promise<{
  output: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}> {
  console.log("─── LEVEL A: bare Ollama + inlined tool result (no tool calling) ───");
  const ollama = new Ollama({ host: OLLAMA_HOST });
  const start = performance.now();
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant. Follow the user's instructions exactly.",
      },
      {
        role: "user",
        content: `Here are the top 15 Hacker News posts (raw data):\n\n${HN_DATA_AS_JSON}\n\n${TASK}`,
      },
    ],
    options: { temperature: 0.3 },
  });
  const durationMs = performance.now() - start;
  return {
    output: response.message.content,
    durationMs,
    tokensIn: response.prompt_eval_count ?? 0,
    tokensOut: response.eval_count ?? 0,
  };
}

// ── LEVEL B: Bare Ollama with tool calling ─────────────────────────────────
async function levelB_bareToolCalling(): Promise<{
  output: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}> {
  console.log("─── LEVEL B: bare Ollama + tool-calling loop (no harness) ───");
  const ollama = new Ollama({ host: OLLAMA_HOST });
  const messages: import("ollama").Message[] = [
    {
      role: "system",
      content: "You are a helpful assistant. Use the get-hn-posts tool to fetch data, then respond.",
    },
    { role: "user", content: TASK },
  ];

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_hn_posts",
        description: "Fetch top Hacker News posts.",
        parameters: {
          type: "object",
          properties: {
            count: { type: "number", description: "How many top posts (1-15)" },
          },
          required: ["count"],
        },
      },
    },
  ];

  const start = performance.now();
  let totalIn = 0;
  let totalOut = 0;

  // Iteration 1: model decides to call tool
  let response = await ollama.chat({
    model: MODEL,
    messages,
    tools,
    options: { temperature: 0.3 },
  });
  totalIn += response.prompt_eval_count ?? 0;
  totalOut += response.eval_count ?? 0;

  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    messages.push(response.message);
    for (const tc of response.message.tool_calls) {
      // Execute tool ourselves (return raw cached data — no compression)
      const args = tc.function.arguments as Record<string, unknown>;
      const count = Math.min(15, Math.max(1, Number(args.count) || 15));
      const result = JSON.stringify(HN_CACHE.slice(0, count));
      messages.push({
        role: "tool",
        content: result,
      });
    }

    // Iteration 2: model synthesizes from tool result
    response = await ollama.chat({
      model: MODEL,
      messages,
      tools,
      options: { temperature: 0.3 },
    });
    totalIn += response.prompt_eval_count ?? 0;
    totalOut += response.eval_count ?? 0;
  }

  return {
    output: response.message.content,
    durationMs: performance.now() - start,
    tokensIn: totalIn,
    tokensOut: totalOut,
  };
}

// ── LEVEL D: smolagents-style few-shot system prompt ──────────────────────
// Hypothesis: a richer system prompt (worked Thought/Action/Output example
// + explicit reasoning pattern) primes the model to synthesize cleanly even
// when it sees the tool result via the standard `role: "tool"` channel.
async function levelD_smolagentsFewShot(): Promise<{
  output: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}> {
  console.log("─── LEVEL D: bare + tool-calling + smolagents-style few-shot system ───");
  const ollama = new Ollama({ host: OLLAMA_HOST });

  const systemPrompt = `You are a tool-using assistant that follows this pattern strictly:

THOUGHT: brief plan in one sentence.
ACTION: call a tool if needed.
OBSERVATION: <tool result appears here automatically>
FINAL: produce ONLY the answer the user asked for, in the exact format requested. Do not narrate. Do not call more tools.

Worked example:
USER: List the top 3 movies of 2024 as "1. TITLE (rating: N)".
THOUGHT: I need movie data. I'll call get_movies(count=3).
ACTION: get_movies({count: 3})
OBSERVATION: [{"title":"Dune","rating":8.7},{"title":"Inside Out 2","rating":7.6},{"title":"Wicked","rating":8.1}]
FINAL:
1. Dune (rating: 8.7)
2. Inside Out 2 (rating: 7.6)
3. Wicked (rating: 8.1)

Notice: FINAL contains ONLY the formatted list, no preamble, no commentary, no extra fields.`;

  const messages: import("ollama").Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: TASK },
  ];

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_hn_posts",
        description: "Fetch top Hacker News posts.",
        parameters: {
          type: "object",
          properties: {
            count: { type: "number", description: "How many top posts (1-15)" },
          },
          required: ["count"],
        },
      },
    },
  ];

  const start = performance.now();
  let totalIn = 0;
  let totalOut = 0;

  let response = await ollama.chat({
    model: MODEL,
    messages,
    tools,
    options: { temperature: 0.3 },
  });
  totalIn += response.prompt_eval_count ?? 0;
  totalOut += response.eval_count ?? 0;

  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    messages.push(response.message);
    for (const tc of response.message.tool_calls) {
      const args = tc.function.arguments as Record<string, unknown>;
      const count = Math.min(15, Math.max(1, Number(args.count) || 15));
      messages.push({
        role: "tool",
        content: JSON.stringify(HN_CACHE.slice(0, count)),
      });
    }

    response = await ollama.chat({
      model: MODEL,
      messages,
      tools,
      options: { temperature: 0.3 },
    });
    totalIn += response.prompt_eval_count ?? 0;
    totalOut += response.eval_count ?? 0;
  }

  return {
    output: response.message.content,
    durationMs: performance.now() - start,
    tokensIn: totalIn,
    tokensOut: totalOut,
  };
}

// ── LEVEL E: planning_interval / explicit synthesis nudge ─────────────────
// Hypothesis: after the tool result, inject a `role: "user"` message that
// restates the task and provides the format template. This is what
// smolagents calls "planning_interval" — periodic explicit re-orientation.
async function levelE_synthesisNudge(): Promise<{
  output: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}> {
  console.log("─── LEVEL E: bare + tool-calling + post-tool synthesis nudge ───");
  const ollama = new Ollama({ host: OLLAMA_HOST });

  const messages: import("ollama").Message[] = [
    {
      role: "system",
      content: "You are a helpful assistant. Use the get_hn_posts tool to fetch data, then respond.",
    },
    { role: "user", content: TASK },
  ];

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_hn_posts",
        description: "Fetch top Hacker News posts.",
        parameters: {
          type: "object",
          properties: {
            count: { type: "number", description: "How many top posts (1-15)" },
          },
          required: ["count"],
        },
      },
    },
  ];

  const start = performance.now();
  let totalIn = 0;
  let totalOut = 0;

  let response = await ollama.chat({
    model: MODEL,
    messages,
    tools,
    options: { temperature: 0.3 },
  });
  totalIn += response.prompt_eval_count ?? 0;
  totalOut += response.eval_count ?? 0;

  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    messages.push(response.message);
    for (const tc of response.message.tool_calls) {
      const args = tc.function.arguments as Record<string, unknown>;
      const count = Math.min(15, Math.max(1, Number(args.count) || 15));
      messages.push({
        role: "tool",
        content: JSON.stringify(HN_CACHE.slice(0, count)),
      });
    }

    // The curation moment — re-state task + format with explicit boundaries.
    messages.push({
      role: "user",
      content:
        `You've gathered ${HN_CACHE.length} Hacker News posts. ` +
        `Now write your FINAL answer using this exact template, one line per post:\n\n` +
        `1. TITLE (score: SCORE)\n2. TITLE (score: SCORE)\n... (continue for all ${HN_CACHE.length} posts)\n\n` +
        `Use the exact titles and scores from the tool result above. ` +
        `Output ONLY the numbered list. Do not call any more tools. Do not narrate.`,
    });

    response = await ollama.chat({
      model: MODEL,
      messages,
      tools,
      options: { temperature: 0.3 },
    });
    totalIn += response.prompt_eval_count ?? 0;
    totalOut += response.eval_count ?? 0;
  }

  return {
    output: response.message.content,
    durationMs: performance.now() - start,
    tokensIn: totalIn,
    tokensOut: totalOut,
  };
}

// ── LEVEL F: reframe-on-synthesis (curator pattern) ───────────────────────
// Hypothesis: at the synthesis moment, REPLACE the conversation with the
// shape that worked best in Level A — `system + user(data + task)`. The
// tool-calling round determined WHAT data to fetch; the curator collapses
// the result into the optimal synthesis-shape conversation.
async function levelF_reframeOnSynthesis(): Promise<{
  output: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
}> {
  console.log("─── LEVEL F: bare + tool-calling + reframe-on-synthesis ───");
  const ollama = new Ollama({ host: OLLAMA_HOST });

  let toolMessages: import("ollama").Message[] = [
    {
      role: "system",
      content: "You are a helpful assistant. Use the get_hn_posts tool to fetch data, then respond.",
    },
    { role: "user", content: TASK },
  ];

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_hn_posts",
        description: "Fetch top Hacker News posts.",
        parameters: {
          type: "object",
          properties: {
            count: { type: "number", description: "How many top posts (1-15)" },
          },
          required: ["count"],
        },
      },
    },
  ];

  const start = performance.now();
  let totalIn = 0;
  let totalOut = 0;
  let toolResult: HnPost[] | null = null;

  // Iteration 1: tool-call discovery only (we throw away this conversation
  // shape after we have the data)
  const response1 = await ollama.chat({
    model: MODEL,
    messages: toolMessages,
    tools,
    options: { temperature: 0.3 },
  });
  totalIn += response1.prompt_eval_count ?? 0;
  totalOut += response1.eval_count ?? 0;

  if (response1.message.tool_calls && response1.message.tool_calls.length > 0) {
    for (const tc of response1.message.tool_calls) {
      const args = tc.function.arguments as Record<string, unknown>;
      const count = Math.min(15, Math.max(1, Number(args.count) || 15));
      toolResult = HN_CACHE.slice(0, count);
    }
  }

  if (!toolResult) {
    // Model didn't call the tool — bail with whatever it produced
    return {
      output: response1.message.content,
      durationMs: performance.now() - start,
      tokensIn: totalIn,
      tokensOut: totalOut,
    };
  }

  // CURATOR MOMENT: replace the entire conversation with Level-A shape.
  // No assistant message, no tool message, no second tool call. Just the
  // distilled synthesis prompt.
  const reframed: import("ollama").Message[] = [
    {
      role: "system",
      content: "You are a helpful assistant. Follow the user's instructions exactly.",
    },
    {
      role: "user",
      content: `Here are the top ${toolResult.length} Hacker News posts (raw data):\n\n${JSON.stringify(toolResult, null, 2)}\n\n${TASK}`,
    },
  ];

  const response2 = await ollama.chat({
    model: MODEL,
    messages: reframed,
    options: { temperature: 0.3 },
  });
  totalIn += response2.prompt_eval_count ?? 0;
  totalOut += response2.eval_count ?? 0;

  return {
    output: response2.message.content,
    durationMs: performance.now() - start,
    tokensIn: totalIn,
    tokensOut: totalOut,
  };
}

// ── LEVEL C: Our harness ───────────────────────────────────────────────────
async function levelC_harness(): Promise<{
  output: string;
  durationMs: number;
  tokens: number;
  steps: number;
  toolCalls: number;
}> {
  console.log("─── LEVEL C: our harness (ReactiveAgents) ───");
  const hnTool = {
    definition: {
      name: "get-hn-posts",
      description: "Fetch top Hacker News posts.",
      parameters: [
        {
          name: "count",
          type: "number" as const,
          description: "How many",
          required: true,
          default: 15,
        },
      ],
      riskLevel: "low" as const,
      timeoutMs: 5_000,
      requiresApproval: false,
      source: "function" as const,
      cardinality: "batch" as const,
    },
    handler: (args: Record<string, unknown>) =>
      Effect.succeed(HN_CACHE.slice(0, Math.min(15, Math.max(1, Number(args.count) || 15))) as unknown),
  };

  const agent = await ReactiveAgents.create()
    .withName("bare-vs-harness")
    .withProvider("ollama")
    .withModel(MODEL)
    .withMemory()
    .withReasoning()
    .withContextProfile({ recentObservationsLimit: 5 })
    .withTools({ tools: [hnTool] })
    .build();

  const start = performance.now();
  const result = await agent.run(TASK);
  const durationMs = performance.now() - start;

  const steps = ((result as unknown as { steps?: ReadonlyArray<{ type: string }> }).steps) ?? [];
  const toolCalls = steps.filter((s) => s.type === "action").length;
  return {
    output: String(result.output ?? ""),
    durationMs,
    tokens: (result.metadata?.tokensUsed as number | undefined) ?? 0,
    steps: (result.metadata?.stepsCount as number | undefined) ?? 0,
    toolCalls,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
type RunResult = {
  label: string;
  shape: string;
  composite: number;
  faith: number;
  format: number;
  echoDetected: boolean;
  durationMs: number;
  tokens: number;
  outputPreview: string;
};

function logOne(
  label: string,
  shape: string,
  output: string,
  durationMs: number,
  tokens: number,
  extras: string,
): RunResult {
  const q = scoreSynthesis(output);
  console.log(`Output (${output.length} chars):`);
  console.log(output.slice(0, 500));
  console.log(`Quality: composite=${(q.composite * 100).toFixed(0)}%  faith=${(q.faith * 100).toFixed(0)}%  format=${(q.format * 100).toFixed(0)}%`);
  console.log(`Notes: ${q.notes.join("; ")}`);
  console.log(`Time: ${(durationMs / 1000).toFixed(1)}s | ${extras}\n`);
  return {
    label,
    shape,
    composite: q.composite,
    faith: q.faith,
    format: q.format,
    echoDetected: q.echoDetected,
    durationMs,
    tokens,
    outputPreview: output.slice(0, 100).replace(/\n/g, " "),
  };
}

async function main(): Promise<void> {
  console.log(
    `\nBare-vs-Harness Probe — ${MODEL} via Ollama at ${OLLAMA_HOST}\n` +
      `Task: produce a numbered markdown list of top ${HN_CACHE.length} HN posts.\n` +
      `Hypothesis under test: per-iteration conversation curation closes the B→A gap.\n`,
  );

  const results: RunResult[] = [];

  const a = await levelA_bareInlined();
  results.push(
    logOne(
      "A",
      "bare + inlined data (no tool call)",
      a.output,
      a.durationMs,
      a.tokensIn + a.tokensOut,
      `Tokens: ${a.tokensIn} in, ${a.tokensOut} out`,
    ),
  );

  const b = await levelB_bareToolCalling();
  results.push(
    logOne(
      "B",
      "bare + standard tool-calling loop",
      b.output,
      b.durationMs,
      b.tokensIn + b.tokensOut,
      `Tokens: ${b.tokensIn} in, ${b.tokensOut} out`,
    ),
  );

  const d = await levelD_smolagentsFewShot();
  results.push(
    logOne(
      "D",
      "tool-calling + smolagents few-shot system",
      d.output,
      d.durationMs,
      d.tokensIn + d.tokensOut,
      `Tokens: ${d.tokensIn} in, ${d.tokensOut} out`,
    ),
  );

  const e = await levelE_synthesisNudge();
  results.push(
    logOne(
      "E",
      "tool-calling + post-tool synthesis nudge (planning_interval)",
      e.output,
      e.durationMs,
      e.tokensIn + e.tokensOut,
      `Tokens: ${e.tokensIn} in, ${e.tokensOut} out`,
    ),
  );

  const f = await levelF_reframeOnSynthesis();
  results.push(
    logOne(
      "F",
      "tool-calling + reframe-on-synthesis (curator collapse to A-shape)",
      f.output,
      f.durationMs,
      f.tokensIn + f.tokensOut,
      `Tokens: ${f.tokensIn} in, ${f.tokensOut} out`,
    ),
  );

  const c = await levelC_harness();
  results.push(
    logOne(
      "C",
      "our harness (ReactiveAgents)",
      c.output,
      c.durationMs,
      c.tokens,
      `Tokens: ${c.tokens} | Steps: ${c.steps} | Tool calls: ${c.toolCalls}`,
    ),
  );

  // ── Comparison table ─────────────────────────────────────────────────────
  console.log("═".repeat(96));
  console.log("RESULTS (sorted by composite score, descending)");
  console.log("═".repeat(96));

  const sorted = [...results].sort((x, y) => y.composite - x.composite);
  console.log(
    `${"Lvl".padEnd(4)}${"Composite".padEnd(12)}${"Faith".padEnd(8)}${"Format".padEnd(8)}${"Echo".padEnd(6)}${"Time(s)".padEnd(10)}${"Tokens".padEnd(10)}Shape`,
  );
  console.log("─".repeat(96));
  for (const r of sorted) {
    console.log(
      `${r.label.padEnd(4)}` +
        `${(r.composite * 100).toFixed(0).padStart(3)}%`.padEnd(12) +
        `${(r.faith * 100).toFixed(0).padStart(3)}%`.padEnd(8) +
        `${(r.format * 100).toFixed(0).padStart(3)}%`.padEnd(8) +
        `${r.echoDetected ? "★" : "·"}`.padEnd(6) +
        `${(r.durationMs / 1000).toFixed(1)}`.padEnd(10) +
        `${r.tokens}`.padEnd(10) +
        r.shape,
    );
  }

  // ── Diagnosis ────────────────────────────────────────────────────────────
  console.log("");
  console.log("═".repeat(96));
  console.log("DIAGNOSIS — per-iteration curation hypothesis");
  console.log("═".repeat(96));
  const aS = results.find((r) => r.label === "A")!.composite;
  const bS = results.find((r) => r.label === "B")!.composite;
  const cS = results.find((r) => r.label === "C")!.composite;
  const dS = results.find((r) => r.label === "D")!.composite;
  const eS = results.find((r) => r.label === "E")!.composite;
  const fS = results.find((r) => r.label === "F")!.composite;

  console.log(`Baselines:`);
  console.log(`  A (data inlined, no tool)             = ${(aS * 100).toFixed(0)}%  ← capability ceiling`);
  console.log(`  B (standard tool-calling, no curator) = ${(bS * 100).toFixed(0)}%  ← cost of tool-calling`);
  console.log(`  C (our current harness)               = ${(cS * 100).toFixed(0)}%`);
  console.log(``);
  console.log(`Curation strategies:`);
  console.log(`  D (few-shot system prompt)            = ${(dS * 100).toFixed(0)}%  Δ vs B = ${((dS - bS) * 100).toFixed(0)}%`);
  console.log(`  E (post-tool synthesis nudge)         = ${(eS * 100).toFixed(0)}%  Δ vs B = ${((eS - bS) * 100).toFixed(0)}%`);
  console.log(`  F (reframe-on-synthesis / A-shape)    = ${(fS * 100).toFixed(0)}%  Δ vs B = ${((fS - bS) * 100).toFixed(0)}%`);
  console.log(``);
  const winnerCandidate = [
    { label: "D", shape: "few-shot system", score: dS },
    { label: "E", shape: "post-tool nudge", score: eS },
    { label: "F", shape: "reframe to A-shape", score: fS },
  ].sort((x, y) => y.score - x.score)[0]!;
  const closesGap = winnerCandidate.score >= aS * 0.9;
  console.log(
    `Winner among curation strategies: Level ${winnerCandidate.label} (${winnerCandidate.shape}) at ${(winnerCandidate.score * 100).toFixed(0)}%`,
  );
  console.log(
    `Hypothesis verdict: ${
      closesGap
        ? `★ CONFIRMED — Level ${winnerCandidate.label} reaches ≥90% of capability ceiling. Per-iteration curation IS the missing piece. Harness should adopt this shape.`
        : winnerCandidate.score > bS + 0.2
          ? `~ PARTIAL — Level ${winnerCandidate.label} closes part of the gap (+${((winnerCandidate.score - bS) * 100).toFixed(0)}%). Curation helps but isn't sufficient alone.`
          : `✗ NOT SUPPORTED — no curation variant materially closes B→A gap. Investigate other angles (model quirks, format, prompt phrasing).`
    }`,
  );
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
