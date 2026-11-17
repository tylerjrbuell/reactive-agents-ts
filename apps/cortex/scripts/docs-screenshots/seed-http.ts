/**
 * Seeds the running demo Cortex through its HTTP API: MCP servers (two connect, one fails) and the
 * channels hub. Runs after the server is up; the chat states are seeded before it (seed.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (!process.env.DEMO_DIR) throw new Error("DEMO_DIR is required");
const demoDir = resolve(process.env.DEMO_DIR);
const base = `http://127.0.0.1:${process.env.DEMO_PORT ?? "4399"}`;
const out: Record<string, string> = {};

// 3. Tools Lab: two MCP servers that connect (a local fake over stdio) and one that fails.
const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
};
mkdirSync(join(demoDir, "mcp"), { recursive: true });
const fakeSource = await Bun.file(new URL("./fake-mcp.ts", import.meta.url)).text();
writeFileSync(join(demoDir, "mcp", "mcp-server.ts"), fakeSource);
const mcp = [
  { name: "docs", transport: "stdio", command: "bun", args: [join(demoDir, "mcp", "mcp-server.ts"), "docs"] },
  { name: "issues", transport: "stdio", command: "bun", args: [join(demoDir, "mcp", "mcp-server.ts"), "issues"] },
  { name: "billing", transport: "stdio", command: "bun", args: [join(demoDir, "mcp", "mcp-server.ts"), "fail"] },
];
for (const cfg of mcp) {
  const created = await api("POST", "/api/mcp-servers", cfg);
  const serverId = String(created.json["serverId"]);
  const refreshed = await api("POST", `/api/mcp-servers/${serverId}/refresh-tools`);
  out[`mcp:${cfg.name}`] = String(refreshed.status);
}

// 4. Channels hub: three channels, saved agent, routes. No credentials, no network.
const agent = await api("POST", "/api/agents", { name: "Support agent", type: "ad-hoc", config: { provider: "test", model: "demo-model" } });
const agentId = String(agent.json["agentId"]);
// Telegram and Signal are saved switched off: they would need a real token or account and a network call.
// The webhook channel needs neither (a generated signing secret, inbound only), so the hub itself runs.
const channels = [
  { kind: "webhook", label: "Deploy hook", enabled: true, settings: { ingressPort: 4401, route: "/hooks/deploy" } },
  { kind: "telegram", label: "Support (Telegram)", enabled: false },
  { kind: "signal", label: "On-call (Signal)", enabled: false },
] as const;
for (const c of channels) {
  const made = await api("POST", "/api/channels", c);
  const channelId = String(made.json["id"]);
  if (c.kind === "webhook") await api("POST", `/api/channels/${channelId}/webhook-secret`);
  const route = await api("POST", "/api/channels/routes", {
    route: { id: `route-${c.kind}`, match: { channelId }, target: { agentId } },
  });
  out[`channel:${c.kind}`] = `${made.status}/${route.status}`;
}

console.log(JSON.stringify(out, null, 2));
