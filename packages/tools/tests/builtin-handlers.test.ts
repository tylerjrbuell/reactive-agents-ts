import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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
    // httpbin returns HTML for /html endpoint
    const result = await Effect.runPromise(
      httpGetHandler({ url: "https://httpbin.org/html" }),
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

  it("should error when parent directory does not exist", async () => {
    await setup();
    const filePath = path.join(
      tmpDir,
      "nonexistent-parent",
      "deep",
      "file.txt",
    );

    const result = await Effect.runPromise(
      fileWriteHandler({ path: filePath, content: "will fail" }).pipe(
        Effect.flip,
      ),
    );
    expect(result).toBeInstanceOf(ToolExecutionError);
    expect(result.message).toContain("File write failed");
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
  it("should return error with clear message when no API key", async () => {
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const result = await Effect.runPromise(
        webSearchHandler({ query: "test query" }),
      );
      const typed = result as {
        query: string;
        results: unknown[];
        error: string;
      };
      expect(typed.query).toBe("test query");
      expect(typed.results).toEqual([]);
      expect(typed.error).toContain("TAVILY_API_KEY");
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
    }
  });

  it("should include maxResults in stub response when no API key", async () => {
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const result = await Effect.runPromise(
        webSearchHandler({ query: "test", maxResults: 3 }),
      );
      const typed = result as { maxResults: number };
      expect(typed.maxResults).toBe(3);
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// code-execute handler
// ═══════════════════════════════════════════════════════════════════════

describe("codeExecuteHandler — behavior", () => {
  it("should return stub with explanation", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log('hello')" }),
    );
    const typed = result as {
      code: string;
      executed: boolean;
      message: string;
    };
    expect(typed.code).toBe("console.log('hello')");
    expect(typed.executed).toBe(false);
    expect(typed.message).toContain("stub");
  });

  it("should accept language parameter", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "let x = 1;", language: "typescript" }),
    );
    const typed = result as { code: string; executed: boolean };
    expect(typed.code).toBe("let x = 1;");
    expect(typed.executed).toBe(false);
  });

  it("codeExecuteTool definition has requiresApproval: true and critical risk", async () => {
    const { codeExecuteTool } = await import("../src/skills/code-execution.js");
    expect(codeExecuteTool.requiresApproval).toBe(true);
    expect(codeExecuteTool.riskLevel).toBe("critical");
  });
});
