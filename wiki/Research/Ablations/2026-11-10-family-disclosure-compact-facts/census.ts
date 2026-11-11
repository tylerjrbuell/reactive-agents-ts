// Zero-token trigger census: on which tool sets / task prompts do (4) namedToolFamily and
// (5) callConstraintNote change anything? Runs the frozen tree's own functions (per arm).
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts census.ts
import { builtinTools } from "@reactive-agents/tools"
import { H3_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/tasks.ts"
import { namedToolFamily, callConstraintNote, formatToolSchemaCompact, type ToolSchema } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts"

const builtins: ToolSchema[] = builtinTools.map((b) => ({ name: b.definition.name, description: b.definition.description, parameters: b.definition.parameters }) as ToolSchema)
console.log("== (5) callConstraintNote over builtins (non-empty only)")
for (const s of builtins) { const n = callConstraintNote(s); if (n) console.log(`  ${s.name}: ${n}`) }
const enums = builtins.flatMap((s) => s.parameters.filter((p) => p.enum?.length).map((p) => `${s.name}.${p.name}=${p.enum!.join("|")}`))
console.log(`== (5) builtin enum params (compact render changes): ${enums.join(", ") || "none"}`)

const umamiMetrics = { name: "umami_get_metrics", description: "Get ranked metrics for a website. type is one of url, referrer, browser, os, device, country, event.",
  parameters: [{ name: "websiteId", type: "string", required: true, description: "" }, { name: "type", type: "string", required: true, description: "" }] } as unknown as ToolSchema
console.log(`== (5) umami_get_metrics compact: ${formatToolSchemaCompact(umamiMetrics)}`)

console.log("== (4) namedToolFamily over H3 task prompts x builtins")
for (const t of H3_TASKS) { const f = namedToolFamily(String((t as { prompt?: string }).prompt ?? ""), builtins); console.log(`  ${t.id}: ${f.length}`) }
const umamiNames = ["get_websites","get_website","get_website_stats","get_pageviews","get_metrics","get_active","get_events","get_sessions","get_realtime","get_reports","create_report","get_teams","get_users","create_website","update_website","delete_website","reset_website","get_share_url","get_event_data","get_utm"]
const umami = umamiNames.map((n) => ({ name: `umami_${n}`, description: n.replace(/_/g, " "), parameters: [] }) as unknown as ToolSchema)
const fam = namedToolFamily("Help me explore analytics for my docs site in umami.", umami)
console.log(`== (4) umami-explore: ${fam.length} tools: ${fam.map((s) => s.name).join(", ")}`)
const wideNames = ["metrics_fetch", "report_file", "jira_issue_create", "jira_issue_search", "slack_post_message", "slack_list_channels", "github_pr_open", "github_pr_review", "github_issue_close", "s3_object_put", "s3_object_get", "sql_query_run", "sql_schema_describe"]
const wf = namedToolFamily("Fetch the current metric named 'latency_p99' using the metrics tool, then file a report containing that exact value using the report tool. Your final answer MUST state the metric value.", wideNames.map((n) => ({ name: n, description: n, parameters: [] }) as unknown as ToolSchema))
console.log(`== (4) wide-metric: ${wf.length}`)
process.exit(0)
