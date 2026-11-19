// A reloaded turn keeps its strategy card: the stored run rides the trace, hydrates onto the turn, and
// the card model shows it collapsed to its summary. A row without it (older turns) renders nothing, as before.
import { describe, expect, it } from "bun:test";
import { foldStrategyRun, initialStrategyRun, strategyRunForStorage, strategyStatusOf, strategyStepOf } from "@reactive-agents/ui-core";
import { strategyCardModel } from "../strategy-visuals/registry.js";
import { hydrateTurn } from "./chat-hydrate.js";
import type { ChatTurn } from "./chat-store.js";

const row = (over: Partial<ChatTurn> & { trace?: unknown }): ChatTurn & { trace?: never } =>
  ({ id: 1, role: "assistant", content: "done", ts: 10, ...over }) as ChatTurn & { trace?: never };

const stored = strategyRunForStorage(
  ["reflexion:generate", "reflexion:critique-1"].reduce(
    (s, p, i) => foldStrategyRun(s, strategyStepOf(p, i === 1 ? { accepted: true, critique: "fine" } : {})!),
    initialStrategyRun,
  ),
)!;

describe("hydrateTurn strategy run", () => {
  it("restores the stored run onto the turn", () => {
    const turn = hydrateTurn(row({ trace: { reasoningSteps: [], toolCalls: [], strategyRun: stored } }));
    expect(turn.strategyRun?.rows.map((r) => r.key)).toEqual(["generate", "critique-1"]);
    expect(turn.strategyRun?.ended).toBe(true);
  });

  it("a settled turn's card shows, collapsed, with a summary of how it ended", () => {
    const run = hydrateTurn(row({ trace: { reasoningSteps: [], toolCalls: [], strategyRun: stored } })).strategyRun;
    const card = strategyCardModel(run, { statusLine: run ? strategyStatusOf(run) : undefined, hasPlan: false });
    expect(card).toMatchObject({ show: true, title: "Reflexion", chip: "1 round, accepted", openByDefault: false });
  });

  it("an older row without a stored run renders no card", () => {
    const turn = hydrateTurn(row({ trace: { reasoningSteps: [], toolCalls: [] } }));
    expect(turn.strategyRun).toBeUndefined();
    expect(strategyCardModel(turn.strategyRun, { hasPlan: false }).show).toBe(false);
  });
});
