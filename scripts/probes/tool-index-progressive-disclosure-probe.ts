/**
 * Probe for wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
 *
 * Cross-tier ablation instrument for the tool-disclosure mode taxonomy
 * (ContextProfile.toolDisclosureMode: "full" | "discover" | "index" |
 * "hybrid" — context-profile.ts). Tests whether an always-visible,
 * schema-free "hidden tool index" (RA_TOOL_INDEX=1, think.ts's
 * buildToolIndexText) recovers the iteration-count tax paid when lazy
 * disclosure hides a tool the task actually needs but doesn't name by name —
 * the exact failure class documented (with a hand measurement) in
 * tool-surface.ts:58-68 — and whether it beats 09 §5.2's removal ruling for
 * discover-tools instead of just coexisting badly with it.
 *
 * Four canonical modes, each mapped to the underlying flags (no public
 * builder API resolves the mode yet — see plan doc §6c, this is deliberate,
 * not yet ratified):
 *
 *   full     — RA_LAZY_TOOLS=0                      (no pruning at all)
 *   discover — RA_LAZY_TOOLS=1, DISCOVERY=1, INDEX=0 (today's shipped default)
 *   index    — RA_LAZY_TOOLS=1, DISCOVERY=0, INDEX=1 (replacement candidate)
 *   hybrid   — RA_LAZY_TOOLS=1, DISCOVERY=1, INDEX=1, INDEX_MAX_ENTRIES=set (capped index + discovery fallback)
 *
 * Two catalog sizes — SMALL (17 tools, just past PRUNE_MIN_TOOLS=15) tests
 * the base case; LARGE (60 tools) tests whether an uncapped "index" mode's
 * cost grows unacceptably and whether "hybrid" earns its complexity there.
 * Only `full`/`discover`/`index`/`hybrid` all run on SMALL; LARGE runs
 * `discover` (baseline) / `index` (uncapped, to show the growth problem) /
 * `hybrid` (capped, RA_TOOL_INDEX_MAX_ENTRIES=8) — `full` is not
 * interesting at 60 tools (guaranteed worse, not a live question).
 *
 * A first live sanity run (gpt-4o-mini, n=1, pre-taxonomy) showed the naive
 * "index added alongside discover-tools" combination is NOT simply better
 * than baseline: the model reached for the familiar discover-tools call
 * anyway, paying for both. That finding motivated splitting "index" (no
 * discover-tools — the real replacement test) from "hybrid" (both, but the
 * index is capped so it's cheap enough to justify keeping both) rather than
 * treating "add the index" as one candidate.
 *
 * Target tool: name/description share NO lexical overlap with the task
 * phrasing AND the name is deliberately unguessable (not a plausible
 * capability-name guess) — two confounds found and fixed live 2026-08-19,
 * see git history. Both mattered: a guessable name lets a capable model
 * blind-call it via universe-based healing regardless of visibility,
 * silently equalizing every arm.
 *
 * Metrics per cell: which iteration the target tool was first called on
 * (lower is better; -1 = never called), total run tokens, whether
 * discover-tools was called, action count, success.
 *
 * Run: bun scripts/probes/tool-index-progressive-disclosure-probe.ts
 * Env: MODELS="gpt-4o-mini:openai,qwen3:14b:ollama" REPS=5
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect, Ref } from "effect";
import { discoveredToolsStoreRef } from "@reactive-agents/tools";

const CELLS = (process.env.MODELS ?? "gpt-4o-mini:openai,qwen3:14b:ollama")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    // Fix (2026-08-19, found by ablation-warden): split on the LAST colon,
    // not the first two tokens. Ollama tags routinely contain a colon
    // (qwen3:14b), so `s.split(":")` on "qwen3:14b:ollama" used to
    // destructure to model="qwen3", provider="14b" — silently wrong, no
    // exception, cells just degraded (actionCount:0). Affected every probe
    // in this session that used the same `[model, provider] = s.split(":")`
    // pattern with a colon-bearing Ollama tag.
    const lastColon = s.lastIndexOf(":");
    const model = lastColon === -1 ? s : s.slice(0, lastColon);
    const provider = lastColon === -1 ? undefined : s.slice(lastColon + 1);
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
const FILLERS_SMALL = [
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

// LARGE catalog (60 fillers) — mechanically generated, still domain-unrelated
// and lexically disjoint from the task. Tests whether an uncapped "index"
// mode's cost grows unacceptably and whether "hybrid"'s cap earns its
// complexity at this size.
const LARGE_DOMAINS = [
  "podcast", "gym-class", "bus-route", "library-book", "parking-spot",
  "coupon", "restaurant-table", "movie-showtime", "gift-wrap", "pet-groomer",
  "dry-cleaner", "car-wash", "hair-salon", "bike-rental", "ferry-schedule",
  "hotel-room", "concert-ticket", "art-exhibit", "yoga-class", "wine-pairing",
];
const FILLERS_LARGE = [
  ...FILLERS_SMALL,
  ...LARGE_DOMAINS.flatMap((d, i) => [
    filler(`${d}-search`, `Search for ${d.replace("-", " ")} options matching criteria.`),
    filler(`${d}-book`, `Reserve or book a ${d.replace("-", " ")}.`),
  ]),
].slice(0, 60);

// The tool's output is a value NO amount of world knowledge or estimation
// can produce — a second confound found live 2026-08-19: the original task
// ("convert 100 USD to EUR") is answerable by a capable model's parametric
// knowledge alone, so `success` didn't actually require the tool being
// called at all, silently breaking the measurement. `REFERENCE_CODE` is
// fixed per probe run and has no real-world meaning to guess.
const REFERENCE_CODE = "QK-77219-ZM";
const targetTool = {
  definition: {
    name: TARGET_TOOL_NAME,
    description: "Retrieve the archived provenance stamp for a manifest entry.",
    parameters: [
      { name: "entryId", type: "string", description: "the manifest entry ID to look up", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) =>
    Effect.succeed({ entryId: args.entryId, provenanceStamp: REFERENCE_CODE }),
};

// A third confound found and fixed live 2026-08-19: the previous wording
// ("transaction ID" in both the task and the tool description) triggered
// filterToolsByRelevance's free keyword heuristic — a SINGLE shared word
// >3 chars is enough (`descMatch`, tool-formatting.ts, no relevance floor
// unlike discover-tools' own RELEVANCE_FLOOR=2) — rescuing the tool
// regardless of mode and re-equalizing every arm again. This phrasing shares
// zero words >3 chars with the tool's name/description.
const TASK =
  "What's the identifier for package TX-88213? Please tell me exactly what it is.";

function taskWasActuallySolved(answer: string | undefined): boolean {
  return typeof answer === "string" && answer.includes(REFERENCE_CODE);
}

type Mode = "full" | "discover" | "index" | "hybrid" | "index_capped";
type CatalogSize = "small" | "large";

const MODE_ENV: Record<Mode, Record<string, string>> = {
  full: { RA_LAZY_TOOLS: "0", RA_TOOL_DISCOVERY: "0", RA_TOOL_INDEX: "0" },
  discover: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "1", RA_TOOL_INDEX: "0" },
  index: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "0", RA_TOOL_INDEX: "1" },
  hybrid: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "1", RA_TOOL_INDEX: "1", RA_TOOL_INDEX_MAX_ENTRIES: "8" },
  // 2026-08-19 — the untested cell §6g flagged: caps index mode's uncapped
  // token growth WITHOUT registering discover-tools (which §6f found
  // actively depresses engagement on qwen3:14b, independent of any bug).
  // Combines what's proven to work (schema-promoted, correct-when-engaged)
  // with what's proven to fail (discover-tools' registration hurting a
  // model tier that doesn't understand its purpose).
  index_capped: { RA_LAZY_TOOLS: "1", RA_TOOL_DISCOVERY: "0", RA_TOOL_INDEX: "1", RA_TOOL_INDEX_MAX_ENTRIES: "8" },
};

// SMALL runs all 4 modes; LARGE skips `full` (guaranteed worse at 60 tools,
// not a live question) and focuses on whether `index` grows unacceptably
// vs `hybrid`'s cap, plus index_capped (the untested combination).
const CELL_PLAN: ReadonlyArray<{ catalog: CatalogSize; modes: readonly Mode[] }> = [
  { catalog: "small", modes: ["full", "discover", "index", "hybrid", "index_capped"] },
  { catalog: "large", modes: ["discover", "index", "hybrid", "index_capped"] },
];

const REPS = Number(process.env.REPS ?? "5");

async function runCell(model: string, provider: string, mode: Mode, catalog: CatalogSize) {
  const fillers = catalog === "large" ? FILLERS_LARGE : FILLERS_SMALL;
  // Fix for a real framework finding (2026-08-19): `discoveredToolsStoreRef`
  // (module-level Ref backing discover-tools' "discovered" set) is only
  // reset when RA_TOOL_DISCOVERY is ON (tool-capabilities.ts). Sequential
  // arms sharing one process otherwise leak a prior arm's discovered set
  // into a later discovery-OFF arm, making pruning look disabled entirely.
  // Force-reset here regardless of the flag, per-cell, so arms are isolated
  // the way separate processes/runs would be in production.
  await Effect.runPromise(Ref.set(discoveredToolsStoreRef, new Set<string>()));
  const prevEnv: Record<string, string | undefined> = {};
  const envToSet = { ...MODE_ENV[mode] };
  if (mode !== "hybrid" && mode !== "index_capped") envToSet.RA_TOOL_INDEX_MAX_ENTRIES = "0"; // explicit uncap for other modes
  for (const [k, v] of Object.entries(envToSet)) {
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
      .withTools({ tools: [...fillers, targetTool], metaTools: false });

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
        mode,
        catalog,
        success: r.success,
        // Primary metric — verbatim string match against the tool's
        // unguessable output, immune to the verifier's own (separately
        // noisy) judgment and to a capable model answering from world
        // knowledge without ever calling the tool.
        solved: taskWasActuallySolved(r.output),
        totalTokens: r.metadata.tokensUsed ?? r.metadata.totalTokens ?? 0,
        targetCallIteration,
        discoverCalled,
        actionCount: actionIdx + 1,
      };
    } finally {
      await agent.dispose();
    }
  } catch (e) {
    return { mode, catalog, error: String(e) };
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

type CellResult = {
  mode: Mode;
  catalog: CatalogSize;
  success?: boolean;
  solved?: boolean;
  totalTokens?: number;
  targetCallIteration?: number;
  discoverCalled?: boolean;
  actionCount?: number;
  error?: string;
};

function summarize(reps: readonly CellResult[]) {
  const n = reps.length;
  const solvedN = reps.filter((r) => r.solved).length;
  const found = reps.filter((r) => (r.targetCallIteration ?? -1) >= 0);
  const avgIterWhenFound = found.length > 0
    ? found.reduce((s, r) => s + (r.targetCallIteration ?? 0), 0) / found.length
    : null;
  const avgTokens = reps.reduce((s, r) => s + (r.totalTokens ?? 0), 0) / n;
  const discoverRate = reps.filter((r) => r.discoverCalled).length / n;
  return {
    n,
    // PRIMARY accuracy metric — see taskWasActuallySolved.
    solvedRate: solvedN / n,
    foundRate: found.length / n,
    avgIterWhenFound,
    avgTokens: Math.round(avgTokens),
    discoverRate,
  };
}

// Optional filters for targeted re-runs, e.g. MODES_FILTER=index_capped to
// re-test one new cell without re-running the whole matrix. CATALOG_FILTER
// narrows to one catalog size (2026-08-19: added for the qwen3:14b/large/index
// noise-floor re-verification — no need to re-pay small-catalog reps).
const modesFilter = process.env.MODES_FILTER
  ? new Set(process.env.MODES_FILTER.split(",").map((s) => s.trim()))
  : null;
const catalogFilter = process.env.CATALOG_FILTER ?? null;

const results: Record<string, unknown> = {};
for (const { model, provider } of CELLS) {
  for (const { catalog, modes } of CELL_PLAN) {
    if (catalogFilter && catalog !== catalogFilter) continue;
    for (const mode of modesFilter ? modes.filter((m) => modesFilter.has(m)) : modes) {
      const reps: CellResult[] = [];
      for (let i = 0; i < REPS; i++) {
        process.stderr.write(`\n[${provider}/${model}][${catalog}/${mode}][rep ${i + 1}/${REPS}] running... `);
        const r = (await runCell(model, provider, mode, catalog)) as CellResult;
        process.stderr.write(`${JSON.stringify(r)}\n`);
        reps.push(r);
      }
      const key = `${provider}/${model}/${catalog}/${mode}`;
      results[key] = { reps, summary: summarize(reps) };
      process.stderr.write(`\n=== ${key} summary: ${JSON.stringify(results[key])} ===\n`);
    }
  }
}
console.log("TOOL_INDEX_PROBE_RESULTS=" + JSON.stringify(results, null, 2));
