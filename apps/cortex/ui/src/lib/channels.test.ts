import { describe, expect, it } from "bun:test";
import {
  channelsSurface,
  addChannel,
  channelIssues,
  channelKindInfo,
  channelName,
  channelsOf,
  newChannel,
  newChannelId,
  removeChannel,
  updateChannel,
  webhookRoute,
} from "./channels.js";

describe("newChannelId", () => {
  it("is ch- plus 8 hex characters, and differs between calls", () => {
    const a = newChannelId();
    expect(a).toMatch(/^ch-[0-9a-f]{8}$/);
    expect(newChannelId()).not.toBe(a);
  });
  it("matches the server's id pattern", () => {
    expect(newChannelId(() => 0.999)).toMatch(/^[a-z0-9][a-z0-9-]{2,39}$/);
  });
});

describe("channel list edits", () => {
  const a = newChannel("telegram", "ch-aaaa1111");
  const b = newChannel("signal", "ch-bbbb2222");

  it("a new Signal channel defaults to the daemon socket; others start empty and enabled", () => {
    expect(b.settings).toEqual({ transport: "socket" });
    expect(a).toEqual({ id: "ch-aaaa1111", kind: "telegram", enabled: true, settings: {} });
  });
  it("adds and removes without mutating", () => {
    const list = addChannel([a], b);
    expect(list.map((c) => c.id)).toEqual(["ch-aaaa1111", "ch-bbbb2222"]);
    expect(removeChannel(list, "ch-aaaa1111").map((c) => c.id)).toEqual(["ch-bbbb2222"]);
    expect(list).toHaveLength(2);
  });
  it("updates label, enabled and settings; an empty value removes the key", () => {
    let list = updateChannel([b], "ch-bbbb2222", { label: " Family ", settings: { port: 7600, host: "10.0.0.5" } });
    expect(list[0]).toMatchObject({ label: "Family", settings: { transport: "socket", port: 7600, host: "10.0.0.5" } });
    list = updateChannel(list, "ch-bbbb2222", { label: "", enabled: false, settings: { host: "" } });
    expect(list[0]?.label).toBeUndefined();
    expect(list[0]?.enabled).toBe(false);
    expect(list[0]?.settings.host).toBeUndefined();
    expect(list[0]?.settings.port).toBe(7600);
  });
  it("channelsOf tolerates a missing or junk list", () => {
    expect(channelsOf({})).toEqual([]);
    expect(channelsOf({ channels: "x" })).toEqual([]);
    expect(channelsOf({ channels: [a, { id: "x", kind: "pigeon" }, null] })).toEqual([a]);
  });
  it("names a channel by label, else by kind", () => {
    expect(channelName(a)).toBe("Telegram");
    expect(channelName({ ...a, label: "Support bot" })).toBe("Support bot");
  });
});

describe("channelIssues", () => {
  it("a Telegram channel needs its token", () => {
    const c = newChannel("telegram", "ch-aaaa1111");
    expect(channelIssues(c, false)).toEqual(["No bot token saved."]);
    expect(channelIssues(c, true)).toEqual([]);
  });
  it("a webhook needs a listen port, a sane reply URL and its secret", () => {
    const c = newChannel("webhook", "ch-cccc3333");
    expect(channelIssues(c, true)).toEqual(["Set the port the webhook listens on."]);
    expect(channelIssues({ ...c, settings: { ingressPort: 7700, replyUrl: "ftp://x" } }, true)).toEqual(["The reply URL must start with http:// or https://."]);
    expect(channelIssues({ ...c, settings: { ingressPort: 7700 } }, false)).toEqual(["No signing secret saved."]);
    expect(channelIssues({ ...c, settings: { ingressPort: 70000 } }, true)).toEqual(["The listen port must be between 1 and 65535."]);
  });
  it("a Signal port out of range is flagged", () => {
    const c = { ...newChannel("signal", "ch-bbbb2222"), settings: { port: 0 } };
    expect(channelIssues(c, true)).toEqual(["The port must be between 1 and 65535."]);
  });
});

describe("kind info and routes", () => {
  it("each kind names its single credential field", () => {
    expect(channelKindInfo("telegram").credential.field).toBe("token");
    expect(channelKindInfo("signal").credential.field).toBe("account");
    expect(channelKindInfo("webhook").credential.field).toBe("secret");
  });
  it("a webhook's route defaults to /channels/<id>", () => {
    expect(webhookRoute(newChannel("webhook", "ch-cccc3333"))).toBe("/channels/ch-cccc3333");
    expect(webhookRoute({ ...newChannel("webhook", "ch-cccc3333"), settings: { route: "/in" } })).toBe("/in");
  });
});

describe("channelsSurface", () => {
  it("the Lab builder edits channels", () => {
    expect(channelsSurface(false)).toEqual({ editable: true, note: null });
  });
  it("a chat session does not, and says why", () => {
    const s = channelsSurface(true);
    expect(s.editable).toBe(false);
    expect(s.note).toContain("saved Gateway agent");
  });
});
