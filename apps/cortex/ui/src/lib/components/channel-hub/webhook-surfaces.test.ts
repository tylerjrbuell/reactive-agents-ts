/**
 * Server-render pins: a webhook channel, route editor, route row and test panel show no messaging
 * wording and none of the conversation-only settings; a messaging channel still shows them.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";
import { MESSAGING_WORDS } from "../../messaging-words.js";
import type { HubChannelRow } from "../../channel-hub-api.js";
import type { HubRouteWire } from "../../channel-hub.js";

const parent = (f: string) => join(import.meta.dir, "..", f);
const here = (f: string) => join(import.meta.dir, f);
const text = (html: string): string => html.replace(/<!--[^]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** Visible words plus the attributes people read (placeholder, aria-label). */
const readable = (html: string): string => {
  const attrs = [...html.matchAll(/(?:placeholder|aria-label|title)="([^"]*)"/g)].map((m) => m[1] ?? "").join(" ");
  return `${text(html)} ${attrs}`;
};

const channel = (platform: "webhook" | "telegram"): HubChannelRow => ({ id: `ch-${platform}01`, platform, label: null, enabled: true, settings: platform === "webhook" ? { ingressPort: 7700 } : {}, migratedFrom: null, credentials: [] });
const agents = [{ agentId: "a1", name: "Telegram Agent" }];
const noop = () => {};
const editorProps = (platform: "webhook" | "telegram") => ({ channels: [channel(platform)], agents, initial: { channelId: `ch-${platform}01` }, onsaved: noop, onclose: noop });

describe("route editor", () => {
  test("webhook: no messaging word anywhere, no chat-only fields, no preselected agent", async () => {
    const html = await renderComponent(here("RouteEditor.svelte"), editorProps("webhook"));
    const words = readable(html);
    expect(words.match(MESSAGING_WORDS)?.[0]).toBeUndefined();
    expect(words).toContain("The webhook channel that receives the request.");
    expect(words).toContain("The saved agent that runs when it is called.");
    expect(words).toContain("deploy-hook");
    expect(words).toContain("Requests are authorised by the channel's signing secret.");
    expect(words).toContain("Runs per hour");
    expect(words).toContain("Run limit (seconds)");
    expect(words).not.toContain("Telegram Agent");
    for (const gone of ["Conversation", "Only when", "per sender", "Acknowledge", "Batch", "Owners"]) expect(words).not.toContain(gone);
  });

  test("telegram still shows the conversation settings", async () => {
    const words = readable(await renderComponent(here("RouteEditor.svelte"), editorProps("telegram")));
    for (const shown of ["Conversation", "Only when", "Turns per sender per hour", "Owners", "Memory between messages"]) expect(words).toContain(shown);
  });
});

describe("webhook channel card, route row and test panel", () => {
  test("the channel card has no messaging word and shows the connection panel", async () => {
    const entry = { id: "ch-webhook01", kind: "webhook", enabled: true, settings: { ingressPort: 7700 } };
    const html = await renderComponent(parent("channels/ChannelCard.svelte"), { channel: entry, onChange: noop, onRemove: noop });
    expect(readable(html).match(MESSAGING_WORDS)?.[0]).toBeUndefined();
    expect(html).toContain('data-testid="webhook-connection"');
  });

  test("Generate sits in the signing-secret row, before the connection help, and the port hint says there is no default", async () => {
    const entry = { id: "ch-webhook01", kind: "webhook", enabled: true, settings: {} };
    const html = await renderComponent(parent("channels/ChannelCard.svelte"), { channel: entry, onChange: noop, onRemove: noop });
    const words = text(html);
    const secretRow = words.indexOf("Signing secret");
    const generate = words.indexOf("Generate");
    const connect = words.indexOf("Connect a caller");
    expect(secretRow).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(secretRow);
    expect(generate).toBeLessThan(connect);
    expect(words).not.toContain("Generate secret");
    expect(words).toContain("Required, there is no default");
    expect(html).toContain('placeholder="e.g. 7700"');
  });

  test("the route row says signing secret, not talk or tools", async () => {
    const route: HubRouteWire = { id: "deploy-hook", match: { channelId: "ch-webhook01" }, target: { agentId: "a1" }, enabled: true };
    const html = await renderComponent(here("HubRoutes.svelte"), { routes: [route], channels: [channel("webhook")], agents: [{ agentId: "a1", name: "Deployer" }], live: null, onEdit: noop, onNew: noop, onChanged: noop });
    const words = readable(html);
    expect(words).toContain("Access: the signing secret");
    expect(words).toContain("every signed request");
    expect(words.match(MESSAGING_WORDS)?.[0]).toBeUndefined();
  });

  test("the test panel for a webhook is a signed request, not a message form", async () => {
    const html = await renderComponent(here("RouteTestPanel.svelte"), { channels: [channel("webhook")] });
    const words = readable(html);
    expect(words).toContain("Send test request");
    expect(words.match(MESSAGING_WORDS)?.[0]).toBeUndefined();
    expect(words).not.toContain("Sender");
  });
});
