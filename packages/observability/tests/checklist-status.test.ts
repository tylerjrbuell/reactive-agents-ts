import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { PassThrough } from "node:stream";
import { projectChecklist, type ChecklistFact, type AgentEvent } from "@reactive-agents/core";
import { formatChecklistSuffix, newlyFinished } from "../src/logging/checklist-status";
import { makeStatusRenderer, type EbLike } from "../src/logging/status-renderer";
import { makeObservableLogger } from "../src/logging/observable-logger";

const req = (seq: number, id: string, status: "declared" | "satisfied" | "blocked", description?: string): ChecklistFact =>
  ({ kind: "requirement", seq, iteration: 0, requirementId: id, status, ...(description ? { description } : {}) });
const add = (seq: number, ...titles: string[]): ChecklistFact =>
  ({ kind: "checklist-item", seq, iteration: 1, change: { op: "add", items: titles.map((t, i) => ({ id: String(i + 1), title: t })) } });
const setStatus = (seq: number, id: string, status: "in_progress" | "completed"): ChecklistFact =>
  ({ kind: "checklist-item", seq, iteration: 1, change: { op: "status", id, status } });

describe("formatChecklistSuffix", () => {
  const snap = projectChecklist([
    req(0, "r1", "declared", "A"), req(1, "r2", "declared", "B"), req(2, "r1", "satisfied"),
    add(3, "first long advisory title", "b", "c", "d", "e"),
    setStatus(4, "1", "completed"), setStatus(5, "2", "completed"), setStatus(6, "3", "completed"),
    setStatus(7, "4", "in_progress"),
  ]);

  test("never exceeds maxWidth for widths 10-80", () => {
    for (let w = 10; w <= 80; w++) expect(formatChecklistSuffix(snap, w).length).toBeLessThanOrEqual(w);
  });

  test("requirement progress precedes advisory", () => {
    const s = formatChecklistSuffix(snap, 80);
    expect(s.startsWith("☑ 1/2")).toBe(true);
    expect(s).toContain("todo 3/5");
    expect(s.indexOf("☑")).toBeLessThan(s.indexOf("todo"));
    expect(s).toContain("· d");
  });

  test("shows N agents while children live", () => {
    const withKids = projectChecklist([req(0, "r1", "declared", "A")], new Map([
      ["sub-agent:a", [req(0, "x", "declared", "X")]], ["sub-agent:b", [req(0, "y", "declared", "Y")]],
    ]));
    expect(formatChecklistSuffix(withKids, 80)).toBe("☑ 0/1 · 2 agents");
  });
});

describe("newlyFinished", () => {
  test("reports transitions only, with child owner", () => {
    const a = projectChecklist([req(0, "r1", "declared", "A")], new Map([["sub-agent:kid", [req(0, "x", "declared", "X")]]]));
    const b = projectChecklist([req(0, "r1", "declared", "A"), req(1, "r1", "satisfied")], new Map([["sub-agent:kid", [req(0, "x", "declared", "X")]]]));
    const c = projectChecklist([req(0, "r1", "declared", "A"), req(1, "r1", "satisfied")], new Map([["sub-agent:kid", [req(0, "x", "declared", "X"), req(1, "x", "blocked")]]]));
    expect(newlyFinished(undefined, a)).toEqual([]);
    expect(newlyFinished(a, b).map((f) => [f.owner, f.row.title])).toEqual([[undefined, "A"]]);
    expect(newlyFinished(b, b)).toEqual([]);
    expect(newlyFinished(b, c).map((f) => [f.owner, f.row.status])).toEqual([["kid", "blocked"]]);
  });
});

describe("status renderer checklist", () => {
  type Handler = (event: never) => Effect.Effect<void, never>;
  function setup(opts?: { rootTaskId?: string; checklist?: boolean }) {
    const handlers = new Map<string, Handler>();
    const eb: EbLike = { on: (tag, h) => Effect.sync(() => { handlers.set(tag, h); return () => {}; }) };
    const out = new PassThrough() as unknown as NodeJS.WriteStream;
    out.isTTY = true;
    let written = "";
    out.on("data", (c) => { written += c.toString(); });
    const fire = (event: AgentEvent): void => {
      const h = handlers.get(event._tag);
      if (h) Effect.runSync((h as (e: AgentEvent) => Effect.Effect<void, never>)(event));
    };
    return { eb, out, fire, text: () => written, opts };
  }
  const ledger = (taskId: string, entries: readonly ChecklistFact[], restored?: boolean): AgentEvent =>
    ({ _tag: "LedgerEntryAppended", taskId, entries, ...(restored ? { restored } : {}) } as unknown as AgentEvent);

  async function run(
    opts: { rootTaskId?: string; checklist?: boolean } | undefined,
    drive: (fire: (e: AgentEvent) => void) => void,
  ): Promise<string> {
    const t = setup(opts);
    await Effect.runPromise(Effect.gen(function* () {
      const logger = yield* makeObservableLogger({ live: false });
      const r = makeStatusRenderer(logger, t.out, t.eb, opts);
      yield* r.start();
      drive(t.fire);
      r.stop();
    }));
    // eslint-disable-next-line no-control-regex
    return t.text().replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  }

  test("prints finished requirement once; sub-agent batch with other taskId is ignored", async () => {
    const text = await run({ rootTaskId: "root" }, (fire) => {
      fire(ledger("root", [req(0, "r1", "declared", "Answer it")]));
      fire(ledger("stranger", [req(0, "z", "declared", "Zed"), req(1, "z", "satisfied")]));
      fire(ledger("root", [req(1, "r1", "satisfied")]));
      fire(ledger("root", []));
    });
    expect(text.match(/✓ Answer it/g)?.length).toBe(1);
    expect(text).not.toContain("Zed");
  });

  test("advisory uses ·✓, blocked uses !, child rows carry child name", async () => {
    const text = await run({ rootTaskId: "root" }, (fire) => {
      fire(ledger("root", [add(0, "do thing"), setStatus(1, "1", "completed")]));
      fire({ _tag: "AgentStarted", taskId: "c1", agentId: "a2", rootRunId: "root", parentRunId: "root", parentAgentId: "a1", agentDisplayName: "kid" } as unknown as AgentEvent);
      fire(ledger("c1", [req(0, "x", "declared", "Child req"), req(1, "x", "blocked")]));
    });
    expect(text).toContain("·✓ do thing");
    expect(text).toMatch(/! .*kid.*Child req|! .*Child req/);
    expect(text).toContain("kid");
  });

  test("checklist:false and absent rootTaskId print nothing", async () => {
    const drive = (fire: (e: AgentEvent) => void): void => {
      fire(ledger("root", [req(0, "r1", "declared", "Answer it"), req(1, "r1", "satisfied")]));
    };
    expect(await run({ rootTaskId: "root", checklist: false }, drive)).not.toContain("Answer it");
    expect(await run(undefined, drive)).not.toContain("Answer it");
  });

  test("status line carries the suffix when enabled", async () => {
    const text = await run({ rootTaskId: "root" }, (fire) => {
      fire(ledger("root", [req(0, "r1", "declared", "Answer it")]));
    });
    expect(text).toContain("☑ 0/1");
  });
});
