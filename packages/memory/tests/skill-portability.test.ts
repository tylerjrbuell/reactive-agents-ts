import { describe, it, expect } from "bun:test";
import {
  exportSkillToMarkdown,
  importSkillFromMarkdown,
} from "../src/services/skill-portability.js";
import type { SkillRecord, SkillFragmentConfig } from "@reactive-agents/core";

const defaultConfig: SkillFragmentConfig = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: overrides.id ?? "skill-abc",
  name: overrides.name ?? "web-search-strategy",
  description: overrides.description ?? "Strategic web search with verification",
  agentId: overrides.agentId ?? "research-agent",
  source: overrides.source ?? "learned",
  instructions: overrides.instructions ?? "# Approach\n\nSearch for fresh data, verify before citing.",
  version: overrides.version ?? 3,
  versionHistory: overrides.versionHistory ?? [],
  config: overrides.config ?? defaultConfig,
  evolutionMode: overrides.evolutionMode ?? "auto",
  confidence: overrides.confidence ?? "trusted",
  successRate: overrides.successRate ?? 0.85,
  useCount: overrides.useCount ?? 42,
  refinementCount: overrides.refinementCount ?? 2,
  taskCategories: overrides.taskCategories ?? ["research", "web-search"],
  modelAffinities: overrides.modelAffinities ?? ["qwen3:14b"],
  base: overrides.base ?? null,
  avgPostActivationEntropyDelta: overrides.avgPostActivationEntropyDelta ?? 0.12,
  avgConvergenceIteration: overrides.avgConvergenceIteration ?? 3.5,
  convergenceSpeedTrend: overrides.convergenceSpeedTrend ?? [3.5, 3.4, 3.2],
  conflictsWith: overrides.conflictsWith ?? [],
  lastActivatedAt: overrides.lastActivatedAt ?? new Date("2026-05-13T14:00:00.000Z"),
  lastRefinedAt: overrides.lastRefinedAt ?? new Date("2026-05-13T13:00:00.000Z"),
  createdAt: overrides.createdAt ?? new Date("2026-05-01T10:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-05-13T15:30:00.000Z"),
  contentVariants: overrides.contentVariants ?? {
    full: "# Approach\n\nSearch for fresh data, verify before citing.",
    summary: "Search and verify.",
    condensed: "Verify before citing.",
  },
});

