import { describe, expect, test } from "bun:test";
import { asidesFor, btwSnapshot, createBtwStore } from "./chat-btw.js";
import type { ChatTurn } from "./chat-store.js";

const turns: ChatTurn[] = [
  { id: 1, role: "user", content: "task", tokensUsed: 0, ts: 0 },
  { id: 2, role: "assistant", content: "", tokensUsed: 0, ts: 0, streaming: true, liveText: "draft" },
];

describe("btw store", () => {
  test("an aside is pending while the call runs, then answered; the turns are never touched", async () => {
    let release: (v: { answer: string }) => void = () => {};
    const sent: unknown[] = [];
    const store = createBtwStore(async (sid, q, ctx) => {
      sent.push([sid, q, ctx?.running]);
      return new Promise((r) => (release = r));
    });
    const before = JSON.stringify(turns);
    const done = store.ask("s1", "why?", turns);
    expect(btwSnapshot(store)).toMatchObject([{ sessionId: "s1", question: "why?", whileRunning: true, status: "pending" }]);
    release({ answer: "Because." });
    await done;
    expect(btwSnapshot(store)).toMatchObject([{ status: "answered", answer: "Because.", whileRunning: true }]);
    expect(sent).toEqual([["s1", "why?", true]]);
    expect(JSON.stringify(turns)).toBe(before);
  });

  test("a failure is recorded on the aside, and asides are per chat and dismissable", async () => {
    const store = createBtwStore(async () => ({ error: "offline" }));
    await store.ask("s1", "a", turns);
    await store.ask("s2", "b", []);
    const all = btwSnapshot(store);
    expect(all[0]).toMatchObject({ status: "failed", error: "offline" });
    expect(all[1]).toMatchObject({ whileRunning: false });
    expect(asidesFor(all, "s1").map((a) => a.question)).toEqual(["a"]);
    store.dismiss(all[0]!.id);
    expect(btwSnapshot(store).map((a) => a.question)).toEqual(["b"]);
  });
});
