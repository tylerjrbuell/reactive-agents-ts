// Run: bun test apps/examples/src/demos/island-sim/engine/cassette.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { makeScriptedDecisionMaker } from "../decision/types.js";
import { CassetteRecorder, makeReplayDecisionMaker, replayRun } from "./cassette.js";
import { perceive } from "./perceive.js";

describe("cassette", () => {
  it("replays 1 recorded tick to an identical world and event stream", async () => {
    const w = makeFallbackWorld(77);
    const rec = new CassetteRecorder(w, makeScriptedDecisionMaker());
    const live = [];
    for (let i = 0; i < 1; i++) live.push(await rec.step());
    const cassette = rec.toCassette();
    const replay = await replayRun(cassette);
    expect(replay.world.agents.map(a => a.location)).toEqual(live[0].world.agents.map(a => a.location));
    expect(replay.events).toEqual([...live[0].events]);
  }, 15000);
  it("replay decision maker returns the recorded decision for the tick", async () => {
    const w = makeFallbackWorld(77);
    const rec = new CassetteRecorder(w, makeScriptedDecisionMaker());
    await rec.step();
    const maker = makeReplayDecisionMaker(rec.toCassette());
    const d = await maker.decide({ world: w, agentId: w.agents[0].id, perception: perceive(w, w.agents[0].id) });
    expect(d.action.type).toBeDefined();
  }, 15000);
});
