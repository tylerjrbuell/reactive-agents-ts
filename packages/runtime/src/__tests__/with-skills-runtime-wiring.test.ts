import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Effect, Layer } from "effect";
import { SkillResolverService } from "@reactive-agents/reactive-intelligence";
import { createRuntime } from "../runtime.js";

describe("withSkills → createRuntime wiring", () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      tmpRoot = undefined;
    }
  });

  it("registers SkillResolverService when skills.paths is set and RI is off", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skills-wire-"));
    const skillDir = path.join(tmpRoot, "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: wiring-demo-skill
description: Runtime wiring smoke test
---
# Instructions
Hello from wired skills.
`,
    );

    const layer = createRuntime({
      agentId: "wire-agent",
      provider: "test",
      enableReactiveIntelligence: false,
      enableReasoning: false,
      enableTools: false,
      enableMemory: false,
      skills: { paths: [tmpRoot] },
      skillDiscoveryRoot: tmpRoot,
    });

    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        return yield* resolver.resolve({
          taskDescription: "test",
          modelId: "test",
          agentId: "wire-agent",
        });
      }).pipe(Effect.provide(layer as Layer.Layer<any>)),
    );

    const names = resolved.all.map((s) => s.name);
    expect(names).toContain("wiring-demo-skill");
  });

  it("passes custom paths into resolver when RI is on", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skills-ri-"));
    const skillDir = path.join(tmpRoot, "ri-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: ri-path-skill
description: With RI on
---
Body
`,
    );

    const layer = createRuntime({
      agentId: "ri-agent",
      provider: "test",
      enableReactiveIntelligence: true,
      reactiveIntelligenceOptions: { telemetry: false },
      enableReasoning: false,
      enableTools: false,
      enableMemory: false,
      skills: { paths: [tmpRoot] },
      skillDiscoveryRoot: tmpRoot,
    });

    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* SkillResolverService;
        return yield* resolver.resolve({
          taskDescription: "x",
          modelId: "m",
          agentId: "ri-agent",
        });
      }).pipe(Effect.provide(layer as Layer.Layer<any>)),
    );

    expect(resolved.all.some((s) => s.name === "ri-path-skill")).toBe(true);
  });
});
