import { describe, expect, it } from "bun:test";
import {
  accessModeOf,
  accessSentence,
  addSenders,
  normalizeSender,
  removeSender,
  senderProblem,
  setAllowEveryone,
  withAccess,
} from "./channel-access.js";

describe("accessModeOf (the framework's fail-closed rule)", () => {
  it("no gateway block, no access control, and an empty allowlist all deny everyone", () => {
    expect(accessModeOf(undefined)).toBe("deny-all");
    expect(accessModeOf({})).toBe("deny-all");
    expect(accessModeOf({ accessControl: { accessPolicy: "allowlist", allowedSenders: [] } })).toBe("deny-all");
  });
  it("an allowlist with entries is an allowlist; only open accepts anyone", () => {
    expect(accessModeOf({ accessControl: { allowedSenders: ["telegram:1"] } })).toBe("allowlist");
    expect(accessModeOf({ accessControl: { accessPolicy: "open" } })).toBe("open");
    expect(accessModeOf({ accessControl: { accessPolicy: "blocklist" } })).toBe("blocklist");
  });
});

describe("accessSentence", () => {
  it("says plainly that nobody can message a deny-all agent", () => {
    expect(accessSentence("deny-all")).toContain("Nobody can message");
  });
  it("warns that open means anyone", () => {
    expect(accessSentence("open")).toContain("Anyone who finds this channel");
  });
  it("counts senders", () => {
    expect(accessSentence("allowlist", 1)).toBe("1 sender may message this agent. Everyone else is ignored.");
    expect(accessSentence("allowlist", 3)).toContain("3 senders");
  });
});

describe("senderProblem / normalizeSender", () => {
  it("accepts platform:id entries", () => {
    expect(senderProblem("telegram:123456789")).toBeNull();
    expect(senderProblem("signal:+15551234567")).toBeNull();
    expect(senderProblem("webhook:user-42")).toBeNull();
  });
  it("refuses a bare id with the fix", () => {
    expect(senderProblem("+15551234567")).toContain("needs a platform prefix");
    expect(senderProblem("123456789")).toContain("telegram:123456789");
  });
  it("refuses an empty entry or a prefix with no id", () => {
    expect(senderProblem("  ")).toBe("Empty entry.");
    expect(senderProblem("telegram:")).not.toBeNull();
  });
  it("lowercases the platform and keeps the id as typed", () => {
    expect(normalizeSender(" Telegram:AbC ")).toBe("telegram:AbC");
  });
});

describe("addSenders", () => {
  it("adds several entries from commas, spaces and new lines", () => {
    const r = addSenders(undefined, "telegram:1, signal:+15551234567\ntelegram:2");
    expect(r.access.allowedSenders).toEqual(["telegram:1", "signal:+15551234567", "telegram:2"]);
    expect(r.added).toHaveLength(3);
    expect(r.rejected).toEqual([]);
  });
  it("skips duplicates silently and reports bad entries", () => {
    const r = addSenders({ allowedSenders: ["telegram:1"] }, "Telegram:1 +1555 telegram:2");
    expect(r.access.allowedSenders).toEqual(["telegram:1", "telegram:2"]);
    expect(r.added).toEqual(["telegram:2"]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]?.entry).toBe("+1555");
  });
  it("keeps the rest of the access control and can target the blocklist", () => {
    const r = addSenders({ accessPolicy: "blocklist", allowedSenders: ["telegram:1"] }, "telegram:9", "blockedSenders");
    expect(r.access).toEqual({ accessPolicy: "blocklist", allowedSenders: ["telegram:1"], blockedSenders: ["telegram:9"] });
  });
});

describe("removeSender / setAllowEveryone / withAccess", () => {
  it("removes one sender and drops an emptied list and an emptied block", () => {
    expect(removeSender({ allowedSenders: ["a:1", "b:2"] }, "a:1")).toEqual({ allowedSenders: ["b:2"] });
    expect(removeSender({ allowedSenders: ["a:1"] }, "a:1")).toBeUndefined();
    expect(removeSender({ accessPolicy: "open", allowedSenders: ["a:1"] }, "a:1")).toEqual({ accessPolicy: "open" });
  });
  it("allow everyone sets open and keeps the allowlist; turning it off restores the framework default", () => {
    const on = setAllowEveryone({ allowedSenders: ["a:1"] }, true);
    expect(on).toEqual({ allowedSenders: ["a:1"], accessPolicy: "open" });
    expect(setAllowEveryone(on, false)).toEqual({ allowedSenders: ["a:1"] });
    expect(setAllowEveryone(undefined, false)).toBeUndefined();
  });
  it("turning allow-everyone off does not touch a blocklist policy", () => {
    expect(setAllowEveryone({ accessPolicy: "blocklist" }, false)).toEqual({ accessPolicy: "blocklist" });
  });
  it("withAccess replaces the block's access control and drops an empty gateway block", () => {
    expect(withAccess({ queue: { capacity: 5 } }, { accessPolicy: "open" })).toEqual({ queue: { capacity: 5 }, accessControl: { accessPolicy: "open" } });
    expect(withAccess({ accessControl: { accessPolicy: "open" } }, undefined)).toBeUndefined();
    expect(withAccess({ accessControl: { accessPolicy: "open" }, queue: { capacity: 5 } }, undefined)).toEqual({ queue: { capacity: 5 } });
  });
});
