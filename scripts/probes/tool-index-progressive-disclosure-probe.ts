/**
 * Probe for wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
 *
 * Tests the counter-proposal to 09-UNIFIED-PROGRAM.md §5.2 (discover-tools
 * removal): does an always-visible, schema-free "hidden tool index"
 * (RA_TOOL_INDEX=1, think.ts's buildToolIndexText) recover the iteration-count
 * tax paid when lazy disclosure hides a tool the task actually needs but
 * doesn't name by name — the exact failure class documented (with a hand
 * measurement) in tool-surface.ts:58-68.
 *
 * Four arms per model:
 *   A — baseline        (RA_LAZY_TOOLS=1 default, RA_TOOL_DISCOVERY=1 default, RA_TOOL_INDEX=0)
 *   B — index+discovery (same + RA_TOOL_INDEX=1 — index ADDED alongside discover-tools)
 *   C — control          (RA_TOOL_DISCOVERY=0, RA_TOOL_INDEX=0 — pruning with NO rescue at all)
 *   D — index-only        (RA_TOOL_DISCOVERY=0, RA_TOOL_INDEX=1 — the actual REPLACEMENT test)
 *
 * A first live sanity run (gpt-4o-mini, n=1) showed arm B is NOT simply better
 * than A: with both discover-tools AND the index present, the model still
 * reached for the familiar discover-tools call on iteration 0 (habitual
 * affordance, ignoring the index text it was just shown), paying for BOTH the
 * index tokens and the discovery round-trip — worse than baseline that run.
 * Arm D isolates whether the index can REPLACE discovery, which is the actual
 * proposal in the plan doc (§3.5: not "add the index", but "does removing
 * discover-tools become viable once the index exists").
 *
 * Tool catalog: 16 filler tools (>PRUNE_MIN_TOOLS=15 so pruning actually
 * triggers) spanning unrelated domains, plus ONE target tool whose name and
 * description share no lexical overlap with the task's phrasing (paraphrased
 * need, not a named tool) — so the free keyword heuristic doesn't
 * accidentally rescue it and the prune is a clean, reproducible hide.
 *
 * Metrics: which iteration the target tool was first called on (lower is
 * better; a value of -1 means it was never called), total run tokens,
 * whether the model called discover-tools, and whether the run succeeded.
 *
 * Run: bun scripts/probes/tool-index-progressive-disclosure-probe.ts
 * Env: MODELS="gpt-4o-mini:openai,qwen3:14b:ollama"
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect, Ref } from "effect";
import { discoveredToolsStoreRef } from "@reactive-agents/tools";

const CELLS = (process.env.MODELS ?? "gpt-4o-mini:openai,qwen3:14b:ollama")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [model, provider] = s.split(":");
    return { model, provider: (provider ?? "openai") as "openai" | "ollama" | "anthropic" | "gemini" };
  });

// Deliberately an UNGUESSABLE name — this is a fix for a confound found
// live 2026-08-19: `fx-convert` was guessable enough that gpt-4o-mini blind-
// called it by name with ZERO rescue mechanism active (no discover-tools, no
// index) and it resolved anyway, because the tool-call resolver heals a
// model-named call against `toolSurface.universe` (the FULL catalog), not
// against `visible` (think.ts:183 — "a hallucinated-but-real tool name
// should still resolve"). A guessable name lets a capable model bypass the
// entire visibility mechanism by luck, which silently invalidates this probe
// (arms with NO rescue would falsely look identical to arms WITH one). An
// arbitrary internal-codename-style name removes that escape hatch.
const TARGET_TOOL_NAME = "zbx-rate-lk7";

function filler(name: string, desc: string) {
  return {
    definition: {
      name,
      description: desc,
      parameters: [{ name: "query", type: "string", description: "input", required: true }],
      riskLevel: "low" as const,
      timeoutMs: 5000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: () => Effect.succeed({ ok: true }),
  };
}

// 16 filler tools — deliberately unrelated domains, no lexical overlap with
// the task phrasing below. Pushes the catalog past PRUNE_MIN_TOOLS=15.
const FILLERS = [
  filler("weather-lookup", "Get the current weather forecast for a city."),
  filler("recipe-search", "Find cooking recipes matching a list of ingredients."),
  filler("calendar-create-event", "Create a new event on the user's calendar."),
  filler("send-sms", "Send a text message to a phone number."),
  filler("music-recommend", "Recommend songs based on a listening history."),
  filler("map-directions", "Get driving directions between two addresses."),
  filler("stock-quote", "Get the latest trading price for a stock ticker."),
  filler("news-headlines", "Fetch today's top news headlines by category."),
  filler("todo-add", "Add an item to the user's to-do list."),
  filler("image-caption", "Generate a caption describing an uploaded image."),
  filler("translate-text", "Translate text from one language to another."),
  filler("timer-set", "Set a countdown timer for a number of minutes."),
  filler("joke-tell", "Tell a short joke on a requested topic."),
  filler("flight-status", "Look up the status of a commercial flight by number."),
  filler("word-define", "Look up the dictionary definition of a word."),
  filler("quote-inspire", "Return an inspirational quote."),
];

const targetTool = {
  definition: {
    name: TARGET_TOOL_NAME,
    description: "Convert an amount between two currencies using live exchange rates.",
    parameters: [
      { name: "amount", type: "number", description: "amount to convert", required: true },
      { name: "from", type: "string", description: "source currency code", required: true },
      { name: "to", type: "string", description: "target currency code", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) =>
    Effect.succeed({ from: args.from, to: args.to, converted: Number(args.amount ?? 0) * 0.92 }),
};

// Paraphrased need — no "convert", "currency", "exchange", or "fx" tokens,
// and never mentions the tool name — so the free keyword heuristic
// (filterToolsByRelevance) has nothing to latch onto.
const TASK =
  "If I had 100 US dollars, about how much would that be worth in euros right now? Give me the number.";

type Arm = "A_baseline" | "B_index_plus_discovery" | "C_control" | "D_index_only";

const ARM_ENV: Record<Arm, Record<string, string>> = {
  A_baseline: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "1", RA_TOOL_INDEX: "0" },
  B_index_plus_discovery: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "1", RA_TOOL_INDEX: "1" },
  C_control: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "0", RA_TOOL_INDEX: "0" },
  D_index_only: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "0", RA_TOOL_INDEX: "1" },
};

async function runCell(model: string, provider: string, arm: Arm) {
  // Fix for a real framework finding (2026-08-19): `discoveredToolsStoreRef`
  // (module-level Ref backing discover-tools' "discovered" set) is only
  // reset when RA_TOOL_DISCOVERY is ON (tool-capabilities.ts). Sequential
  // arms sharing one process otherwise leak a prior arm's discovered set
  // into a later discovery-OFF arm, making pruning look disabled entirely.
  // Force-reset here regardless of the flag, per-cell, so arms are isolated
  // the way separate processes/runs would be in production.
  await Effect.runPromise(Ref.set(discoveredToolsStoreRef, new Set<string>()));
  const prevEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(ARM_ENV[arm])) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const modelCfg = provider === "ollama" ? { model, numCtx: 12000 } : { model };
    const b = ReactiveAgents.create()
      .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
      .withProvider(provider as "openai" | "ollama")
      .withModel(modelCfg)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      // Deliberately NO `allowedTools` — that's a permission floor
      // (tool-surface.ts: `allowed-floor`) that would force every tool
      // permanently visible regardless of pruning, defeating the whole test.
      .withTools({ tools: [...FILLERS, targetTool], metaTools: false });

    const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
    try {
      const r = await agent.run(TASK);
      const steps = ((r.metadata as Record<string, unknown>).reasoningSteps ?? []) as ReadonlyArray<{
        type: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }>;
      let targetCallIteration = -1;
      let discoverCalled = false;
      let actionIdx = -1;
      for (const step of steps) {
        if (step.type === "action") {
          actionIdx++;
          const tc = step.metadata?.toolCall as { name?: string } | undefined;
          if (tc?.name === TARGET_TOOL_NAME && targetCallIteration === -1) targetCallIteration = actionIdx;
          if (tc?.name === "discover-tools") discoverCalled = true;
        }
      }
      return {
        arm,
        success: r.success,
        totalTokens: r.metadata.tokensUsed ?? r.metadata.totalTokens ?? 0,
        targetCallIteration,
        discoverCalled,
        actionCount: actionIdx + 1,
      };
    } finally {
      await agent.dispose();
    }
  } catch (e) {
    return { arm, error: String(e) };
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const results: Record<string, unknown> = {};
for (const { model, provider } of CELLS) {
  for (const arm of ["A_baseline", "B_index_plus_discovery", "C_control", "D_index_only"] as const) {
    process.stderr.write(`\n[${provider}/${model}][${arm}] running... `);
    const r = await runCell(model, provider, arm);
    process.stderr.write(`${JSON.stringify(r)}\n`);
    results[`${provider}/${model}/${arm}`] = r;
  }
}
console.log("TOOL_INDEX_PROBE_RESULTS=" + JSON.stringify(results, null, 2));
