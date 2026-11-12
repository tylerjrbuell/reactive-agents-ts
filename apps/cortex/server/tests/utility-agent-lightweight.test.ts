import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { UTILITY_AGENT_PARAMS, utilityOutput, utilityPrompt } from "../services/utility-agent.js";
import { compileRunContract } from "@reactive-agents/reasoning";

const services = join(import.meta.dir, "..", "services");

describe("Cortex utility prompts run the lightweight one-shot path", () => {
  it("UTILITY_AGENT_PARAMS compiles to the direct strategy capped at one iteration", () => {
    const cfg = cortexParamsToAgentConfig({ agentName: "u", provider: "test", ...UTILITY_AGENT_PARAMS });
    expect(cfg.reasoning?.defaultStrategy).toBe("direct");
    expect(cfg.execution?.maxIterations).toBe(1);
    expect(cfg.thinking).toBe(false);
  });

  // Wire-it-and-pin-it: each utility call site must spread the shared params.
  // Cutting the spread from any one builder turns this red.
  it.each([
    ["chat-session-service.ts", "chat-titler"],
    ["chat-session-service.ts", "chat-compactor"],
    ["chat-goal-service.ts", "goal-checker"],
    ["chat-btw.ts", "chat-btw"],
  ])("%s builds %s with UTILITY_AGENT_PARAMS", (file, agentName) => {
    const src = readFileSync(join(services, file), "utf8");
    const at = src.indexOf(`agentName: "${agentName}"`);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 160)).toContain("...UTILITY_AGENT_PARAMS");
  });

  // Incident (2026-11): utility agents are keyed by name and Cortex turns memory on by default, so each
  // titler / compactor / goal-checker run created a memory folder (27k of them) and recalled/wrote memory.
  it("UTILITY_AGENT_PARAMS carries the explicit all-off memory: no memory layer, no memory feature (red-on-cut: drop `memory`)", () => {
    expect(UTILITY_AGENT_PARAMS.memory).toEqual({ working: false, episodic: false, semantic: false });
    const cfg = cortexParamsToAgentConfig({ agentName: "chat-titler", provider: "test", ...UTILITY_AGENT_PARAMS });
    expect(cfg.memory).toBeUndefined();
    expect(cfg.features?.memory).toBeUndefined();
    const { memory: _off, ...cut } = UTILITY_AGENT_PARAMS;
    expect(cortexParamsToAgentConfig({ agentName: "chat-titler", provider: "test", ...cut }).features?.memory).toBe(true);
  });

  // Every utility agent the server builds goes through UTILITY_AGENT_PARAMS (which is memory-off), so a
  // new one that skips the spread would leave memory on. This lists every `agentName` built with a utility
  // name and requires the spread next to each.
  it("no utility-named buildCortexAgent call skips the shared params", () => {
    for (const file of ["chat-session-service.ts", "chat-goal-service.ts", "chat-btw.ts"]) {
      const src = readFileSync(join(services, file), "utf8");
      const names = [...src.matchAll(/agentName: "(chat-titler|chat-compactor|goal-checker|chat-btw)"/g)];
      expect(names.length).toBeGreaterThan(0);
      for (const m of names) expect(src.slice(m.index!, m.index! + 160)).toContain("...UTILITY_AGENT_PARAMS");
    }
  });

  // Repro (2026-11-03, cogito:8b): titling a failed first turn made the direct run fail too;
  // its text became the title. A failed run now ships `output: ""` (cause on `error`), but its
  // output can still hold the model's own last text or a partial draft: never a title.
  it("utilityOutput drops a failed run's output", () => {
    expect(utilityOutput({ success: true, output: "Multiplication Problem" })).toBe("Multiplication Problem");
    expect(utilityOutput({ success: false, output: "" })).toBe("");
    expect(utilityOutput({ success: false, output: "Draft title\n\nUnfinished:\n- write ./notes.txt" })).toBe("");
    expect(utilityOutput({ success: true, output: undefined })).toBe("");
  });

  // Each utility call site must read its result through utilityOutput, never raw `.output`.
  it.each([
    ["chat-session-service.ts", "chat-titler"],
    ["chat-session-service.ts", "chat-compactor"],
    ["chat-goal-service.ts", "goal-checker"],
  ])("%s reads %s output through utilityOutput", (file, agentName) => {
    const src = readFileSync(join(services, file), "utf8");
    const at = src.indexOf(`agentName: "${agentName}"`);
    const body = src.slice(at, src.indexOf("finally", at));
    expect(body).toContain("utilityOutput(");
    expect(body).not.toContain(".output ??");
  });

  // Repro (2026-11-04, qwen3.5): a transcript quoting "Write a file notes.txt" compiled into a
  // required deliverable, so compaction abstained with "Unfinished: write the file ./notes.txt".
  it("quoted material never compiles into the utility run's contract (red-on-cut: unmarked prompt)", () => {
    const transcript = "User: Write a file notes.txt with my todo list\n\nAssistant: Done.";
    const instruction = "Summarise the conversation above.";
    const marked = compileRunContract(utilityPrompt(transcript, instruction));
    expect(JSON.stringify(marked.deliverables)).not.toContain("notes.txt");
    expect(JSON.stringify(marked.requirements)).not.toContain("notes.txt");
    const unmarked = compileRunContract(`${instruction}\n\n${transcript}`);
    expect(JSON.stringify([unmarked.deliverables, unmarked.requirements])).toContain("notes.txt");
  });

  it.each([
    ["chat-session-service.ts", "chat-titler"],
    ["chat-goal-service.ts", "goal-checker"],
  ])("%s builds the %s prompt with utilityPrompt", (file, agentName) => {
    const src = readFileSync(join(services, file), "utf8");
    const at = src.indexOf(`agentName: "${agentName}"`);
    expect(src.slice(at, src.indexOf("finally", at))).toContain("utilityPrompt(");
  });

  it("chat-compactor builds its prompt with compactionPrompt (bounded transcript + section contract)", () => {
    const src = readFileSync(join(services, "chat-session-service.ts"), "utf8");
    const at = src.indexOf(`agentName: "chat-compactor"`);
    expect(src.slice(at, src.indexOf("finally", at))).toContain("compactionPrompt(");
  });
});
