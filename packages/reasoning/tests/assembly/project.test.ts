import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("project — pure total assembler", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  it("is deterministic — same inputs → byte-identical output", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const store = new ResultStore();
    const a = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    const b = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
    expect(a.request.systemPrompt).toContain("P");
  });
  it("returns a populated trace with all 6 stages in order", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const { trace } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] } });
    // F10: `volatileTail` sits between compaction (so per-iteration content is
    // never compacted away) and finalize (which reads standingSections).
    expect(trace.stages.map((s) => s.name)).toEqual(["systemPrompt", "selectTools", "projectResults", "compactHistory", "volatileTail", "finalize"]);
  });
});

describe("skill/tool separation in system prompt", () => {
  const textParseCap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "text-parse", tier: "local" });
  const nativeFcCap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "mid" });

  const catalogXml = '<available_skills>\n<skill name="deploy" description="Deploy to prod" />\n</available_skills>';
  const activatedXml = '<skill_content name="deploy" version="1" source="project">\nRun `npm run deploy`\n</skill_content>';
  const toolSchemas = [{ name: "file-read", description: "Read a file", parameters: [{ name: "path", type: "string", description: "File path", required: true }] }];

  it("skills render in system prompt, separate from tools (text-parse)", () => {
    const log = new EventLog().append({ kind: "goal", text: "deploy the app" });
    const { request } = project({
      log,
      capability: textParseCap,
      store: new ResultStore(),
      persona: { system: "You are an agent." },
      skillsContext: { catalogXml, activatedXml },
      tools: { schemas: toolSchemas },
    });
    expect(request.systemPrompt).toContain("## Skills (procedural instructions");
    expect(request.systemPrompt).toContain("<available_skills>");
    expect(request.systemPrompt).toContain('<skill_content name="deploy"');
    expect(request.systemPrompt).toContain("file-read");
    const skillsIdx = request.systemPrompt.indexOf("## Skills");
    const toolIdx = request.systemPrompt.indexOf("file-read");
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("skills render for native-fc (tools skip, skills don't)", () => {
    const log = new EventLog().append({ kind: "goal", text: "deploy the app" });
    const { request } = project({
      log,
      capability: nativeFcCap,
      store: new ResultStore(),
      persona: { system: "You are an agent." },
      skillsContext: { catalogXml, activatedXml },
      tools: { schemas: toolSchemas },
    });
    expect(request.systemPrompt).toContain("## Skills (procedural instructions");
    expect(request.systemPrompt).toContain("<available_skills>");
    expect(request.systemPrompt).not.toContain("file-read");
  });

  it("no skills section when skillsContext is absent", () => {
    const log = new EventLog().append({ kind: "goal", text: "read a file" });
    const { request } = project({
      log,
      capability: textParseCap,
      store: new ResultStore(),
      persona: { system: "You are an agent." },
      tools: { schemas: toolSchemas },
    });
    expect(request.systemPrompt).not.toContain("## Skills");
    expect(request.systemPrompt).not.toContain("<available_skills>");
  });

  it("skills are NOT inside retrieved_memory fence", () => {
    const log = new EventLog().append({ kind: "goal", text: "deploy" });
    const { request } = project({
      log,
      capability: textParseCap,
      store: new ResultStore(),
      persona: { system: "Agent" },
      skillsContext: { catalogXml },
      tools: { schemas: [] },
      priorContext: "Some fenced memory content",
    });
    expect(request.systemPrompt).toContain("<available_skills>");
    const allMessages = request.messages.map((m) => m.content).join("\n");
    expect(allMessages).not.toContain("<available_skills>");
  });
});
