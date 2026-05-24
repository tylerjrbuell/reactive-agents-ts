import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Server } from "bun";

import { httpGetHandler } from "../src/skills/http-client.js";
import {
  fileReadHandler,
  fileWriteHandler,
} from "../src/skills/file-operations.js";
import { webSearchHandler } from "../src/skills/web-search.js";
import { codeExecuteHandler } from "../src/skills/code-execution.js";
import { ToolExecutionError } from "../src/errors.js";

// ─── Temp directory for file tests (under cwd to pass path traversal check) ───

const tmpDir = path.join(process.cwd(), ".tmp-handler-test-" + Date.now());

const setup = async () => {
  await fs.mkdir(tmpDir, { recursive: true });
};
const cleanup = async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
};

afterAll(cleanup);

// GH #103: local fixture replaces httpbin.org. The hosted endpoint was a
// recurring CI flake (network jitter / cold start / rate limit / TLS
// handshake variance routinely exceeded the 5s test timeout). A tiny
// in-process server is deterministic (~1ms latency) and removes the
// third-party dependency.
let httpFixture: Server | undefined;
let fixtureBaseUrl = "";

beforeAll(() => {
  httpFixture = Bun.serve({
    port: 0, // OS-assigned ephemeral port
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/html") {
        return new Response(
          "<!DOCTYPE html><html><body><h1>fixture</h1></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      if (url.pathname === "/get") {
        return new Response(JSON.stringify({ url: req.url, ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  fixtureBaseUrl = `http://localhost:${httpFixture.port}`;
});

afterAll(() => {
  httpFixture?.stop();
});

// ═══════════════════════════════════════════════════════════════════════
// http-get handler
// ═══════════════════════════════════════════════════════════════════════

describe("httpGetHandler — error cases", () => {
  it("should fail on invalid URL", async () => {
    const result = await Effect.runPromise(
      httpGetHandler({ url: "not-a-url" }).pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.toolName).toBe("http-get");
  });

  it("should fail on non-existent domain", async () => {
    const result = await Effect.runPromise(
      httpGetHandler({ url: "https://this-domain-does-not-exist-xyz123.com" }).pipe(
        Effect.flip,
      ),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.message).toContain("HTTP GET failed");
  });

  it("should handle non-JSON response bodies as text", async () => {
    // Local Bun.serve fixture (see beforeAll) returns HTML at /html.
    const result = await Effect.runPromise(
      httpGetHandler({ url: `${fixtureBaseUrl}/html` }),
    );
    const typed = result as { status: number; body: unknown };
    expect(typed.status).toBe(200);
    // Body should be a string (text), not parsed JSON
    expect(typeof typed.body).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// file-read handler
// ═══════════════════════════════════════════════════════════════════════

describe("fileReadHandler — error cases", () => {
  it("should fail on file not found", async () => {
    const result = await Effect.runPromise(
      fileReadHandler({ path: path.join(process.cwd(), "nonexistent-file-xyz.txt") }).pipe(
        Effect.flip,
      ),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.message).toContain("File read failed");
  });

  it("should block path traversal (parent directory escape)", async () => {
    const result = await Effect.runPromise(
      fileReadHandler({ path: "../../../etc/passwd" }).pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.message).toContain("Path traversal");
  });

  it("should return empty string for empty file", async () => {
    await setup();
    const emptyFile = path.join(tmpDir, "empty.txt");
    await fs.writeFile(emptyFile, "");

    const result = await Effect.runPromise(fileReadHandler({ path: emptyFile }));
    expect(result).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// file-write handler
// ═══════════════════════════════════════════════════════════════════════

describe("fileWriteHandler — error cases", () => {
  it("should block path traversal", async () => {
    const result = await Effect.runPromise(
      fileWriteHandler({
        path: "../../../tmp/evil-file.txt",
        content: "pwned",
      }).pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.message).toContain("Path traversal");
  });

  it("should write to nested directory if parent exists", async () => {
    await setup();
    const nestedDir = path.join(tmpDir, "sub");
    await fs.mkdir(nestedDir, { recursive: true });
    const filePath = path.join(nestedDir, "nested-write.txt");

    const result = await Effect.runPromise(
      fileWriteHandler({ path: filePath, content: "nested content" }),
    );
    const typed = result as { written: boolean; path: string };
    expect(typed.written).toBe(true);

    const contents = await fs.readFile(filePath, "utf-8");
    expect(contents).toBe("nested content");
  });

  it("should create missing parent directories and write the file", async () => {
    await setup();
    const filePath = path.join(
      tmpDir,
      "nonexistent-parent",
      "deep",
      "file.txt",
    );

    const result = await Effect.runPromise(
      fileWriteHandler({ path: filePath, content: "created" }),
    );
    const typed = result as { written: boolean; path: string };
    expect(typed.written).toBe(true);
    const contents = await fs.readFile(filePath, "utf-8");
    expect(contents).toBe("created");
  });

  it("fileWriteTool definition has requiresApproval: true", async () => {
    const { fileWriteTool } = await import("../src/skills/file-operations.js");
    expect(fileWriteTool.requiresApproval).toBe(true);
    expect(fileWriteTool.riskLevel).toBe("high");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// web-search handler
// ═══════════════════════════════════════════════════════════════════════

describe("webSearchHandler — error cases", () => {
  const originalFetch = globalThis.fetch;

  it("should fail when no keys and DuckDuckGo returns no results", async () => {
    const origTavily = process.env.TAVILY_API_KEY;
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
      expect(result.message).toContain("BRAVE_SEARCH_API_KEY");
    } finally {
      globalThis.fetch = originalFetch;
      if (origTavily) process.env.TAVILY_API_KEY = origTavily;
      if (origBrave) process.env.BRAVE_SEARCH_API_KEY = origBrave;
      if (origBraveAlt) process.env.BRAVE_API_KEY = origBraveAlt;
    }
  });

  it("should fail with maxResults when no keys and DDG empty", async () => {
    const origTavily = process.env.TAVILY_API_KEY;
    const origBrave = process.env.BRAVE_SEARCH_API_KEY;
    const origBraveAlt = process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_API_KEY;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({ RelatedTopics: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    try {
      const result = await Effect.runPromise(
        webSearchHandler({ query: "test", maxResults: 3 }).pipe(Effect.flip),
      );
      expect(result).toBeInstanceOf(ToolExecutionError);
      expect(result.message).toContain("http-get");
    } finally {
      globalThis.fetch = originalFetch;
      if (origTavily) process.env.TAVILY_API_KEY = origTavily;
      if (origBrave) process.env.BRAVE_SEARCH_API_KEY = origBrave;
      if (origBraveAlt) process.env.BRAVE_API_KEY = origBraveAlt;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// code-execute handler
// ═══════════════════════════════════════════════════════════════════════

describe("codeExecuteHandler — subprocess isolation", () => {
  it("should execute code in subprocess and return result", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log(6 * 7)" }),
    );
    const typed = result as {
      executed: boolean;
      result: unknown;
      output: string;
      exitCode: number;
    };
    expect(typed.executed).toBe(true);
    // console.log() output is captured in `output`; `result` is null when there is no `return`
    expect(typed.output).toBe("42");
    expect(typed.exitCode).toBe(0);
  });

  it("should capture multi-line output", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: 'console.log("hello"); console.log("world");' }),
    );
    const typed = result as { executed: boolean; output: string };
    expect(typed.executed).toBe(true);
    expect(typed.output).toContain("hello");
    expect(typed.output).toContain("world");
  });

  it("should report errors for invalid code", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "throw new Error('boom')" }),
    );
    const typed = result as { executed: boolean; error?: string; exitCode: number };
    expect(typed.executed).toBe(false);
    // The async wrapper catches thrown errors and reports them; exitCode is 0
    // because the process itself exits cleanly after printing the error JSON.
    expect(typeof typed.error).toBe("string");
    expect(typed.error).toContain("boom");
  });

  it("runs in isolated env with no leaked secrets", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log(JSON.stringify(Object.keys(process.env)))" }),
    );
    const typed = result as { executed: boolean; output: string };
    expect(typed.executed).toBe(true);
    // console.log output is captured in `output` as a string; parse it to inspect keys.
    // Subprocess gets minimal env (PATH + HOME only); Bun may add internal vars,
    // but no application secrets should leak through.
    const envKeys = JSON.parse(typed.output) as string[];
    expect(envKeys).not.toContain("ANTHROPIC_API_KEY");
    expect(envKeys).not.toContain("OPENAI_API_KEY");
    expect(envKeys).not.toContain("TAVILY_API_KEY");
    expect(envKeys).not.toContain("GOOGLE_API_KEY");
    // PATH and HOME are the only intentionally passed vars
    expect(envKeys).toContain("PATH");
    expect(envKeys).toContain("HOME");
  });

  it("codeExecuteTool definition has requiresApproval: true and critical risk", async () => {
    const { codeExecuteTool } = await import("../src/skills/code-execution.js");
    expect(codeExecuteTool.requiresApproval).toBe(true);
    expect(codeExecuteTool.riskLevel).toBe("critical");
  });
});
