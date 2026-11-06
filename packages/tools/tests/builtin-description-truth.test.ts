// Run: bun test packages/tools/tests/builtin-description-truth.test.ts --timeout 20000
//
// Built-in tool descriptions must state only what the handler and resolved
// config actually do (harness truthfulness audit, 2026-11-06:
// wiki/Research/Harness-Reports/2026-11-06-harness-truthfulness-audit.md,
// rows 5, 8, 9, 12, 16). Each claim is pinned against the REAL handler where
// the claim is behavioral: the test first measures the behavior, then checks
// that the model-facing text agrees with the measurement.
import { describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import {
  codeExecuteHandler,
  codeExecuteTool,
  codeExecuteToolFor,
} from "../src/skills/code-execution.js";
import {
  fileEditTool,
  fileReadHandler,
  fileReadTool,
  fileWriteTool,
  withFileRoot,
} from "../src/skills/file-operations.js";
import {
  discoverToolsTool,
  makeDiscoverToolsHandler,
} from "../src/skills/discover-tools.js";
import { findDescriptionFor, findTool, findToolFor, makeFindHandler } from "../src/skills/find.js";
import { dockerExecuteTool, dockerExecuteToolFor } from "../src/skills/docker-execution.js";
import { HANDLER_TIMEOUT_GRACE_MS } from "../src/skills/timeout-grace.js";
import { ToolExecutionError } from "../src/errors.js";
import { webSearchHandler, webSearchTool } from "../src/skills/web-search.js";
import type { ToolDefinition } from "../src/types.js";

/** Every model-facing string of a definition: description + param docs. */
const modelText = (def: ToolDefinition): string =>
  [def.description, ...def.parameters.map((p) => p.description)].join("\n");

const pathParam = (def: ToolDefinition): string =>
  def.parameters.find((p) => p.name === "path")?.description ?? "";

// ─── File tools: absolute paths inside the root are accepted ───────────────

describe("file tools: path docs match confinement", () => {
  it("absolute path inside the root is accepted by the real handler, and the docs say so", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "truth-file-")));
    await writeFile(join(root, "notes.txt"), "hello");

    const absInside = await withFileRoot(root, () =>
      Effect.runPromise(fileReadHandler({ path: join(root, "notes.txt") })),
    );
    expect(absInside).toBe("hello");
    const relative = await withFileRoot(root, () =>
      Effect.runPromise(fileReadHandler({ path: "./notes.txt" })),
    );
    expect(relative).toBe("hello");
    const outside = await withFileRoot(root, () =>
      Effect.runPromise(Effect.flip(fileReadHandler({ path: "/etc/hostname" }))),
    );
    expect(outside.message).toContain("outside the working root");

    for (const def of [fileReadTool, fileWriteTool, fileEditTool]) {
      const doc = pathParam(def);
      // The false blanket claim is gone.
      expect(doc).not.toMatch(/never invent absolute paths/i);
      expect(doc).not.toMatch(/RELATIVE to the working root\./);
      // The true rule: relative -> root; absolute accepted only inside it.
      expect(doc).toMatch(/relative paths resolve against the working root/i);
      expect(doc).toMatch(/absolute path is accepted only if it is inside the working root/i);
      // Harm signal from the audit: models stripped '/' and doubled the root.
      expect(doc).toMatch(/do not strip the leading '\/'/i);
    }
  });
});

// ─── code-execute: host-mode facts measured on the real handler ────────────

const runCode = (code: string, language?: string) =>
  Effect.runPromise(
    codeExecuteHandler({ sandbox: "host" })(
      language === undefined ? { code } : { code, language },
    ),
  ) as Promise<{ executed: boolean; result?: unknown; error?: string }>;

