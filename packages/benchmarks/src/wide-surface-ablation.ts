// wide-surface-ablation — does lazy tool disclosure earn its cost on a WIDE
// tool roster (MCP-scale), where the 10-builtin disclosure-ablation cannot see?
//
// The 2026-08-12 re-ablation measured pruning at ~10 tools: saves 4-18% tokens,
// no correctness effect. The open question is the opposite end: at 40+ tools,
// does pruning become load-bearing (the model cannot find the right tool in a
// wall of schemas) or actively harmful (the right tool gets pruned away)?
//
// Design: the task needs EXACTLY TWO named tools. Everything else is a plausible
// distractor. So "correct" answers "did disclosure surface the two that matter".
//
//   bun run wide-surface-ablation.ts <provider> <model> [runs] [outPath]
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { defineTool } from "@reactive-agents/tools";

const TASK =
  "Fetch the current metric named 'latency_p99' using the metrics tool, " +
  "then file a report containing that exact value using the report tool. " +
  "Your final answer MUST state the metric value.";

const SENTINEL = "873";

/** The two tools the task actually needs. */
const NEEDED_NAMES = ["metrics_fetch", "report_file"] as const;
const needed = [
  defineTool({
    name: "metrics_fetch",
    description: "Fetch a named operational metric value from the metrics store.",
    input: Schema.Struct({ metric: Schema.String }),
    handler: async (a) => `metric ${a.metric} = ${SENTINEL}`,
    timeoutMs: 5_000,
  }),
  defineTool({
    name: "report_file",
    description: "File a written report with a body of text. Returns a report id.",
    input: Schema.Struct({ body: Schema.String }),
    handler: async (a) => `report filed (${a.body.length} chars): ${a.body.slice(0, 60)}`,
    timeoutMs: 5_000,
  }),
];

/** Plausible MCP-roster distractors — realistic names/descriptions, never correct. */
const DISTRACTOR_SPECS: ReadonlyArray<readonly [string, string]> = [
  ["jira_issue_create", "Create a Jira issue in a project."],
  ["jira_issue_search", "Search Jira issues by JQL query."],
  ["slack_post_message", "Post a message to a Slack channel."],
  ["slack_list_channels", "List Slack channels in the workspace."],
  ["github_pr_open", "Open a pull request on a GitHub repository."],
  ["github_pr_review", "Leave a review on a GitHub pull request."],
  ["github_issue_close", "Close a GitHub issue by number."],
  ["s3_object_put", "Upload an object to an S3 bucket."],
  ["s3_object_get", "Download an object from an S3 bucket."],
  ["sql_query_run", "Run a read-only SQL query against the warehouse."],
  ["sql_schema_describe", "Describe the schema of a warehouse table."],
  ["pagerduty_incident_open", "Open a PagerDuty incident."],
  ["pagerduty_oncall_get", "Get the current on-call engineer."],
  ["calendar_event_create", "Create a calendar event for attendees."],
  ["calendar_freebusy", "Query free/busy times for a person."],
  ["email_send", "Send an email to a recipient list."],
  ["email_search", "Search the mailbox for messages."],
  ["docs_page_create", "Create a documentation page."],
  ["docs_page_search", "Search documentation pages by keyword."],
  ["k8s_pod_list", "List Kubernetes pods in a namespace."],
  ["k8s_pod_logs", "Fetch logs for a Kubernetes pod."],
  ["k8s_deploy_rollout", "Roll out a new Kubernetes deployment revision."],
  ["terraform_plan", "Run a terraform plan for an environment."],
  ["terraform_apply", "Apply a terraform plan."],
  ["datadog_monitor_create", "Create a Datadog monitor."],
  ["datadog_dashboard_get", "Fetch a Datadog dashboard definition."],
  ["stripe_refund_issue", "Issue a refund for a Stripe charge."],
  ["stripe_invoice_list", "List Stripe invoices for a customer."],
  ["salesforce_lead_create", "Create a lead record in Salesforce."],
  ["salesforce_account_get", "Fetch a Salesforce account by id."],
  ["zendesk_ticket_create", "Create a Zendesk support ticket."],
  ["zendesk_ticket_reply", "Reply to a Zendesk support ticket."],
  ["linear_issue_create", "Create a Linear issue."],
  ["notion_page_append", "Append a block to a Notion page."],
  ["figma_file_export", "Export a Figma file to an image."],
  ["sentry_issue_resolve", "Mark a Sentry issue as resolved."],
  ["snowflake_warehouse_resume", "Resume a Snowflake virtual warehouse."],
  ["airflow_dag_trigger", "Trigger an Airflow DAG run."],
  ["redis_key_expire", "Set a TTL on a Redis key."],
  ["vault_secret_read", "Read a secret from HashiCorp Vault."],
  ["dns_record_upsert", "Create or update a DNS record."],
  ["cdn_cache_purge", "Purge the CDN cache for a path."],
];

function distractors(n: number) {
  return DISTRACTOR_SPECS.slice(0, n).map(([name, description]) =>
    defineTool({
      name,
      description,
      input: Schema.Struct({ arg: Schema.optional(Schema.String) }),
      handler: async () => `${name}: not applicable to this task`,
      timeoutMs: 5_000,
    }),
  );
}

interface Cell {
  readonly surfaceSize: number;
  readonly arm: string;
  readonly tokens: number;
  readonly iterations: number;
  readonly discoverCalls: number;
  readonly calledNeeded: number;
  readonly correct: boolean;
  readonly offeredNeededMin: number;
  readonly offeredNeededFirst: number;
  readonly offeredMax: number;
  readonly status: string;
  readonly terminatedBy: string;
  readonly durationMs: number;
  readonly toolsCalled: readonly string[];
  readonly output: string;
}

