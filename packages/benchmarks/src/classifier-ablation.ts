// classifier-ablation — does the tool-relevance classifier pay for itself?
//
// THE CLAIM UNDER TEST. `setup/classifier.ts` spends ONE extra LLM round-trip
// per run, default-on for every agent with `.withReasoning()`. What it buys is
// a NARROWER tool surface: in lazy mode (the default) `computePromptSchemas`
// builds the visible set as
//     classifiedRequired ∪ classifiedRelevant ∪ toolsUsed ∪ discovered ∪ allowed ∪ META
// so with classification the model sees a few tools, and WITHOUT it that union
// collapses to META-only — which trips the never-prune-to-meta-only guard and
// restores the FULL set. Classifier ON = narrow surface. Classifier OFF = every
// tool, every iteration.
//
// THE PRIOR MEASUREMENT WAS UNDERPOWERED, AND THIS IS THE CORRECTION. On
// 2026-07-28 the classifier was measured on a ONE-TOOL run and found to save
// exactly zero (2,556t ON vs 1,140t OFF). That result is real but it does not
// generalise, because a one-tool surface has nothing to prune. The classifier's
// saving scales with tool count while its cost is paid once, so there must be a
// BREAK-EVEN surface size. Reporting the one-tool cell as "the classifier costs
// +124% for nothing" would have been a finding read off a single point of a
// curve. This sweeps the curve instead.
//
// WHAT THE OFF ARM ACTUALLY IS — and it is NOT "no filtering". Turning the
// classifier off does not widen the surface to everything; `tool-schemas.ts`
// falls through to `filterToolsByRelevance`, a FREE keyword heuristic over the
// same tool set. So this measures **paid LLM classification vs free heuristic
// classification**, which is the only comparison that can justify the round
// trip. Framing it as "classifier vs nothing" would overstate what the spend
// buys.
//
// THE SURFACE-SIZE TRAP THAT VOIDED THE FIRST ARM SET (recorded so it is not
// re-walked): `withTools({ builtins: [...] })` with an ARRAY is a prune FLOOR
// (tool-schemas.ts:198 — every named builtin is re-added after filtering). A
// first design floored 10 builtins and added 20 custom tools; both arms then
// reported an identical visible set of 12, because the floor supplied the
// surface and each arm pruned all 20 custom tools away. The token deltas were
// real and measured nothing. Floor ONLY the tool the task genuinely needs.
//
//   bun run packages/benchmarks/src/classifier-ablation.ts <provider> <model> [runs]
//
// Cells: {small≈1, large≈21} tool surfaces × {tool, no-tool, custom-tool} tasks
//        × {classifier on, heuristic}. Run against ≥2 tiers — the lift rule
//        (09 §6) requires it, and a mechanism defended as "it helps weak models"
//        must be shown to help weak models specifically.
//
// READ THE OUTCOME COLUMN BESIDE THE TOKENS, and read `vis` before either. A
// cheaper arm that stops producing the deliverable is not a saving, and two arms
// reporting the same `vis` did not differ at all. The whole reason this file
// carries a manipulation check is that the last three "wins" this session were
// probe artifacts.
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";
import type { ToolDefinition } from "@reactive-agents/tools";

/** Synthetic domain tools, shaped like a mid-size MCP server's roster. Their
 *  descriptions are deliberately plausible-but-irrelevant to both tasks: that
 *  is the load the classifier claims to remove. */
const FILLER_TOOLS = [
  ["jira-search", "Search Jira issues by JQL query"],
  ["jira-comment", "Post a comment on a Jira issue"],
  ["slack-post", "Post a message to a Slack channel"],
  ["slack-history", "Read recent messages from a Slack channel"],
  ["pager-alert", "Raise a PagerDuty alert for a service"],
  ["s3-list", "List objects in an S3 bucket"],
  ["s3-get", "Download an object from an S3 bucket"],
  ["dns-lookup", "Resolve a hostname to its DNS records"],
  ["k8s-pods", "List Kubernetes pods in a namespace"],
  ["k8s-logs", "Fetch logs for a Kubernetes pod"],
  ["sql-query", "Run a read-only SQL query against the analytics warehouse"],
  ["sql-schema", "Describe the schema of a warehouse table"],
  ["metrics-query", "Query a time-series metric from the monitoring backend"],
  ["ticket-create", "Create a support ticket in the helpdesk system"],
  ["user-lookup", "Look up a user profile by email address"],
  ["invoice-fetch", "Fetch a customer invoice by invoice number"],
  ["calendar-list", "List upcoming calendar events for a user"],
  ["email-send", "Send an email to a recipient"],
  ["translate-text", "Translate text between two languages"],
  ["geocode", "Convert a street address into latitude and longitude"],
] as const;

