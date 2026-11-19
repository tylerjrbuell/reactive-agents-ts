import { describe, expect, test } from "bun:test";
import { continuationLinks, continuedFromLink, continuedIntoWords, runLinkOf } from "./run-continuation.js";
import { shortRunId } from "./run-view.js";
import { hydrateTurn } from "./stores/chat-store.js";

const PARENT = "01J7ABCDEFGHJKMNPQRSTVWXYZ";
const CHILD = `${PARENT}-cont-1a2b3c4d`;

describe("run continuation links", () => {
  test("a run with no link yields nothing (older runs render as before)", () => {
    expect(continuedFromLink({})).toBeUndefined();
    expect(continuationLinks([{ runId: PARENT }], PARENT)).toEqual([]);
    expect(continuedIntoWords([])).toBeUndefined();
  });

  test("a continuation links to its parent's run view, and the parent to its continuations", () => {
    expect(continuedFromLink({ continuedFrom: PARENT })).toEqual({ runId: PARENT, href: `/run/${PARENT}`, short: "01J7ABCDEFGH" });
    const runs = [{ runId: PARENT }, { runId: CHILD, continuedFrom: PARENT }];
    const links = continuationLinks(runs, PARENT);
    expect(links.map((l) => l.runId)).toEqual([CHILD]);
    expect(continuedIntoWords(links)).toBe("continued as");
    expect(continuedIntoWords([runLinkOf("a"), runLinkOf("b")])).toBe("continued 2 times");
  });

  test("a continuation's short id differs from its parent's (the first 12 characters are shared)", () => {
    expect(shortRunId(PARENT)).toBe("01J7ABCDEFGH");
    expect(shortRunId(CHILD)).toBe("01J7ABCDEFGH-cont-1a2b");
    expect(shortRunId(`${CHILD}-cont-ffff0000`)).toBe("01J7ABCDEFGH-cont-ffff");
    expect(shortRunId("run-1")).toBe("run-1");
  });

  test("a stored continuing turn keeps its link through hydrate; a legacy turn has none", () => {
    const base = { id: 1, role: "assistant" as const, content: "x", tokensUsed: 0, ts: 1 };
    expect(hydrateTurn({ ...base, runId: CHILD, continuedFrom: PARENT }).continuedFrom).toBe(PARENT);
    expect("continuedFrom" in hydrateTurn({ ...base, runId: "old" })).toBe(false);
  });
});
