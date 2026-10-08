// Run: bun test apps/examples/src/demos/island-sim/decision/judgment.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeJudgmentDecisionMaker, makeCampJudgmentDecisionMaker, templateNarrative } from "./judgment.js";
import type { JudgmentAgentLike } from "./judgment.js";
import { makeScriptedDecisionMaker } from "./types.js";

const fakeAgent = (answers: Record<string, unknown>): JudgmentAgentLike => ({
  judge: async () => answers as Record<string, never>,
});

describe("judgment decision maker", () => {
  it("maps a choice answer to a Decision with the action and calibrated confidence", async () => {
    const world = makeFallbackWorld(55);
    const self = world.agents[0]!;
    const berry = world.resources.find((r) => r.kind === "berries" && r.quantity > 0)!;
    const camped = {
      ...world,
      agents: world.agents.map((a) => a.id === self.id ? { ...a, location: berry.tile } : a),
    };
    const agent = fakeAgent({
      action: { kind: "choice", value: "gather", confidence: 0.8, calibrated: true, probabilities: { gather: 0.8, move: 0.15, rest: 0.05 } },
      target: { kind: "choice", value: "berries", confidence: 0.9, calibrated: true, probabilities: { berries: 0.9 } },
      urgency: { kind: "score", value: 2.1, confidence: 0.6, calibrated: true, probabilities: {} },
    });
    const d = await makeJudgmentDecisionMaker(agent).decide({ world: camped, agentId: self.id, perception: perceive(camped, self.id) });
    expect(d.action.type).toBe("gather");
    expect(d.action.target).toBe(berry.id);
    expect(d.confidence).toBe(0.8);
    expect(d.calibrated).toBe(true);
  }, 15000);
  it("falls back to inspect when the model returns an out-of-vocabulary action", async () => {
    const w = makeFallbackWorld(55);
    const agent = fakeAgent({
      action: { kind: "choice", value: "teleport", confidence: 1, calibrated: true, probabilities: {} },
    });
    const d = await makeJudgmentDecisionMaker(agent).decide({ world: w, agentId: w.agents[0].id, perception: perceive(w, w.agents[0].id) });
    expect(d.action.type).toBe("inspect");
  }, 15000);
  it("resolves model-chosen names to engine ids so realtime judgments land", async () => {
    const w = makeFallbackWorld(55);
    const self = w.agents[0]!;
    const ally = w.agents[1]!;
    const agent = fakeAgent({
      action: { kind: "choice", value: "help", confidence: 0.8, calibrated: true, probabilities: { help: 0.8 } },
      target: { kind: "choice", value: ally.name, confidence: 0.9, calibrated: true, probabilities: {} },
      urgency: { kind: "score", value: 3.1, confidence: 0.6, calibrated: true, probabilities: {} },
    });
    const d = await makeJudgmentDecisionMaker(agent).decide({ world: w, agentId: self.id, perception: perceive(w, self.id) });
    expect(d.action.type).toBe("help");
    expect(d.action.target).toBe(ally.id);
  }, 15000);
  it("answers a whole camp in one batched judge call with per-agent fallback", async () => {
    const w = makeFallbackWorld(55);
    const ids = [w.agents[0]!.id, w.agents[1]!.id, w.agents[2]!.id];
    let calls = 0;
    let seenQuestions: string[] = [];
    const agent = {
      judge: async (input: { state: unknown; questions: Record<string, unknown> }) => {
        calls += 1;
        seenQuestions = Object.keys(input.questions);
        const answers: Record<string, unknown> = {};
        for (const id of ids) {
          answers[`action:${id}`] = { kind: "choice", value: "rest", confidence: 0.9, calibrated: true, probabilities: { rest: 0.9 } };
        }
        return answers as never;
      },
    };
    const { makeCampJudgmentDecisionMaker } = await import("./judgment.js");
    const maker = makeCampJudgmentDecisionMaker(agent, () => makeScriptedDecisionMaker());
    const inputs = ids.map((agentId) => ({ world: w, agentId, perception: perceive(w, agentId) }));
    const decisions = await maker.decideAll!(inputs);
    expect(calls).toBe(1);
    expect(seenQuestions.filter((key) => key.startsWith("action:"))).toHaveLength(3);
    for (const id of ids) {
      expect(decisions[id]?.action.type).toBe("rest");
    }
  }, 15000);

  it("templateNarrative is deterministic and names the top alternatives", () => {
    const n = templateNarrative({ type: "gather", target: "berries" }, { gather: 0.8, move: 0.15 }, "Find food");
    expect(n.reasoningSummary).toContain("0.80");
    expect(n.plan.length).toBeGreaterThan(0);
    expect(n).toEqual(templateNarrative({ type: "gather", target: "berries" }, { gather: 0.8, move: 0.15 }, "Find food"));
  }, 15000);
});