function fillerTool(name: string, description: string) {
  return {
    definition: {
      name,
      description,
      parameters: [
        { name: "input", type: "string" as const, description: "Input value", required: true },
      ],
      category: "custom",
      riskLevel: "low",
    } as unknown as ToolDefinition,
    handler: (args: Record<string, unknown>) =>
      Effect.succeed(
        // `sql-query` is the target of the custom-tool task, so its result has
        // to be a checkable value rather than an echo — otherwise "did the
        // right tool get surfaced" cannot be read off the output.
        name === "sql-query" ? "1 row: answer=42" : `${name}: ${String(args.input)}`,
      ),
  };
}

interface Task {
  readonly id: string;
  readonly prompt: string;
  /** Deliverable file that must exist in the sandbox root, or undefined for a
   *  pure-answer task. */
  readonly file?: string;
  /** Substring the answer must contain for a pure-answer task. */
  readonly answer?: string;
}

const TASKS: readonly Task[] = [
  {
    id: "tool",
    prompt:
      "Write a file ./report.md containing exactly three markdown bullet points " +
      "summarising what a unit test is. Then state that you are done.",
    file: "report.md",
  },
  {
    id: "notool",
    prompt: "What is 17 × 23? Answer with just the number.",
    answer: "391",
  },
  {
    // The cell where classification QUALITY, not just cost, is on the line. The
    // needed tool is a CUSTOM tool, so no builtins floor rescues it: whichever
    // filter fails to surface `sql-query` makes the task unsolvable. On the
    // small surface it is one of two tools (both filters should find it); on the
    // large surface it is one of twenty-one.
    id: "custom",
    prompt:
      "Use the sql-query tool to run the query `SELECT answer FROM t` and report the answer value it returns.",
    answer: "42",
  },
];

interface Cell {
  readonly tier: string;
  readonly surface: string;
  readonly task: string;
  readonly arm: string;
  readonly ok: boolean;
  readonly correct: boolean;
  readonly totalTokens: number;
  readonly classifierTokens: number;
  readonly calls: number;
  readonly iterations: number;
  readonly status: string;
  readonly durationMs: number;
  readonly output: string;
  /** Visible tool count on the FIRST think iteration, read from
   *  `tool-surface-resolved`. This is the manipulation check: if ON and OFF
   *  report the same number the arms did not actually differ and every token
   *  delta below is measuring something else. */
  readonly visibleFirst: number;
  /** Max visible count across iterations — catches a surface that re-widens. */
  readonly visibleMax: number;
}

