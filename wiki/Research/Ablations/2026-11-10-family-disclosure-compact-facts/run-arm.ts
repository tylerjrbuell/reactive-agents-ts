// Driver for the custom-tool tasks (umami-explore, wide-metric), ONE arm per process.
// The arm is fixed by the preload plugin (RA_ABL_ARM, see ./arm-plugin.ts); the shell
// alternates arms per run index, so pairs share the frozen tree. Task definitions are
// copied unchanged from ../2026-11-10-stable-tool-list/run-wide.ts (same scoring).
// Rows are H3Cell-shaped so ./to-session.ts can pool them.
//
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts run-arm.ts \
//     --tier mimo-v2.6|grok-4 [--num-ctx 16384] --runs 0,1 --out-dir <abs> --task umami-explore [--cell-timeout-sec 240]
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { Schema } from "effect"
import { ReactiveAgents } from "@reactive-agents/runtime"
import { defineTool } from "@reactive-agents/tools"
import { primeCapability } from "@reactive-agents/llm-provider"

const arg = (n: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const TIERS: Record<string, { provider: "ollama" | "xai"; model: string }> = {
  "mimo-v2.6": { provider: "ollama", model: "mimo-v2.6" },
  "grok-4": { provider: "xai", model: "grok-4" },
}
const tierId = arg("tier")!
const tier = TIERS[tierId]
if (!tier) { console.error(`unknown tier ${tierId}`); process.exit(2) }
const arm = process.env.RA_ABL_ARM ?? "base"
const numCtx = arg("num-ctx") ? Number(arg("num-ctx")) : undefined
const tierLabel = numCtx ? `${tierId}@${numCtx}` : tierId
const runs = (arg("runs", "0") as string).split(",").map(Number)
const outDir = arg("out-dir")!
const cellTimeoutSec = Number(arg("cell-timeout-sec", "240"))
const taskFilter = (arg("task", "umami-explore") as string).split(",")

// ── task 1: wide-metric (2 needed tools in a 40-tool roster) ────────────────
const SENTINEL = "873"
const DISTRACTORS: ReadonlyArray<readonly [string, string]> = [
  ["jira_issue_create", "Create a Jira issue in a project."], ["jira_issue_search", "Search Jira issues by JQL query."],
  ["slack_post_message", "Post a message to a Slack channel."], ["slack_list_channels", "List Slack channels in the workspace."],
  ["github_pr_open", "Open a pull request on a GitHub repository."], ["github_pr_review", "Leave a review on a GitHub pull request."],
  ["github_issue_close", "Close a GitHub issue by number."], ["s3_object_put", "Upload an object to an S3 bucket."],
  ["s3_object_get", "Download an object from an S3 bucket."], ["sql_query_run", "Run a read-only SQL query against the warehouse."],
  ["sql_schema_describe", "Describe the schema of a warehouse table."], ["pagerduty_incident_open", "Open a PagerDuty incident."],
  ["pagerduty_oncall_get", "Get the current on-call engineer."], ["calendar_event_create", "Create a calendar event for attendees."],
  ["calendar_freebusy", "Query free/busy times for a person."], ["email_send", "Send an email to a recipient list."],
  ["email_search", "Search the mailbox for messages."], ["docs_page_create", "Create a documentation page."],
  ["docs_page_search", "Search documentation pages by keyword."], ["k8s_pod_list", "List Kubernetes pods in a namespace."],
  ["k8s_pod_logs", "Fetch logs for a Kubernetes pod."], ["k8s_deploy_rollout", "Roll out a new Kubernetes deployment revision."],
  ["terraform_plan", "Run a terraform plan for an environment."], ["terraform_apply", "Apply a terraform plan."],
  ["datadog_monitor_create", "Create a Datadog monitor."], ["datadog_dashboard_get", "Fetch a Datadog dashboard definition."],
  ["stripe_refund_issue", "Issue a refund for a Stripe charge."], ["stripe_invoice_list", "List Stripe invoices for a customer."],
  ["salesforce_lead_create", "Create a lead record in Salesforce."], ["salesforce_account_get", "Fetch a Salesforce account by id."],
  ["zendesk_ticket_create", "Create a Zendesk support ticket."], ["zendesk_ticket_reply", "Reply to a Zendesk support ticket."],
  ["linear_issue_create", "Create a Linear issue."], ["notion_page_append", "Append a block to a Notion page."],
  ["figma_file_export", "Export a Figma file to an image."], ["sentry_issue_resolve", "Mark a Sentry issue as resolved."],
  ["airflow_dag_trigger", "Trigger an Airflow DAG run."], ["vault_secret_read", "Read a secret from HashiCorp Vault."],
]
const wideTools = () => [
  defineTool({ name: "metrics_fetch", description: "Fetch a named operational metric value from the metrics store.",
    input: Schema.Struct({ metric: Schema.String }), handler: async (a) => `metric ${a.metric} = ${SENTINEL}`, timeoutMs: 5_000 }),
  defineTool({ name: "report_file", description: "File a written report with a body of text. Returns a report id.",
    input: Schema.Struct({ body: Schema.String }), handler: async (a) => `report filed (id RPT-41, ${a.body.length} chars)`, timeoutMs: 5_000 }),
  ...DISTRACTORS.map(([name, description]) => defineTool({ name, description,
    input: Schema.Struct({ arg: Schema.optional(Schema.String) }), handler: async () => `${name}: not applicable to this task`, timeoutMs: 5_000 })),
]

// ── task 2: umami-explore (open-ended; Cortex run 01M73FK911EPZWMJAGSFZ7FPNB shape) ──
const SITE = { id: "a1f3-docs", name: "docs.example.dev" }
const umamiTools = () => {
  const s = (name: string, description: string, fields: Record<string, Schema.Schema.Any>, handler: (a: Record<string, unknown>) => string) =>
    defineTool({ name: `umami_${name}`, description, input: Schema.Struct(fields as never) as never, handler: async (a: Record<string, unknown>) => handler(a), timeoutMs: 5_000 })
  const opt = Schema.optional(Schema.String)
  return [
    s("get_websites", "List websites tracked in Umami.", {}, () => JSON.stringify([{ id: SITE.id, name: SITE.name }, { id: "b7c2-blog", name: "blog.example.dev" }])),
    s("get_website", "Get one website's settings by websiteId.", { websiteId: Schema.String }, (a) => JSON.stringify({ id: a.websiteId, domain: SITE.name, createdAt: "2025-02-01" })),
    s("get_website_stats", "Get summary stats (pageviews, visitors, visits, bounces, totaltime) for a website over a date range.", { websiteId: Schema.String, startAt: opt, endAt: opt },
      () => JSON.stringify({ pageviews: 12480, visitors: 3912, visits: 5207, bounces: 2290, totaltime: 611400 })),
    s("get_pageviews", "Get pageviews and sessions time series for a website.", { websiteId: Schema.String, unit: opt },
      () => JSON.stringify({ pageviews: [{ x: "2026-11-03", y: 1610 }, { x: "2026-11-04", y: 1904 }, { x: "2026-11-05", y: 2011 }], sessions: [{ x: "2026-11-03", y: 690 }] })),
    s("get_metrics", "Get ranked metrics for a website. type is one of url, referrer, browser, os, device, country, event.", { websiteId: Schema.String, type: Schema.String },
      (a) => {
        const t = String(a.type)
        if (t === "url") return JSON.stringify([{ x: "/docs/getting-started", y: 3120 }, { x: "/docs/api", y: 1980 }, { x: "/", y: 1410 }])
        if (t === "referrer") return JSON.stringify([{ x: "github.com", y: 1604 }, { x: "google.com", y: 1188 }, { x: "news.ycombinator.com", y: 402 }])
        if (t === "country") return JSON.stringify([{ x: "US", y: 1420 }, { x: "DE", y: 611 }])
        return JSON.stringify([{ x: "other", y: 10 }])
      }),
    s("get_active", "Get the number of active visitors right now.", { websiteId: Schema.String }, () => JSON.stringify({ x: 7 })),
    s("get_events", "List custom events for a website.", { websiteId: Schema.String }, () => JSON.stringify([{ eventName: "copy-snippet", count: 512 }])),
    s("get_sessions", "List recent sessions for a website.", { websiteId: Schema.String }, () => JSON.stringify([{ id: "s1", country: "US", browser: "firefox" }])),
    s("get_realtime", "Realtime pageview stream for the last 30 minutes.", { websiteId: Schema.String }, () => JSON.stringify({ pageviews: 21 })),
    s("get_reports", "List saved reports.", { websiteId: opt }, () => JSON.stringify([])),
    s("create_report", "Create a saved report.", { websiteId: Schema.String, name: Schema.String }, () => "created report r-1"),
    s("get_teams", "List teams.", {}, () => JSON.stringify([{ id: "t1", name: "docs" }])),
    s("get_users", "List users.", {}, () => JSON.stringify([{ id: "u1", username: "admin" }])),
    s("create_website", "Add a website to track.", { name: Schema.String, domain: Schema.String }, () => "created"),
    s("update_website", "Update website settings.", { websiteId: Schema.String, name: opt }, () => "updated"),
    s("delete_website", "Delete a website.", { websiteId: Schema.String }, () => "refused: read-only demo"),
    s("reset_website", "Reset a website's data.", { websiteId: Schema.String }, () => "refused: read-only demo"),
    s("get_share_url", "Get a public share URL for a website.", { websiteId: Schema.String }, () => "https://umami.example.dev/share/abc"),
    s("get_event_data", "Get properties of a custom event.", { websiteId: Schema.String, eventName: opt }, () => JSON.stringify({ language: { ts: 300, py: 212 } })),
    s("get_utm", "UTM campaign breakdown.", { websiteId: Schema.String }, () => JSON.stringify([])),
  ]
}
interface TaskDef { id: string; prompt: string; tools: () => ReturnType<typeof defineTool>[]; maxIter: number; score: (out: string, called: Set<string>) => number }
const TASKS: TaskDef[] = [
  { id: "wide-metric", maxIter: 12,
    prompt: "Fetch the current metric named 'latency_p99' using the metrics tool, then file a report containing that exact value using the report tool. Your final answer MUST state the metric value.",
    tools: wideTools as never,
    score: (out, called) => ((out.includes(SENTINEL) ? 1 : 0) + (called.has("metrics_fetch") ? 1 : 0) + (called.has("report_file") ? 1 : 0)) / 3 },
  { id: "umami-explore", maxIter: 10,
    prompt: "Help me explore analytics for my docs site in umami.",
    tools: umamiTools as never,
    score: (out) => [/12[,.\s]?480/, /getting-started/i, /github/i].filter((r) => r.test(out)).length / 3 },
]

if (tier.provider === "ollama") await primeCapability("ollama", tier.model)

const gitSha = (): string => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() } catch { return "unknown" } }
const outFile = join(outDir, `${arm}-wide-${tierLabel.replace(/[^\w.-]/g, "_")}.json`)
const load = () => existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { suite: "wide", gitSha: gitSha(), cells: [] as unknown[] }
const persist = (r: unknown) => { mkdirSync(outDir, { recursive: true }); writeFileSync(`${outFile}.tmp`, JSON.stringify(r, null, 2)); renameSync(`${outFile}.tmp`, outFile) }