describe("code-execute (host): description matches measured behavior", () => {
  const hostText = modelText(codeExecuteToolFor({ sandbox: "host" }));

  it("fetch exists in the host subprocess, so the docs do not say it is missing", async () => {
    const r = await runCode("return typeof fetch");
    expect(r.result).toBe("function");
    expect(hostText).not.toMatch(/No browser APIs \(DOMParser, fetch\)/);
    expect(hostText).toMatch(/fetch\(\) is available/);
  });

  it("TypeScript annotations run, so the docs do not say they error", async () => {
    const r = await runCode("const x: number = 2; return x * 2", "typescript");
    expect(r).toMatchObject({ executed: true, result: 4 });
    const plain = await runCode("const y: number = 3; return y");
    expect(plain).toMatchObject({ executed: true, result: 3 });
    expect(hostText).not.toMatch(/annotations will cause a syntax error/);
    expect(hostText).toMatch(/TypeScript syntax/);
  });

  it("working directory is /tmp, not the working root, and the docs say so", async () => {
    const r = await runCode("return process.cwd()");
    expect(await realpath(String(r.result))).toBe(await realpath("/tmp"));
    expect(hostText).toMatch(/working directory is \/tmp/);
    expect(hostText).toMatch(/not the agent's working root/);
  });

  it("host files are readable, so host mode is not described as isolated", async () => {
    const home = homedir();
    const r = await runCode(`return require("node:fs").existsSync(${JSON.stringify(home)})`);
    expect(r.result).toBe(true);
    // The only "isolated" in host text is the negation.
    expect(hostText.replaceAll("NOT isolated", "")).not.toMatch(/isolated/i);
    expect(hostText).toMatch(/NOT isolated/);
  });

  it("docker mode text claims isolation and no network; host text does not", () => {
    const dockerText = modelText(codeExecuteToolFor({ sandbox: "docker" }));
    expect(dockerText).toMatch(/isolated/);
    expect(dockerText).toMatch(/no network/i);
    expect(dockerText).not.toMatch(/fetch\(\) is available/);
  });

  it("the default export renders from the same resolution as the default handler", () => {
    const resolved = process.env.RA_SANDBOX === "docker" ? "docker" : "host";
    expect(codeExecuteTool.description).toBe(codeExecuteToolFor({ sandbox: resolved }).description);
  });
});

// ─── discover-tools: no phantom "## Skills section" ────────────────────────

describe("discover-tools: no claim about a Skills section", () => {
  it("neither the description nor any handler output cites a ## Skills section", async () => {
    expect(modelText(discoverToolsTool)).not.toMatch(/## Skills/);
    expect(modelText(discoverToolsTool)).not.toMatch(/system prompt/);
    const ref = await Effect.runPromise(Ref.make(new Set<string>()));
    const handler = makeDiscoverToolsHandler({
      getAllToolDefinitions: () => [
        { name: "file-write", description: "Write a file.", parameters: [] },
      ],
      discoveredRef: ref,
    });
    for (const args of [{}, { query: "zzqq nothing" }, { query: "file-write" }]) {
      const out = String(await Effect.runPromise(handler(args)));
      expect(out).not.toMatch(/## Skills/);
      expect(out).not.toMatch(/system prompt/);
    }
  });
});

// ─── find: relate / recall / builder names only when true ──────────────────

describe("find: description renders only registered companions", () => {
  it("default definition names no relate, recall, or builder API", () => {
    const text = modelText(findTool);
    expect(text).not.toMatch(/relate\(/);
    expect(text).not.toMatch(/recall\(/);
    expect(text).not.toMatch(/withDocuments|agent\.ingest/);
    expect(text).toMatch(/storedAs/);
  });

  it("relate and recall are named only when the caller says they are registered", () => {
    const both = modelText(findToolFor({ relate: true, recall: true }));
    expect(both).toMatch(/relate\(id\)/);
    expect(both).toMatch(/recall\(/);
    const relateOnly = modelText(findToolFor({ relate: true }));
    expect(relateOnly).toMatch(/relate\(id\)/);
    expect(relateOnly).not.toMatch(/recall\(/);
  });
});

// ─── find: the web scope is offered only when web is really searched ───────

describe("find: web scope truth", () => {
  const noWebState = { recallStoreRef: Ref.unsafeMake(new Map<string, string>()), ragStore: new Map(), config: {} };

  it("without a web source, the description drops the web scope and the web fallback", () => {
    const text = modelText(findToolFor(findDescriptionFor(noWebState)));
    expect(text).not.toMatch(/'web'/);
    expect(text).not.toMatch(/falls back to web/);
    expect(text).toMatch(/no web fallback/);
  });

  it("webFallback: false keeps the web scope but drops the auto fallback claim", () => {
    const text = modelText(findToolFor({ web: true, webFallback: false }));
    expect(text).toMatch(/scope 'web'/);
    expect(text).not.toMatch(/falls back to web/);
  });

  it("the default (web wired, fallback on) is unchanged", () => {
    const text = modelText(findTool);
    expect(text).toMatch(/falls back to web if nothing found/);
    expect(text).toMatch(/'auto' \(default\), 'documents', 'web', 'memory', 'all'/);
  });

  it("scope 'web' with no web source says web was not searched", async () => {
    const r = (await Effect.runPromise(makeFindHandler(noWebState)({ query: "x", scope: "web" }))) as {
      sourcesSearched: string[];
      note?: string;
    };
    expect(r.sourcesSearched).not.toContain("web");
    expect(r.note).toMatch(/not available/);
  });

  it("a failing web search is reported, not shown as an empty search", async () => {
    const failing = () => Effect.fail(new ToolExecutionError({ message: "provider down", toolName: "web-search" }));
    const r = (await Effect.runPromise(
      makeFindHandler({ ...noWebState, webSearchHandler: failing })({ query: "x", scope: "web" }),
    )) as { note?: string };
    expect(r.note).toBe("Web search failed: provider down");
  });
});

// ─── docker-execute: definition built from the sandbox config ──────────────

describe("docker-execute: description and timeout follow the config", () => {
  it("default states the default sandbox: no network, read-only fs, 30s", () => {
    const def = dockerExecuteToolFor();
    expect(def.description).toMatch(/Network is disabled/);
    expect(def.description).toMatch(/read-only except \/tmp/);
    expect(def.description).toMatch(/killed after 30s/);
    expect(dockerExecuteTool.description).toBe(def.description);
  });

  it("a networked, writable, 120s config is described as such and not cut at 30s", () => {
    const def = dockerExecuteToolFor({ network: "bridge", readOnlyFs: false, timeoutMs: 120_000, memoryMb: 512 });
    expect(def.description).not.toMatch(/Network is disabled/);
    expect(def.description).toMatch(/Network access is enabled \(Docker network "bridge"\)/);
    expect(def.description).not.toMatch(/read-only/);
    expect(def.description).toMatch(/512 MB memory, killed after 120s/);
    expect(def.timeoutMs).toBe(120_000 + HANDLER_TIMEOUT_GRACE_MS);
  });
});

// ─── web-search: no env var names to the model ─────────────────────────────

describe("web-search: model-facing text carries no operator config", () => {
  it("description names no API-key env var", () => {
    expect(modelText(webSearchTool)).not.toMatch(/_API_KEY/);
  });

  it("exhaustion error omits env var names; the developer-facing cause keeps them", async () => {
    const keys = ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY", "SERPER_API_KEY", "KEENABLE_API_KEY"];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    const originalFetch = globalThis.fetch;
    for (const k of keys) delete process.env[k];
    process.env.TAVILY_API_KEY = "tv-bad";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      const err = await Effect.runPromise(Effect.flip(webSearchHandler({ query: "zzz" })));
      expect(err.message).toContain("zzz");
      expect(err.message).not.toMatch(/_API_KEY/);
      expect(err.message).toMatch(/try a different query/i);
      const raw = err.cause as { cause?: unknown };
      expect(String(raw.cause)).toContain("BRAVE_SEARCH_API_KEY");
    } finally {
      globalThis.fetch = originalFetch;
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