async function runCell(
  tier: string,
  provider: string,
  model: string,
  surface: "small" | "large",
  task: Task,
  arm: "on" | "off",
): Promise<Cell> {
  const root = mkdtempSync(join(tmpdir(), "ra-cls-root-"));
  const dir = mkdtempSync(join(tmpdir(), "ra-cls-trace-"));
  mkdirSync(root, { recursive: true });
  const started = Date.now();
  let output = "";
  let ok = false;
  try {
    // Floor ONLY `file-write` — the single builtin the `tool` task needs. Every
    // other tool on the surface is a custom tool, which the filters are free to
    // prune. Widening this floor is what voided the first arm set (see header).
    //
    // `small` carries sql-query alone so the custom-tool task stays solvable at
    // both sizes; `large` buries it among twenty. Surface size is then the ONLY
    // thing that varies, and it varies for both filters equally.
    const filler = surface === "small"
      ? FILLER_TOOLS.filter(([n]) => n === "sql-query")
      : FILLER_TOOLS;
    let b = ReactiveAgents.create()
      .withName(`cls-${surface}-${task.id}-${arm}`)
      .withProvider(provider as never)
      .withModel(model)
      .withTools({
        builtins: ["file-write"],
        tools: filler.map(([n, d]) => fillerTool(n, d)),
      } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(8)
      .withTracing({ dir });
    // The ONLY difference between arms. `adaptive: false` is the documented
    // opt-out path in setup/classifier.ts; no static tool list is supplied, so
    // neither arm gets required-tool enforcement it did not earn. The `off` arm
    // still filters — via the free keyword heuristic — so this is LLM-vs-
    // heuristic, not LLM-vs-nothing.
    if (arm === "off") {
      b = (b as unknown as { withRequiredTools: (o: unknown) => typeof b }).withRequiredTools({
        adaptive: false,
      });
    }
    const agent = await b.build();
    const r = await withFileRoot(root, async () => agent.run(task.prompt));
    await agent.dispose();
    output = String(r.output ?? "").slice(0, 100).replace(/\s+/g, " ");
    ok = true;
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 100)}`;
  }
  const durationMs = Date.now() - started;

  let totalTokens = 0;
  let classifierTokens = 0;
  let calls = 0;
  let iterations = 0;
  let status = "unknown";
  let visibleFirst = -1;
  let visibleMax = 0;
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string;
          purpose?: string;
          status?: string;
          iter?: number;
          visible?: readonly string[];
          response?: { tokensIn?: number; tokensOut?: number };
        };
        if (typeof e.iter === "number" && e.iter > iterations) iterations = e.iter;
        if (e.kind === "run-completed") status = e.status ?? "unknown";
        if (e.kind === "tool-surface-resolved" && Array.isArray(e.visible)) {
          if (visibleFirst < 0) visibleFirst = e.visible.length;
          if (e.visible.length > visibleMax) visibleMax = e.visible.length;
          // RA_CLS_DUMP=1 prints the resolver's per-tool reason map. This is the
          // second-level manipulation check: `vis` says the surfaces differ in
          // SIZE, the reasons say WHY a given tool was hidden — which is the
          // difference between "the filter pruned it" and "it never reached the
          // kernel's schema set at all". Two arm-sets were misread before this
          // existed.
          if (process.env.RA_CLS_DUMP) {
            const reasons = (e as { reasons?: readonly { tool: string; reason: string }[] }).reasons ?? [];
            console.log(`    [${arm}] visible(${e.visible.length}): ${e.visible.join(",")}`);
            for (const r of reasons) console.log(`        ${r.tool} — ${r.reason}`);
          }
        }
        if (e.kind !== "llm-exchange") continue;
        const t = (e.response?.tokensIn ?? 0) + (e.response?.tokensOut ?? 0);
        totalTokens += t;
        calls++;
        // `extract` is the purpose classifyToolRelevance runs under — this is
        // the line item the arm is supposed to remove.
        if (e.purpose === "extract") classifierTokens += t;
      } catch {
        /* skip malformed line */
      }
    }
  }

  const correct = task.file
    ? readdirSync(root).includes(task.file)
    : output.includes(task.answer ?? " ");

  rmSync(dir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return {
    tier, surface, task: task.id, arm, ok, correct,
    totalTokens, classifierTokens, calls, iterations, status, durationMs, output,
    visibleFirst: Math.max(visibleFirst, 0), visibleMax,
  };
}

if (import.meta.main) {
  const provider = process.argv[2] ?? "anthropic";
  const model = process.argv[3] ?? "claude-haiku-4-5-20251001";
  const runs = Number(process.argv[4] ?? "1");
  const tier = `${provider}/${model}`;
  const surfaces = (process.env.RA_CLS_SURFACES ?? "small,large").split(",") as ("small" | "large")[];
  const taskFilter = process.env.RA_CLS_TASKS?.split(",");
  const tasks = taskFilter ? TASKS.filter((t) => taskFilter.includes(t.id)) : TASKS;

  const cells: Cell[] = [];
  for (let i = 0; i < runs; i++) {
    for (const surface of surfaces) {
      for (const task of tasks) {
        for (const arm of ["on", "off"] as const) {
          const c = await runCell(tier, provider, model, surface, task, arm);
          cells.push(c);
          console.log(
            `[${i + 1}] ${surface.padEnd(5)} ${c.task.padEnd(6)} cls=${arm.padEnd(3)} ` +
              `${String(c.totalTokens).padStart(7)}t (cls ${String(c.classifierTokens).padStart(5)}t) ` +
              `${c.calls}call it=${c.iterations} vis=${c.visibleFirst}/${c.visibleMax} ${c.correct ? "OK " : "BAD"} ` +
              `${c.status.padEnd(9)} ${(c.durationMs / 1000).toFixed(1)}s`,
          );
        }
      }
    }
  }

  console.log(`\n── ${tier} · n=${runs} ──`);
  console.log("surface task   ON tokens  OFF tokens   delta   ON correct  OFF correct");
  for (const surface of surfaces) {
    for (const task of tasks) {
      const on = cells.filter((c) => c.surface === surface && c.task === task.id && c.arm === "on");
      const off = cells.filter((c) => c.surface === surface && c.task === task.id && c.arm === "off");
      if (!on.length || !off.length) continue;
      const mean = (xs: Cell[]) => xs.reduce((s, c) => s + c.totalTokens, 0) / xs.length;
      const onT = mean(on);
      const offT = mean(off);
      const delta = offT > 0 ? ((onT - offT) / offT) * 100 : 0;
      console.log(
        `${surface.padEnd(7)} ${task.id.padEnd(6)} ${Math.round(onT).toString().padStart(9)} ` +
          `${Math.round(offT).toString().padStart(11)} ${(delta >= 0 ? "+" : "") + delta.toFixed(0) + "%"}`.padEnd(9) +
          `   ${on.filter((c) => c.correct).length}/${on.length}` +
          `          ${off.filter((c) => c.correct).length}/${off.length}`,
      );
    }
  }
  console.log(
    "\nNegative delta = classifier ON is cheaper. Check the correct columns before\n" +
      "believing any delta: a cheaper arm that drops the deliverable is not a saving.\n" +
      `n=${runs} per cell — resolves large differences only (bench cells are Bernoulli).`,
  );
  console.log(`\nJSON ${JSON.stringify({ tier, runs, cells })}`);
}
