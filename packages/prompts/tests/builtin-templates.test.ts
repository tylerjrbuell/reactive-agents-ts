/**
 * Built-in template tests — verify all reasoning strategy templates,
 * evaluation templates, and agent templates render correctly.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { interpolate } from "../src/services/template-engine.js";

// Reasoning templates (high-level)
import { reactTemplate } from "../src/templates/reasoning/react.js";
import { planExecuteTemplate } from "../src/templates/reasoning/plan-execute.js";
import { treeOfThoughtTemplate } from "../src/templates/reasoning/tree-of-thought.js";
import { reflexionTemplate } from "../src/templates/reasoning/reflexion.js";

// Strategy-specific templates
import { reactSystemTemplate } from "../src/templates/reasoning/react-system.js";
import { reactThoughtTemplate } from "../src/templates/reasoning/react-thought.js";
import { planExecutePlanTemplate } from "../src/templates/reasoning/plan-execute-plan.js";
import { planExecuteExecuteTemplate } from "../src/templates/reasoning/plan-execute-execute.js";
import { planExecuteReflectTemplate } from "../src/templates/reasoning/plan-execute-reflect.js";
import { treeOfThoughtExpandTemplate } from "../src/templates/reasoning/tree-of-thought-expand.js";
import { treeOfThoughtScoreTemplate } from "../src/templates/reasoning/tree-of-thought-score.js";
import { treeOfThoughtSynthesizeTemplate } from "../src/templates/reasoning/tree-of-thought-synthesize.js";
import { reflexionGenerateTemplate } from "../src/templates/reasoning/reflexion-generate.js";
import { reflexionCritiqueTemplate } from "../src/templates/reasoning/reflexion-critique.js";
import { adaptiveClassifyTemplate } from "../src/templates/reasoning/adaptive-classify.js";

// Evaluation templates
import { judgeAccuracyTemplate } from "../src/templates/evaluation/judge-accuracy.js";
import { judgeRelevanceTemplate } from "../src/templates/evaluation/judge-relevance.js";
import { judgeCompletenessTemplate } from "../src/templates/evaluation/judge-completeness.js";
import { judgeSafetyTemplate } from "../src/templates/evaluation/judge-safety.js";
import { judgeGenericTemplate } from "../src/templates/evaluation/judge-generic.js";

// Verification templates
import { factCheckTemplate } from "../src/templates/verification/fact-check.js";

// Agent templates
import { defaultSystemTemplate } from "../src/templates/agent/default-system.js";

import { allBuiltinTemplates } from "../src/templates/all.js";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

// ─── ReAct Template ───

describe("reactTemplate", () => {
  test("renders with required variables", async () => {
    const result = await run(
      interpolate(reactTemplate, {
        task: "Find the capital of France",
        tools: "web-search, calculator",
      }),
    );
    expect(result).toContain("Find the capital of France");
    expect(result).toContain("web-search, calculator");
    expect(result).toContain("ReAct");
    expect(result).toContain("Thought:");
    expect(result).toContain("Action:");
    expect(result).toContain("Observation:");
    expect(result).toContain("Final Answer:");
  });

  test("renders constraints when provided", async () => {
    const result = await run(
      interpolate(reactTemplate, {
        task: "Summarize article",
        tools: "web-search",
        constraints: "Max 200 words",
      }),
    );
    expect(result).toContain("Max 200 words");
  });

  test("replaces constraints default (empty string) when not provided", async () => {
    const result = await run(
      interpolate(reactTemplate, {
        task: "test",
        tools: "tool1",
      }),
    );
    expect(result).not.toContain("{{constraints}}");
  });
});

// ─── Plan-Execute Template ───

describe("planExecuteTemplate", () => {
  test("renders with required variables", async () => {
    const result = await run(
      interpolate(planExecuteTemplate, {
        task: "Build a REST API",
        tools: "code-write, file-read",
      }),
    );
    expect(result).toContain("Build a REST API");
    expect(result).toContain("code-write, file-read");
    expect(result).toContain("Plan-and-Execute");
    expect(result).toContain("Phase 1 - Planning");
    expect(result).toContain("Phase 2 - Execution");
    expect(result).toContain("Phase 3 - Synthesis");
  });
});

// ─── Tree of Thought Template ───

describe("treeOfThoughtTemplate", () => {
  test("renders with required variable", async () => {
    const result = await run(
      interpolate(treeOfThoughtTemplate, {
        problem: "How to optimize database queries",
      }),
    );
    expect(result).toContain("How to optimize database queries");
    expect(result).toContain("Tree-of-Thought");
  });

  test("uses default branch count when not provided", async () => {
    const result = await run(
      interpolate(treeOfThoughtTemplate, {
        problem: "Test problem",
      }),
    );
    // Default is 3 branches
    expect(result).toContain("3");
  });

  test("overrides branch count when provided", async () => {
    const result = await run(
      interpolate(treeOfThoughtTemplate, {
        problem: "Test problem",
        branches: 5,
      }),
    );
    expect(result).toContain("5");
  });

  test("includes evaluation criteria when provided", async () => {
    const result = await run(
      interpolate(treeOfThoughtTemplate, {
        problem: "Design a caching strategy",
        evaluation_criteria: "latency, memory usage, consistency",
      }),
    );
    expect(result).toContain("latency, memory usage, consistency");
  });
});

// ─── Reflexion Template ───

describe("reflexionTemplate", () => {
  test("renders with only required variable", async () => {
    const result = await run(
      interpolate(reflexionTemplate, { task: "Write a poem" }),
    );
    expect(result).toContain("Write a poem");
    expect(result).toContain("Reflexion");
    expect(result).toContain("reflect");
  });

  test("includes previous attempt and reflection when provided", async () => {
    const result = await run(
      interpolate(reflexionTemplate, {
        task: "Write a haiku",
        previous_attempt: "Roses are red\nViolets are blue",
        reflection: "Not a haiku format — needs 5-7-5 syllable structure",
      }),
    );
    expect(result).toContain("Roses are red");
    expect(result).toContain("Not a haiku format");
  });
});

// ─── Strategy-Specific System Prompts ───

describe("strategy-specific system prompts", () => {
  test("reactSystemTemplate renders with task", async () => {
    const result = await run(
      interpolate(reactSystemTemplate, { task: "Analyze data" }),
    );
    expect(result).toContain("reasoning agent");
    expect(result).toContain("Analyze data");
  });

  test("reactThoughtTemplate renders with context and history", async () => {
    const result = await run(
      interpolate(reactThoughtTemplate, {
        context: "Task: find info. Tools: search",
        history: "Step 1: searched for info\nResult: found data",
      }),
    );
    expect(result).toContain("find info");
    expect(result).toContain("Step 1: searched for info");
    expect(result).toContain("ACTION:");
    expect(result).toContain("FINAL ANSWER:");
  });

  test("planExecutePlanTemplate renders with task", async () => {
    const result = await run(
      interpolate(planExecutePlanTemplate, { task: "Deploy app" }),
    );
    expect(result).toContain("planning agent");
    expect(result).toContain("Deploy app");
  });

  test("planExecuteExecuteTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of planExecuteExecuteTemplate.variables) {
      vars[v.name] = v.type === "string" ? "test-value" : 42;
    }
    const result = await run(interpolate(planExecuteExecuteTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("planExecuteReflectTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of planExecuteReflectTemplate.variables) {
      vars[v.name] = v.type === "string" ? "test-value" : 42;
    }
    const result = await run(interpolate(planExecuteReflectTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("treeOfThoughtExpandTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of treeOfThoughtExpandTemplate.variables) {
      vars[v.name] = v.type === "string" ? "test-value" : 42;
    }
    const result = await run(interpolate(treeOfThoughtExpandTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("treeOfThoughtScoreTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of treeOfThoughtScoreTemplate.variables) {
      vars[v.name] = v.type === "string" ? "test-value" : 42;
    }
    const result = await run(interpolate(treeOfThoughtScoreTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("treeOfThoughtSynthesizeTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of treeOfThoughtSynthesizeTemplate.variables) {
      vars[v.name] = v.type === "string" ? "test-value" : 42;
    }
    const result = await run(interpolate(treeOfThoughtSynthesizeTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("reflexionGenerateTemplate renders with task", async () => {
    const result = await run(
      interpolate(reflexionGenerateTemplate, { task: "Solve puzzle" }),
    );
    expect(result).toContain("Solve puzzle");
    expect(result).toContain("reasoning agent");
  });

  test("reflexionCritiqueTemplate renders with no variables", async () => {
    const result = await run(interpolate(reflexionCritiqueTemplate, {}));
    expect(result).toContain("critical evaluator");
  });

  test("adaptiveClassifyTemplate renders with no variables", async () => {
    const result = await run(interpolate(adaptiveClassifyTemplate, {}));
    expect(result).toContain("REACTIVE");
    expect(result).toContain("PLAN_EXECUTE");
    expect(result).toContain("TREE_OF_THOUGHT");
    expect(result).toContain("REFLEXION");
  });
});

// ─── Evaluation Templates ───

describe("evaluation templates", () => {
  test("judgeAccuracyTemplate renders with all variables", async () => {
    const result = await run(
      interpolate(judgeAccuracyTemplate, {
        input: "What is 2+2?",
        reference: "Expected: 4",
        actualOutput: "The answer is 4.",
      }),
    );
    expect(result).toContain("What is 2+2?");
    expect(result).toContain("Expected: 4");
    expect(result).toContain("The answer is 4.");
    expect(result).toContain("accuracy");
  });

  test("judgeRelevanceTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of judgeRelevanceTemplate.variables) {
      vars[v.name] = "test-input";
    }
    const result = await run(interpolate(judgeRelevanceTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("judgeCompletenessTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of judgeCompletenessTemplate.variables) {
      vars[v.name] = "test-input";
    }
    const result = await run(interpolate(judgeCompletenessTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("judgeSafetyTemplate renders", async () => {
    const vars: Record<string, unknown> = {};
    for (const v of judgeSafetyTemplate.variables) {
      vars[v.name] = "test-input";
    }
    const result = await run(interpolate(judgeSafetyTemplate, vars));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("judgeGenericTemplate renders with dimension", async () => {
    const result = await run(
      interpolate(judgeGenericTemplate, {
        dimension: "creativity",
        input: "Write a story",
        actualOutput: "Once upon a time...",
      }),
    );
    expect(result).toContain("creativity");
    expect(result).toContain("Write a story");
    expect(result).toContain("Once upon a time...");
  });
});

// ─── Verification Templates ───

describe("factCheckTemplate", () => {
  test("renders with required claim", async () => {
    const result = await run(
      interpolate(factCheckTemplate, { claim: "Water boils at 100C" }),
    );
    expect(result).toContain("Water boils at 100C");
    expect(result).toContain("fact-check");
    expect(result).toContain("Supported");
  });

  test("includes context when provided", async () => {
    const result = await run(
      interpolate(factCheckTemplate, {
        claim: "Earth is flat",
        context: "According to modern science",
      }),
    );
    expect(result).toContain("According to modern science");
  });
});

// ─── Agent Templates ───

describe("defaultSystemTemplate", () => {
  test("renders with no variables", async () => {
    const result = await run(interpolate(defaultSystemTemplate, {}));
    expect(result).toContain("helpful AI assistant");
  });
});

// ─── All Built-in Templates ───

describe("allBuiltinTemplates collection", () => {
  test("contains at least 25 templates", () => {
    expect(allBuiltinTemplates.length).toBeGreaterThanOrEqual(25);
  });

  test("every template has all required schema fields", () => {
    for (const tpl of allBuiltinTemplates) {
      expect(typeof tpl.id).toBe("string");
      expect(tpl.id.length).toBeGreaterThan(0);
      expect(typeof tpl.name).toBe("string");
      expect(tpl.name.length).toBeGreaterThan(0);
      expect(typeof tpl.version).toBe("number");
      expect(tpl.version).toBeGreaterThanOrEqual(1);
      expect(typeof tpl.template).toBe("string");
      expect(Array.isArray(tpl.variables)).toBe(true);
    }
  });

  test("all template IDs follow naming convention", () => {
    for (const tpl of allBuiltinTemplates) {
      // IDs should be dot-separated with optional :tier suffix
      expect(tpl.id).toMatch(/^[a-z]+\.[a-z0-9-]+(:[a-z]+)?$/);
    }
  });

  test("no duplicate template IDs at the same version", () => {
    const keys = allBuiltinTemplates.map((t) => `${t.id}:v${t.version}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  test("all templates compile successfully with dummy variables", async () => {
    for (const tpl of allBuiltinTemplates) {
      const vars: Record<string, unknown> = {};
      for (const v of tpl.variables) {
        switch (v.type) {
          case "string": vars[v.name] = "test"; break;
          case "number": vars[v.name] = 1; break;
          case "boolean": vars[v.name] = true; break;
          case "array": vars[v.name] = ["a"]; break;
          case "object": vars[v.name] = { k: "v" }; break;
        }
      }
      const result = await run(interpolate(tpl, vars));
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