for (const run of runs) for (const task of TASKS.filter((t) => taskFilter.includes(t.id))) {
  const res = load()
  const cellId = `${tierLabel}|${task.id}|${run}`
  if ((res.cells as Array<{ cellId: string }>).some((c) => c.cellId === cellId)) continue
  const traceDir = join(outDir, `traces-${arm}-wide`, tierLabel.replace(/[^\w.-]/g, "_"), task.id, `run${run}`)
  mkdirSync(traceDir, { recursive: true })
  const t0 = Date.now()
  let output = "", status = "error", err: string | undefined
  let agent: { run: (t: string) => Promise<{ output?: unknown; success?: boolean }>; dispose: () => Promise<void> } | undefined
  try {
    agent = await ReactiveAgents.create()
      .withName(`abl-${task.id}`)
      .withProvider(tier.provider)
      .withModel(numCtx !== undefined ? { model: tier.model, numCtx } : tier.model)
      .withMaxIterations(task.maxIter)
      .withTools({ tools: task.tools() } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withTracing({ dir: traceDir })
      .build() as never
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cell-timeout")), cellTimeoutSec * 1000))
    const r = await Promise.race([agent!.run(task.prompt), timer])
    output = String(r.output ?? "")
    status = r.success ? "pass" : "fail"
  } catch (e) { err = e instanceof Error ? e.message : String(e); status = err === "cell-timeout" ? "timeout" : "error" }
  finally { try { await agent?.dispose() } catch { /* ignore */ } }
  const traceFile = readdirSync(traceDir).filter((f) => f.endsWith(".jsonl")).map((f) => join(traceDir, f))[0] ?? null
  const called = new Set<string>()
  let tokens = 0, iterations = 0, terminatedBy: string | null = null, runStatus: string | null = null, authority: string | null = null
  if (traceFile) for (const l of readFileSync(traceFile, "utf8").split("\n")) {
    if (!l) continue
    const e = JSON.parse(l) as Record<string, unknown>
    if (e.kind === "tool-call-end" && typeof e.toolName === "string") called.add(e.toolName)
    if (e.kind === "llm-exchange") { const r = e.response as Record<string, number> | undefined; tokens += (r?.tokensIn ?? 0) + (r?.tokensOut ?? 0) }
    if (typeof e.iter === "number") iterations = Math.max(iterations, e.iter)
    if (e.kind === "run-completed") {
      terminatedBy = typeof e.terminatedBy === "string" ? e.terminatedBy : null
      runStatus = typeof e.status === "string" ? e.status : null
      const o = e.outcome as Record<string, unknown> | undefined
      authority = typeof o?.authority === "string" ? o.authority : null
    }
  }
  // Scored on the output the CALLER received (r.output), never the trace's copy.
  // A timed-out cell is inconclusive (same rule as the H3 runner).
  const measured = status !== "error" && status !== "timeout"
  const acc = measured ? task.score(output, called) : null
  const cell = { cellId, taskId: task.id, variant: arm, tier: tierLabel, run, accuracy: acc, solved: acc === 1, status, inconclusive: !measured,
    tokens, billedTokens: null, durationMs: Date.now() - t0, iterations, terminatedBy, runStatus, authority, traceFile, toolsCalled: [...called], output: output.slice(0, 4000), ...(err ? { error: err } : {}) }
  persist({ ...res, cells: [...res.cells, cell] })
  console.error(`[arm] ${arm} ${cellId} acc=${acc === null ? "-" : acc.toFixed(2)} ${status} it=${iterations} ${tokens}tok ${(cell.durationMs / 1000).toFixed(0)}s term=${terminatedBy} auth=${authority} called=${[...called].join(",")}${err ? ` err=${err.slice(0, 120)}` : ""}`)
}
process.exit(0)
