/**
 * Extended PromptService tests — version management, compose edge cases,
 * maxTokens truncation, tier resolution edge cases, runtime layer.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  PromptService,
  PromptServiceLive,
  createPromptLayer,
  allBuiltinTemplates,
} from "../src/index.js";
import type { PromptTemplate } from "../src/types/template.js";

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, PromptService>,
): Promise<A> =>
  effect.pipe(Effect.provide(PromptServiceLive), Effect.runPromise);

const makeTemplate = (
  overrides: Partial<PromptTemplate> & Pick<PromptTemplate, "id" | "template">,
): PromptTemplate => ({
  id: overrides.id,
  name: overrides.name ?? "Test",
  version: overrides.version ?? 1,
  variables: overrides.variables ?? [],
  template: overrides.template,
});

// ─── Registration ───

describe("PromptService — registration", () => {
  test("registers and retrieves a template", async () => {
    const tpl = makeTemplate({ id: "test.reg", template: "Hello" });
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(tpl);
        return yield* svc.getVersion("test.reg", 1);
      }),
    );
    expect(result.id).toBe("test.reg");
    expect(result.template).toBe("Hello");
  });

  test("registering same template twice is idempotent", async () => {
    const tpl = makeTemplate({ id: "test.idem", template: "Same" });
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(tpl);
        yield* svc.register(tpl);
        const history = yield* svc.getVersionHistory("test.idem");
        return history;
      }),
    );
    // Map key is "id:version", so registering same version replaces entry
    expect(result.length).toBe(1);
  });
});

// ─── Version Management ───

describe("PromptService — version management", () => {
  test("getVersion returns specific version", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "test.ver", template: "v1", version: 1 }));
        yield* svc.register(makeTemplate({ id: "test.ver", template: "v2", version: 2 }));
        yield* svc.register(makeTemplate({ id: "test.ver", template: "v3", version: 3 }));

        const v1 = yield* svc.getVersion("test.ver", 1);
        const v2 = yield* svc.getVersion("test.ver", 2);
        const v3 = yield* svc.getVersion("test.ver", 3);
        return { v1, v2, v3 };
      }),
    );
    expect(result.v1.template).toBe("v1");
    expect(result.v2.template).toBe("v2");
    expect(result.v3.template).toBe("v3");
  });

  test("getVersion fails for non-existent version", async () => {
    const err = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "test.ver2", template: "v1", version: 1 }));
        return yield* svc.getVersion("test.ver2", 99).pipe(Effect.flip);
      }),
    );
    expect(err._tag).toBe("TemplateNotFoundError");
  });

  test("getVersion fails for non-existent template", async () => {
    const err = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        return yield* svc.getVersion("nonexistent", 1).pipe(Effect.flip);
      }),
    );
    expect(err._tag).toBe("TemplateNotFoundError");
  });

  test("getVersionHistory returns sorted by version", async () => {
    const history = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        // Register out of order
        yield* svc.register(makeTemplate({ id: "test.hist", template: "v3", version: 3 }));
        yield* svc.register(makeTemplate({ id: "test.hist", template: "v1", version: 1 }));
        yield* svc.register(makeTemplate({ id: "test.hist", template: "v2", version: 2 }));
        return yield* svc.getVersionHistory("test.hist");
      }),
    );
    expect(history.length).toBe(3);
    expect(history[0]!.version).toBe(1);
    expect(history[1]!.version).toBe(2);
    expect(history[2]!.version).toBe(3);
  });

  test("getVersionHistory returns empty for unknown template", async () => {
    const history = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        return yield* svc.getVersionHistory("nonexistent");
      }),
    );
    expect(history.length).toBe(0);
  });

  test("compile always uses latest version", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "test.latest", template: "old", version: 1 }));
        yield* svc.register(makeTemplate({ id: "test.latest", template: "new", version: 5 }));
        return yield* svc.compile("test.latest", {});
      }),
    );
    expect(result.version).toBe(5);
    expect(result.content).toBe("new");
  });
});

// ─── Compose ───

describe("PromptService — compose", () => {
  test("composes with default separator (double newline)", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "a", template: "Part A" }));
        yield* svc.register(makeTemplate({ id: "b", template: "Part B" }));
        const p1 = yield* svc.compile("a", {});
        const p2 = yield* svc.compile("b", {});
        return yield* svc.compose([p1, p2]);
      }),
    );
    expect(result.content).toBe("Part A\n\nPart B");
  });

  test("composes with custom separator", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "x", template: "X" }));
        yield* svc.register(makeTemplate({ id: "y", template: "Y" }));
        const p1 = yield* svc.compile("x", {});
        const p2 = yield* svc.compile("y", {});
        return yield* svc.compose([p1, p2], { separator: " | " });
      }),
    );
    expect(result.content).toBe("X | Y");
  });

  test("composes single prompt", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "solo", template: "Only one" }));
        const p = yield* svc.compile("solo", {});
        return yield* svc.compose([p]);
      }),
    );
    expect(result.content).toBe("Only one");
    expect(result.templateId).toBe("composed");
  });

  test("composes empty array", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        return yield* svc.compose([]);
      }),
    );
    expect(result.content).toBe("");
    expect(result.tokenEstimate).toBe(0);
  });

  test("token estimate sums component estimates", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "p1", template: "A".repeat(100) }));
        yield* svc.register(makeTemplate({ id: "p2", template: "B".repeat(200) }));
        const c1 = yield* svc.compile("p1", {});
        const c2 = yield* svc.compile("p2", {});
        return yield* svc.compose([c1, c2]);
      }),
    );
    expect(result.tokenEstimate).toBe(
      Math.ceil(100 / 4) + Math.ceil(200 / 4),
    );
  });
});

// ─── MaxTokens Truncation ───

describe("PromptService — maxTokens", () => {
  test("truncates content when token estimate exceeds maxTokens", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({
          id: "long",
          template: "word ".repeat(500), // ~2500 chars -> ~625 tokens
        }));
        return yield* svc.compile("long", {}, { maxTokens: 50 });
      }),
    );
    // Content should be truncated to maxTokens * 4 = 200 chars
    expect(result.content.length).toBeLessThanOrEqual(200);
    expect(result.tokenEstimate).toBeLessThanOrEqual(50);
  });

  test("does not truncate when under maxTokens", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({
          id: "short",
          template: "Brief content",
        }));
        return yield* svc.compile("short", {}, { maxTokens: 1000 });
      }),
    );
    expect(result.content).toBe("Brief content");
  });

  test("maxTokens not specified leaves content intact", async () => {
    const longTemplate = "x".repeat(5000);
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({
          id: "full",
          template: longTemplate,
        }));
        return yield* svc.compile("full", {});
      }),
    );
    expect(result.content).toBe(longTemplate);
  });
});

// ─── createPromptLayer ───

describe("createPromptLayer", () => {
  test("pre-registers all built-in templates", async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        let compiledCount = 0;
        for (const tpl of allBuiltinTemplates) {
          const vars: Record<string, unknown> = {};
          for (const v of tpl.variables) {
            vars[v.name] = v.type === "string" ? "x" : 1;
          }
          const compiled = yield* svc.compile(tpl.id, vars);
          if (compiled.content.length > 0) compiledCount++;
        }
        return compiledCount;
      }).pipe(Effect.provide(createPromptLayer())),
    );
    expect(count).toBe(allBuiltinTemplates.length);
  });

  test("can register additional templates on top of built-in", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({ id: "custom.mine", template: "Custom!" }));
        const custom = yield* svc.compile("custom.mine", {});
        // Also verify built-in still works
        const builtin = yield* svc.compile("agent.default-system", {});
        return { custom, builtin };
      }).pipe(Effect.provide(createPromptLayer())),
    );
    expect(result.custom.content).toBe("Custom!");
    expect(result.builtin.content).toContain("helpful AI assistant");
  });
});

// ─── Compile with Tier + Variables ───

describe("PromptService — compile with tier and variables combined", () => {
  test("tier-resolved template still interpolates variables", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({
          id: "my.tpl:local",
          template: "Local task: {{task}}",
          variables: [{ name: "task", required: true, type: "string" }],
        }));
        yield* svc.register(makeTemplate({
          id: "my.tpl",
          template: "Base task: {{task}}",
          variables: [{ name: "task", required: true, type: "string" }],
        }));
        return yield* svc.compile("my.tpl", { task: "do thing" }, { tier: "local" });
      }),
    );
    expect(result.templateId).toBe("my.tpl:local");
    expect(result.content).toBe("Local task: do thing");
  });

  test("compile stores variables in result", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(makeTemplate({
          id: "test.vars",
          template: "{{a}} {{b}}",
          variables: [
            { name: "a", required: true, type: "string" },
            { name: "b", required: true, type: "string" },
          ],
        }));
        return yield* svc.compile("test.vars", { a: "hello", b: "world" });
      }),
    );
    expect(result.variables).toEqual({ a: "hello", b: "world" });
  });
});