describe("skill-portability: export", () => {
  it("produces valid markdown with skill name as H1", () => {
    const md = exportSkillToMarkdown(makeSkill());
    expect(md).toMatch(/^# Skill: web-search-strategy/);
  });

  it("includes a metadata code block with all key fields", () => {
    const skill = makeSkill();
    const md = exportSkillToMarkdown(skill);
    expect(md).toContain("```json");
    expect(md).toContain('"name": "web-search-strategy"');
    expect(md).toContain('"agentId": "research-agent"');
    expect(md).toContain('"version": 3');
    expect(md).toContain('"successRate": 0.85');
    expect(md).toContain('"confidence": "trusted"');
  });

  it("includes the full instructions under Instructions heading", () => {
    const md = exportSkillToMarkdown(makeSkill());
    expect(md).toContain("## Instructions");
    expect(md).toContain("Search for fresh data, verify before citing.");
  });

  it("includes summary and condensed variants when present", () => {
    const md = exportSkillToMarkdown(makeSkill());
    expect(md).toContain("## Summary");
    expect(md).toContain("Search and verify.");
    expect(md).toContain("## Condensed");
    expect(md).toContain("Verify before citing.");
  });

  it("omits Summary/Condensed sections when variants are null", () => {
    const skill = makeSkill({
      contentVariants: { full: "x", summary: null, condensed: null },
    });
    const md = exportSkillToMarkdown(skill);
    expect(md).not.toContain("## Summary");
    expect(md).not.toContain("## Condensed");
  });

  it("includes badge line with confidence, version, success rate", () => {
    const md = exportSkillToMarkdown(makeSkill());
    expect(md).toMatch(/Confidence.*trusted/);
    expect(md).toMatch(/Version.*3/);
    expect(md).toMatch(/85\.0%/);
  });
});

describe("skill-portability: import", () => {
  it("round-trips a full skill (export → import → equal)", () => {
    const original = makeSkill();
    const md = exportSkillToMarkdown(original);
    const restored = importSkillFromMarkdown(md);
    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.description).toBe(original.description);
    expect(restored.instructions).toBe(original.instructions);
    expect(restored.version).toBe(original.version);
    expect(restored.confidence).toBe(original.confidence);
    expect(restored.successRate).toBe(original.successRate);
    expect(restored.useCount).toBe(original.useCount);
    expect(restored.taskCategories).toEqual(original.taskCategories);
    expect(restored.modelAffinities).toEqual(original.modelAffinities);
    expect(restored.contentVariants.full).toBe(original.contentVariants.full);
    expect(restored.contentVariants.summary).toBe(original.contentVariants.summary);
    expect(restored.contentVariants.condensed).toBe(original.contentVariants.condensed);
    expect(restored.config).toEqual(original.config);
  });

  it("preserves date fields as Date instances", () => {
    const original = makeSkill();
    const md = exportSkillToMarkdown(original);
    const restored = importSkillFromMarkdown(md);
    expect(restored.createdAt).toBeInstanceOf(Date);
    expect(restored.updatedAt).toBeInstanceOf(Date);
    expect(restored.lastActivatedAt).toBeInstanceOf(Date);
    expect(restored.lastRefinedAt).toBeInstanceOf(Date);
    expect(restored.createdAt.toISOString()).toBe(original.createdAt.toISOString());
  });

  it("applies overrides on import (agentId rebind)", () => {
    const original = makeSkill({ agentId: "agent-source" });
    const md = exportSkillToMarkdown(original);
    const restored = importSkillFromMarkdown(md, { agentId: "agent-target" });
    expect(restored.agentId).toBe("agent-target");
    expect(restored.name).toBe(original.name);
  });

  it("regenerates id when overrides.id = 'regenerate'", () => {
    const original = makeSkill({ id: "old-id" });
    const md = exportSkillToMarkdown(original);
    const restored = importSkillFromMarkdown(md, { id: "regenerate" });
    expect(restored.id).not.toBe("old-id");
    expect(restored.id.length).toBeGreaterThan(0);
  });

  it("throws on missing metadata block", () => {
    expect(() => importSkillFromMarkdown("# Skill: x\n\nno metadata block")).toThrow();
  });

  it("throws on malformed JSON in metadata", () => {
    expect(() =>
      importSkillFromMarkdown("# Skill: x\n\n```json\n{not valid}\n```\n"),
    ).toThrow();
  });

  it("recovers instructions from body when Instructions section present", () => {
    const md = `# Skill: x

\`\`\`json
{
  "id": "s1",
  "name": "x",
  "description": "",
  "agentId": "a1",
  "source": "learned",
  "version": 1,
  "config": {
    "strategy": "reactive",
    "temperature": 0.7,
    "maxIterations": 5,
    "promptTemplateId": "default",
    "systemPromptTokens": 0,
    "compressionEnabled": false
  },
  "evolutionMode": "auto",
  "confidence": "tentative",
  "successRate": 0,
  "useCount": 0,
  "refinementCount": 0,
  "taskCategories": [],
  "modelAffinities": [],
  "base": null,
  "avgPostActivationEntropyDelta": 0,
  "avgConvergenceIteration": 0,
  "convergenceSpeedTrend": [],
  "conflictsWith": [],
  "lastActivatedAt": null,
  "lastRefinedAt": null,
  "createdAt": "2026-05-13T00:00:00.000Z",
  "updatedAt": "2026-05-13T00:00:00.000Z"
}
\`\`\`

## Instructions

Hand-written instructions inline.

Multiple paragraphs OK.
`;
    const restored = importSkillFromMarkdown(md);
    expect(restored.instructions).toContain("Hand-written instructions inline");
    expect(restored.instructions).toContain("Multiple paragraphs OK");
    expect(restored.contentVariants.full).toBe(restored.instructions);
  });
});
