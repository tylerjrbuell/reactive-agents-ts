import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { httpGetHandler } from "../src/skills/http-client.js";
import { fileReadHandler, fileWriteHandler } from "../src/skills/file-operations.js";
import { webSearchHandler } from "../src/skills/web-search.js";
import { codeExecuteHandler } from "../src/skills/code-execution.js";
import { ToolExecutionError } from "../src/errors.js";
import { builtinTools } from "../src/skills/builtin.js";

describe("builtinTools registration", () => {
  it("does not include scratchpad-write (superseded by recall)", () => {
    const names = builtinTools.map(t => t.definition.name);
    expect(names).not.toContain("scratchpad-write");
  });

  it("does not include scratchpad-read (superseded by recall)", () => {
    const names = builtinTools.map(t => t.definition.name);
    expect(names).not.toContain("scratchpad-read");
  });

  it("does not include rag-search (superseded by find)", () => {
    const names = builtinTools.map(t => t.definition.name);
    expect(names).not.toContain("rag-search");
  });

  it("includes the core capability tools", () => {
    const names = builtinTools.map(t => t.definition.name);
    expect(names).toContain("web-search");
    expect(names).toContain("http-get");
    expect(names).toContain("file-read");
    expect(names).toContain("file-write");
    expect(names).toContain("code-execute");
  });
});

// ─── Temp directory for file tests (under cwd to pass path traversal check) ───

const tmpDir = path.join(process.cwd(), ".tmp-test-" + Date.now());

const setup = async () => {
  await fs.mkdir(tmpDir, { recursive: true });
};
const cleanup = async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
};

afterAll(cleanup);

describe("Built-in Tool Handlers", () => {
  it("httpGetHandler makes a real HTTP call", async () => {
    const result = await Effect.runPromise(
      httpGetHandler({ url: "https://httpbin.org/get" }),
    );

    const typed = result as { status: number; body: unknown };
    expect(typed.status).toBe(200);
    expect(typed.body).toBeDefined();
  });

  it("fileReadHandler reads a real temp file", async () => {
    await setup();
    const filePath = path.join(tmpDir, "test-read.txt");
    await fs.writeFile(filePath, "hello from test");

    const result = await Effect.runPromise(
      fileReadHandler({ path: filePath }),
    );

    expect(result).toBe("hello from test");
  });

  it("fileWriteHandler writes to temp dir", async () => {
    await setup();
    const filePath = path.join(tmpDir, "test-write.txt");

    const result = await Effect.runPromise(
      fileWriteHandler({ path: filePath, content: "written by test" }),
    );

    const typed = result as { written: boolean; path: string };
    expect(typed.written).toBe(true);

    const contents = await fs.readFile(filePath, "utf-8");
    expect(contents).toBe("written by test");
  });

  it("webSearchHandler fails when no keys and DuckDuckGo has no instant answer", async () => {
    const originalFetch = globalThis.fetch;
    const original = process.env.TAVILY_API_KEY;
    const origBrave = process.env.BRAVE_SEARCH_API_KEY;
    const origBraveAlt = process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    try {
      const result = await Effect.runPromise(
        webSearchHandler({ query: "test query" }).pipe(Effect.flip),
      );

      expect(result).toBeInstanceOf(ToolExecutionError);
      expect(result.message).toContain("TAVILY_API_KEY");
    } finally {
      globalThis.fetch = originalFetch;
      if (original) process.env.TAVILY_API_KEY = original;
      if (origBrave) process.env.BRAVE_SEARCH_API_KEY = origBrave;
      if (origBraveAlt) process.env.BRAVE_API_KEY = origBraveAlt;
    }
  });

  it("codeExecuteHandler executes code in subprocess and returns result", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log(2 + 2)" }),
    );

    const typed = result as { executed: boolean; result: unknown; output: string; exitCode: number };
    expect(typed.executed).toBe(true);
    expect(typed.result).toBe(4);
    expect(typed.output).toBe("4");
    expect(typed.exitCode).toBe(0);
  });
});
