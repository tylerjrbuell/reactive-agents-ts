import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scaffold } from "../src/lib/scaffold.js";
import { renderTemplate, listTemplates, getTemplate } from "../src/templates/index.js";
import {
  providerDefaultModel,
  providerEnvVar,
  providerImport,
} from "../src/lib/provider-config.js";
import type { Provider, TemplateName, ScaffoldOptions } from "../src/types.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "cra-test-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function baseOpts(over: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    dir: path.join(tmpRoot, "proj"),
    projectName: "proj",
    template: "minimal",
    provider: "anthropic",
    packageManager: "bun",
    ...over,
  };
}

describe("provider-config", () => {
  test("env var map", () => {
    expect(providerEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerEnvVar("openai")).toBe("OPENAI_API_KEY");
    expect(providerEnvVar("google")).toBe("GOOGLE_API_KEY");
    expect(providerEnvVar("ollama")).toBeNull();
  });

  test("default model per provider", () => {
    for (const p of ["anthropic", "openai", "google", "ollama"] as const) {
      const m = providerDefaultModel(p);
      expect(m.length).toBeGreaterThan(0);
    }
  });

  test("provider import name is identity", () => {
    for (const p of ["anthropic", "openai", "google", "ollama"] as const) {
      expect(providerImport(p)).toBe(p);
    }
  });
});