const ARMS = [
  { name: "pruned(default)", env: {} as Record<string, string | undefined> },
  { name: "no-prune", env: { RA_LAZY_TOOLS: "0", RA_VERBOSE_RULES: "0" } },
] as const;

async function runCell(
  surfaceSize: number,
  arm: (typeof ARMS)[number],
  provider: string,
  model: string,
): Promise<Cell> {
  const dir = mkdtempSync(join(tmpdir(), "ra-wide-trace-"));
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(arm.env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const started = Date.now();
  let output = "";
  try {
    const tools = [...needed, ...distractors(surfaceSize - NEEDED_NAMES.length)];
    const agent = await ReactiveAgents.create()
      .withName(`wide-${surfaceSize}-${arm.name}`)
      .withProvider(provider as never)
      .withModel(model)
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({ tools } as never)
      .withMaxIterations(12)
      .withTracing({ dir })
      .build();
    const r = await agent.run(TASK);
    await agent.dispose();
    output = String(r.output ?? "");
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 120)}`;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  let tokens = 0;
  let iterations = 0;
  let discoverCalls = 0;
  let status = "unknown";
  let terminatedBy = "unknown";
  let offeredNeededEver = 0;
  let offeredNeededFirst = -1;
  let offeredMax = 0;
  const called = new Set<string>();

  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const kind = e["kind"];
      const resp = e["response"] as Record<string, number> | undefined;
      if (resp) tokens += (resp["tokensIn"] ?? 0) + (resp["tokensOut"] ?? 0);
      if (typeof e["iter"] === "number") iterations = Math.max(iterations, e["iter"] as number);
      if (kind === "tool-call-start" || kind === "tool-call-end") {
        const t = e["toolName"];
        if (typeof t === "string") {
          called.add(t);
          if (t === "discover-tools") discoverCalls++;
        }
      }
      if (kind === "tool-surface-resolved") {
        const md = (e["metadata"] ?? e) as Record<string, unknown>;
        const callable = (md["callable"] ?? md["visible"]) as unknown;
        const names: string[] = Array.isArray(callable)
          ? callable.map((c) => (typeof c === "string" ? c : String((c as { name?: string })?.name ?? "")))
          : [];
        if (names.length) {
          offeredMax = Math.max(offeredMax, names.length);
          const hit = NEEDED_NAMES.filter((n) => names.includes(n)).length;
          offeredNeededEver = Math.max(offeredNeededEver, hit);
          if (offeredNeededFirst < 0) offeredNeededFirst = hit;
        }
      }
      if (kind === "run-completed") {
        status = String(e["status"] ?? "unknown");
        const md = e["metadata"] as Record<string, unknown> | undefined;
        terminatedBy = String(md?.["terminatedBy"] ?? e["terminationReason"] ?? "unknown");
      }
    }
  }

  const calledNeeded = NEEDED_NAMES.filter((n) => called.has(n)).length;
  const correct = output.includes(SENTINEL) && calledNeeded === 2;

  return {
    surfaceSize,
    arm: arm.name,
    tokens,
    iterations,
    discoverCalls,
    calledNeeded,
    correct,
    offeredNeededMin: offeredNeededEver,
    offeredNeededFirst,
    offeredMax,
    status,
    terminatedBy,
    durationMs: Date.now() - started,
    toolsCalled: [...called],
    output: output.slice(0, 300),
  };
}

const provider = process.argv[2] ?? "ollama";
const model = process.argv[3] ?? "granite4:tiny-h";
const runs = Number(process.argv[4] ?? "2");
const outPath = process.argv[5];
const SIZES = [12, 44];

const cells: Cell[] = [];
for (let r = 0; r < runs; r++) {
  for (const size of SIZES) {
    for (const arm of ARMS) {
      const c = await runCell(size, arm, provider, model);
      cells.push(c);
      console.log(
        `[${r}] n=${String(c.surfaceSize).padStart(2)} ${c.arm.padEnd(16)} ` +
          `${String(c.tokens).padStart(6)}t it=${String(c.iterations).padStart(2)} ` +
          `disc=${c.discoverCalls} neededCalled=${c.calledNeeded}/2 ` +
          `offeredEver=${c.offeredNeededMin}/2 offeredIt0=${c.offeredNeededFirst}/2 offeredMax=${c.offeredMax} ` +
          `${c.correct ? "CORRECT" : "wrong  "} [${c.toolsCalled.slice(0,4).join(",")}]`,
      );
    }
  }
}

console.log(`\n── ${provider}/${model} · n=${runs} ──`);
console.log("size  arm                meanTok  correct  neededCalled  discoverCalls");
for (const size of SIZES) {
  for (const arm of ARMS) {
    const g = cells.filter((c) => c.surfaceSize === size && c.arm === arm.name);
    if (!g.length) continue;
    const tok = Math.round(g.reduce((s, c) => s + c.tokens, 0) / g.length);
    const ok = g.filter((c) => c.correct).length;
    const nc = (g.reduce((s, c) => s + c.calledNeeded, 0) / g.length).toFixed(1);
    const dc = g.reduce((s, c) => s + c.discoverCalls, 0);
    console.log(
      `${String(size).padEnd(6)}${arm.name.padEnd(19)}${String(tok).padStart(7)}` +
        `${(ok + "/" + g.length).padStart(9)}${nc.padStart(14)}${String(dc).padStart(15)}`,
    );
  }
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ provider, model, runs, sizes: SIZES, cells }, null, 2));
  console.log(`\nwrote ${cells.length} cells to ${outPath}`);
}
