/**
 * Seam pin: the gateway chat history holds only delivered replies.
 *
 * A failed run's text (its reasoning, an abstention note, an error string) used to be stored as the
 * assistant turn and fed into every later run (2026-11-12 Telegram trace diagnosis, gap G4). A turn
 * whose run fails stores nothing; the next run's instruction carries no trace of it.
 */
import { describe, it, expect } from "bun:test";
import { GatewayChatManager, type GatewayChatManagerDeps } from "../src/gateway-context-formatting.js";

const THINKING = "Hmm. Maybe there is a hidden tool. Let me recall the telegram channel tool.";

const make = (outputs: ReadonlyArray<string | undefined | Error>) => {
  const instructions: string[] = [];
  const episodes: string[] = [];
  let saves = 0;
  let i = 0;
  const deps: GatewayChatManagerDeps = {
    agentId: "t",
    sessionTtlDays: 30,
    executeEvent: async (_e, _s, instruction) => {
      instructions.push(instruction);
      const next = outputs[i++];
      if (typeof next === "object") throw next;
      return next;
    },
    logEpisode: async (e) => { episodes.push(e.content); },
    saveSession: async () => { saves++; },
    findById: async () => null,
    getRecentEpisodes: async () => [],
    cleanup: async () => 0,
  };
  return { mgr: new GatewayChatManager(deps), instructions, episodes, saves: () => saves };
};

describe("GatewayChatManager history hygiene", () => {
  it("a failed run (executeEvent -> undefined) stores no turn and the next run never sees its text", async () => {
    const { mgr, instructions, episodes, saves } = make([undefined, "Hi! How can I help?"]);
    await mgr.handleMessage("u1", "/start", "telegram", "ch-x", {}, true);
    expect(await mgr.getOrLoadHistory("u1")).toEqual([]);
    expect(episodes).toEqual([]);
    expect(saves()).toBe(0);

    await mgr.handleMessage("u1", "Hello", "telegram", "ch-x", {}, true);
    expect(instructions[1]).not.toContain("Conversation history");
    expect(instructions[1]).not.toContain("/start");
    expect(instructions[1]).not.toContain(THINKING);
    const history = await mgr.getOrLoadHistory("u1");
    expect(history.map((m) => [m.role, m.content])).toEqual([["user", "Hello"], ["assistant", "Hi! How can I help?"]]);
  });

  it("a rejecting executeEvent stores no error string as an assistant turn", async () => {
    const { mgr } = make([new Error("Signal unavailable")]);
    await mgr.handleMessage("u1", "hi", "telegram", "ch-x", {}, true);
    expect(await mgr.getOrLoadHistory("u1")).toEqual([]);
  });

  it("an empty reply is not stored", async () => {
    const { mgr } = make(["   "]);
    await mgr.handleMessage("u1", "hi", "telegram", "ch-x", {}, true);
    expect(await mgr.getOrLoadHistory("u1")).toEqual([]);
  });

  it("a native-adapter turn's instruction carries no MCP send-tool demand", async () => {
    const { mgr, instructions } = make(["ok"]);
    await mgr.handleMessage("u1", "hi", "telegram", "ch-x", {}, true);
    expect(instructions[0]).toContain("User: hi");
    expect(instructions[0]).not.toContain("You MUST deliver your reply");
  });
});
