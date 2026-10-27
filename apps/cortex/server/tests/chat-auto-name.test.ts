import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { cleanChatTitle, fallbackChatTitle } from "../services/chat-title.js";

function setup(title: () => Promise<string>) {
  const path = `/tmp/cortex-autoname-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db, { title });
  return { db, svc, cleanup: () => (db.close(), rmSync(path, { force: true })) };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const cfg = { provider: "test", model: "test-model" };

describe("chat auto-naming", () => {
  it("helpers: clip at a word, clean model output", () => {
    expect(fallbackChatTitle("  what   is the price of xrp?  ")).toBe("what is the price of xrp?");
    expect(fallbackChatTitle("word ".repeat(30)).endsWith("…")).toBe(true);
    expect(cleanChatTitle('Title: "XRP Price Lookup."\nextra')).toBe("XRP Price Lookup");
  });

  it("names a fresh chat instantly, then upgrades to the model title", async () => {
    const { svc, db, cleanup } = setup(async () => '"Crypto Price Check"');
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      (svc as unknown as { persistTurn: (...a: unknown[]) => void }).persistTurn(id, "find the price of XRP", "It is $1.32", 5, undefined);
      expect(getChatSession(db, id)!.name).toBe("find the price of XRP");
      await tick();
      expect(getChatSession(db, id)!.name).toBe("Crypto Price Check");
    } finally {
      cleanup();
    }
  });

  it("autoName:false and user-chosen names are left alone; a rename during titling wins", async () => {
    const { svc, db, cleanup } = setup(async () => {
      await tick();
      return "Model Title";
    });
    try {
      const persist = (id: string, msg: string) =>
        (svc as unknown as { persistTurn: (...a: unknown[]) => void }).persistTurn(id, msg, "r", 1, undefined);
      const off = await svc.createSession({ agentConfig: { ...cfg, autoName: false } });
      persist(off, "hello there");
      const named = await svc.createSession({ agentConfig: cfg, name: "My chat" });
      persist(named, "hello there");
      const racing = await svc.createSession({ agentConfig: cfg });
      persist(racing, "hello there");
      await svc.renameSession(racing, "Mine");
      await new Promise((r) => setTimeout(r, 80));
      expect(getChatSession(db, off)!.name).toBe("New Chat");
      expect(getChatSession(db, named)!.name).toBe("My chat");
      expect(getChatSession(db, racing)!.name).toBe("Mine");
    } finally {
      cleanup();
    }
  });

  it("normalize keeps only the opt-out", async () => {
    const { normalizeCortexAgentConfig } = await import("../services/cortex-agent-config.js");
    expect(normalizeCortexAgentConfig({ provider: "test", autoName: false }).autoName).toBe(false);
    expect("autoName" in normalizeCortexAgentConfig({ provider: "test", autoName: true })).toBe(false);
  });
});
