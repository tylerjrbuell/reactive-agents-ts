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
