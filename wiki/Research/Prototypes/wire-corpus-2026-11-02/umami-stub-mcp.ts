/**
 * Umami-SHAPED stub MCP server (stdio). 24 tools, deterministic fixture data,
 * Umami-style descriptions/params (websiteId, startAt/endAt, unit, timezone, filters).
 * PROXY ONLY: real umami-mcp schemas were not fetched (needs remote credentials).
 * Schema verbosity is therefore an estimate of the real server, not a copy.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const S = { type: "string" } as const;
const N = { type: "number" } as const;
const wid = { type: "string", description: "Website ID (UUID) as returned by list_websites" };
const range = {
  startAt: { type: "number", description: "Start of the range as a Unix timestamp in milliseconds" },
  endAt: { type: "number", description: "End of the range as a Unix timestamp in milliseconds" },
};
const filters = {
  path: { type: "string", description: "Filter by page path, e.g. /pricing" },
  referrer: { type: "string", description: "Filter by referrer domain" },
  country: { type: "string", description: "Filter by ISO country code, e.g. US" },
  browser: { type: "string", description: "Filter by browser name" },
  os: { type: "string", description: "Filter by operating system" },
  device: { type: "string", description: "Filter by device type: desktop, laptop, tablet, mobile" },
};
const t = (name: string, description: string, props: Record<string, unknown>, required: string[]) => ({
  name, description, inputSchema: { type: "object", properties: props, required },
});
const TOOLS = [
  t("list_websites", "List all websites tracked by this Umami instance, with their IDs, names and domains.", { search: { ...S, description: "Optional text to filter website names" }, page: { ...N, description: "Page number (1-based)" }, pageSize: { ...N, description: "Results per page" } }, []),
  t("get_website", "Get details of a single website by ID, including name, domain, share ID and creation date.", { websiteId: wid }, ["websiteId"]),
  t("get_website_stats", "Get summary statistics for a website over a date range: pageviews, visitors, visits, bounces and total time, with comparison to the previous period.", { websiteId: wid, ...range, ...filters }, ["websiteId", "startAt", "endAt"]),
  t("get_website_pageviews", "Get pageview and session counts over time for a website, bucketed by the given unit.", { websiteId: wid, ...range, unit: { type: "string", enum: ["year", "month", "day", "hour"], description: "Time bucket unit" }, timezone: { ...S, description: "IANA timezone, e.g. America/New_York" }, ...filters }, ["websiteId", "startAt", "endAt", "unit", "timezone"]),
  t("get_website_metrics", "Get the top values for a metric type (path, referrer, browser, os, device, country, region, city, language, event, title) for a website over a date range.", { websiteId: wid, ...range, type: { type: "string", enum: ["path", "referrer", "browser", "os", "device", "country", "region", "city", "language", "event", "title"], description: "Metric type to aggregate" }, limit: { ...N, description: "Maximum rows to return" }, ...filters }, ["websiteId", "startAt", "endAt", "type"]),
  t("get_active_visitors", "Get the number of visitors on a website in the last 5 minutes.", { websiteId: wid }, ["websiteId"]),
  t("get_event_stats", "Get event counts over time for a website, bucketed by the given unit.", { websiteId: wid, ...range, unit: { type: "string", enum: ["year", "month", "day", "hour"], description: "Time bucket unit" }, timezone: { ...S, description: "IANA timezone" }, event: { ...S, description: "Optional event name to filter on" } }, ["websiteId", "startAt", "endAt", "unit", "timezone"]),
  t("list_events", "List raw events recorded for a website within a date range, newest first.", { websiteId: wid, ...range, search: { ...S, description: "Filter events by name" }, page: N, pageSize: N }, ["websiteId", "startAt", "endAt"]),
  t("get_event_data_fields", "List the custom event-data property names and types recorded for a website.", { websiteId: wid, ...range }, ["websiteId", "startAt", "endAt"]),
  t("get_event_data_values", "Get distinct values recorded for a custom event-data property.", { websiteId: wid, ...range, eventName: S, propertyName: S }, ["websiteId", "startAt", "endAt", "eventName", "propertyName"]),
  t("list_sessions", "List visitor sessions for a website in a date range, with browser, OS, device, country and visit counts.", { websiteId: wid, ...range, page: N, pageSize: N, ...filters }, ["websiteId", "startAt", "endAt"]),
  t("get_session", "Get one session by ID with its aggregated stats.", { websiteId: wid, sessionId: { ...S, description: "Session UUID" } }, ["websiteId", "sessionId"]),
  t("get_session_activity", "Get the chronological activity (pageviews and events) of a single session.", { websiteId: wid, sessionId: S, ...range }, ["websiteId", "sessionId", "startAt", "endAt"]),
  t("get_session_stats", "Get aggregate session statistics (visits, countries, devices) for a website.", { websiteId: wid, ...range, ...filters }, ["websiteId", "startAt", "endAt"]),
  t("get_weekly_sessions", "Get a 7x24 heatmap of session counts by weekday and hour for a website.", { websiteId: wid, ...range, timezone: S }, ["websiteId", "startAt", "endAt", "timezone"]),
  t("run_funnel", "Run a conversion funnel for a website: for each step, count visitors reaching it and the drop-off from the previous step.", { websiteId: wid, ...range, window: { ...N, description: "Conversion window in days" }, steps: { type: "array", description: "Ordered funnel steps", items: { type: "object", properties: { type: { type: "string", enum: ["path", "event"] }, value: { type: "string", description: "Path or event name" } }, required: ["type", "value"] } } }, ["websiteId", "startAt", "endAt", "window", "steps"]),
  t("run_retention", "Run a cohort retention report for a website for the given month.", { websiteId: wid, startDate: { ...S, description: "Cohort start date YYYY-MM-DD" }, endDate: { ...S, description: "Cohort end date YYYY-MM-DD" }, timezone: S }, ["websiteId", "startDate", "endDate", "timezone"]),
  t("run_goal", "Evaluate a goal (path or event) for a website: how many visitors completed it and the conversion rate.", { websiteId: wid, ...range, type: { type: "string", enum: ["path", "event"] }, value: S }, ["websiteId", "startAt", "endAt", "type", "value"]),
  t("run_insights", "Run a breakdown insights query: group metrics by one or more fields with filters.", { websiteId: wid, ...range, fields: { type: "array", items: { type: "string" }, description: "Fields to group by" }, filters: { type: "array", items: { type: "object", properties: { name: S, operator: S, value: S } } } }, ["websiteId", "startAt", "endAt", "fields"]),
  t("run_journey", "Compute the most common navigation paths (journeys) for a website.", { websiteId: wid, ...range, steps: { ...N, description: "Number of steps (3-7)" }, startStep: { ...S, description: "Optional starting path" } }, ["websiteId", "startAt", "endAt", "steps"]),
  t("run_utm_report", "Report UTM source, medium, campaign, content and term breakdowns for a website.", { websiteId: wid, ...range }, ["websiteId", "startAt", "endAt"]),
  t("run_revenue_report", "Report revenue by currency and event for a website.", { websiteId: wid, ...range, currency: { ...S, description: "ISO currency code, e.g. USD" } }, ["websiteId", "startAt", "endAt", "currency"]),
  t("list_reports", "List saved reports for a website (funnel, retention, goal, insights, journey, utm).", { websiteId: wid, type: S, page: N, pageSize: N }, ["websiteId"]),
  t("get_realtime", "Get realtime activity for a website: current visitors, recent pageviews, recent events, and top countries.", { websiteId: wid }, ["websiteId"]),
];

// deterministic fixtures
const SITES = [
  { id: "a1b2c3d4-0001", name: "reactive-agents docs", domain: "docs.reactiveagents.dev" },
  { id: "a1b2c3d4-0002", name: "reactive-agents landing", domain: "reactiveagents.dev" },
  { id: "a1b2c3d4-0003", name: "blog", domain: "blog.reactiveagents.dev" },
];
const data = (name: string, a: Record<string, unknown>): unknown => {
  const w = String(a.websiteId ?? "");
  const k = Number(w.slice(-1)) || 1;
  switch (name) {
    case "list_websites": return { data: SITES, count: SITES.length };
    case "get_website": return SITES.find((s) => s.id === w) ?? { error: "not found" };
    case "get_website_stats": return { pageviews: 1200 * k, visitors: 410 * k, visits: 530 * k, bounces: 180 * k, totaltime: 90000 * k };
    case "get_website_pageviews": return { pageviews: [{ x: "2026-10-30", y: 170 * k }, { x: "2026-10-31", y: 190 * k }, { x: "2026-11-01", y: 210 * k }], sessions: [{ x: "2026-10-30", y: 60 * k }, { x: "2026-10-31", y: 65 * k }, { x: "2026-11-01", y: 70 * k }] };
    case "get_website_metrics": return [{ x: "/docs/getting-started", y: 340 * k }, { x: "/", y: 290 * k }, { x: "/docs/reference/builder-api", y: 150 * k }, { x: "/pricing", y: 40 * k }];
    case "get_active_visitors": return { visitors: 3 * k };
    default: return { note: `stub data for ${name}`, websiteId: w, rows: [] };
  }
};
const server = new Server({ name: "umami", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: JSON.stringify(data(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>)) }],
}));
await server.connect(new StdioServerTransport());