describe("templates registry", () => {
  test("lists all templates", () => {
    const list = listTemplates();
    expect(list.length).toBe(6);
    const names = list.map((t) => t.name).sort();
    expect(names).toEqual([
      "minimal",
      "streaming",
      "with-approval-gates",
      "with-memory",
      "with-structured-output",
      "with-tools",
    ]);
  });

  test("each template has a non-empty description", () => {
    for (const t of listTemplates()) {
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  test("getTemplate returns the same object as listTemplates", () => {
    expect(getTemplate("minimal").name).toBe("minimal");
    expect(getTemplate("with-tools").name).toBe("with-tools");
    expect(getTemplate("streaming").name).toBe("streaming");
  });
});

describe("renderTemplate", () => {
  test("emits shared + template files", () => {
    const files = renderTemplate(baseOpts());
    const paths = files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain(".env.example");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/index.ts");
  });

  test("package.json embeds project name + reactive-agents dep", () => {
    const files = renderTemplate(baseOpts({ projectName: "demo-app" }));
    const pkg = files.find((f) => f.path === "package.json")!;
    const parsed = JSON.parse(pkg.content) as Record<string, unknown>;
    expect(parsed.name).toBe("demo-app");
    expect((parsed.dependencies as Record<string, string>)["reactive-agents"]).toBeDefined();
  });

  test(".env.example contains env var for cloud providers", () => {
    for (const p of ["anthropic", "openai", "google"] as const) {
      const files = renderTemplate(baseOpts({ provider: p }));
      const env = files.find((f) => f.path === ".env.example")!;
      expect(env.content).toContain(providerEnvVar(p)!);
    }
  });

  test(".env.example for ollama does NOT require a key", () => {
    const files = renderTemplate(baseOpts({ provider: "ollama" }));
    const env = files.find((f) => f.path === ".env.example")!;
    expect(env.content).toContain("Ollama");
    expect(env.content).not.toContain("API_KEY");
  });

  test("npm packageManager uses tsx in start script", () => {
    const files = renderTemplate(baseOpts({ packageManager: "npm" }));
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.start).toContain("tsx");
    expect(pkg.devDependencies.tsx).toBeDefined();
  });

  test("bun packageManager uses bun in start script", () => {
    const files = renderTemplate(baseOpts({ packageManager: "bun" }));
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.start).toContain("bun run");
    expect(pkg.devDependencies["bun-types"]).toBeDefined();
  });
});

describe("template-specific output", () => {
  const templates: TemplateName[] = [
    "minimal",
    "with-tools",
    "streaming",
    "with-structured-output",
    "with-approval-gates",
    "with-memory",
  ];
  const providers: Provider[] = ["anthropic", "openai", "google", "ollama"];

  for (const t of templates) {
    for (const p of providers) {
      test(`${t} × ${p} renders compilable index.ts`, () => {
        const files = renderTemplate(baseOpts({ template: t, provider: p }));
        const idx = files.find((f) => f.path === "src/index.ts")!;
        expect(idx.content).toContain('import { ReactiveAgents } from "reactive-agents"');
        expect(idx.content).toContain(`.withProvider("${p}")`);
        expect(idx.content).toContain(`.withModel("${providerDefaultModel(p)}")`);
      });
    }
  }

  test("with-tools template calls .withTools()", () => {
    const files = renderTemplate(baseOpts({ template: "with-tools" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain(".withTools()");
  });

  test("streaming template uses runStream()", () => {
    const files = renderTemplate(baseOpts({ template: "streaming" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain("agent.runStream(");
    expect(idx.content).toContain("text-delta");
  });

  test("minimal template does NOT call withTools or runStream", () => {
    const files = renderTemplate(baseOpts({ template: "minimal" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).not.toContain(".withTools()");
    expect(idx.content).not.toContain("runStream");
  });

  test("with-structured-output template declares a schema and reads result.object", () => {
    const files = renderTemplate(baseOpts({ template: "with-structured-output" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain(".withOutputSchema(");
    expect(idx.content).toContain("result.object");
    // adds the effect dependency it needs
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.effect).toBeDefined();
  });

  test("with-approval-gates template wires durable runs + approval policy + onApproval", () => {
    const files = renderTemplate(baseOpts({ template: "with-approval-gates" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain(".withDurableRuns()");
    expect(idx.content).toContain(".withApprovalPolicy(");
    expect(idx.content).toContain("onApproval");
  });

  test("with-memory template calls .withMemory() with a stable agent id", () => {
    const files = renderTemplate(baseOpts({ template: "with-memory" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain(".withMemory()");
    expect(idx.content).toContain(".withAgentId(");
  });

  test("cloud-provider template includes env-var check", () => {
    const files = renderTemplate(baseOpts({ provider: "anthropic" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).toContain("ANTHROPIC_API_KEY");
    expect(idx.content).toContain("process.exit(1)");
  });

  test("ollama template skips env-var check", () => {
    const files = renderTemplate(baseOpts({ provider: "ollama" }));
    const idx = files.find((f) => f.path === "src/index.ts")!;
    expect(idx.content).not.toContain("process.exit(1)");
  });
});

describe("scaffold (filesystem)", () => {
  test("creates target dir with all files", async () => {
    const result = await scaffold(baseOpts());
    expect(existsSync(result.dir)).toBe(true);
    const entries = await readdir(result.dir);
    expect(entries).toContain("package.json");
    expect(entries).toContain("src");
    const pkg = JSON.parse(
      await readFile(path.join(result.dir, "package.json"), "utf8"),
    ) as { name: string };
    expect(pkg.name).toBe("proj");
  });

  test("nextSteps mentions install + start", async () => {
    const result = await scaffold(baseOpts({ packageManager: "bun" }));
    const joined = result.nextSteps.join(" ");
    expect(joined).toContain("install");
    expect(joined).toContain("start");
    expect(joined).toContain("cd proj");
  });

  test("npm nextSteps uses 'npm run start'", async () => {
    const result = await scaffold(baseOpts({ packageManager: "npm" }));
    expect(result.nextSteps.join(" ")).toContain("npm run start");
  });

  test("ollama nextSteps does NOT mention an env var", async () => {
    const result = await scaffold(baseOpts({ provider: "ollama" }));
    const joined = result.nextSteps.join(" ");
    expect(joined).not.toContain("API_KEY");
  });

  test("refuses to scaffold into a non-empty directory", async () => {
    const opts = baseOpts();
    await scaffold(opts);
    await expect(scaffold(opts)).rejects.toThrow(/not empty/);
  });
});
