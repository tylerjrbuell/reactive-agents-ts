import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { httpGetHandler } from "../src/skills/http-client.js";
import { fileReadHandler, fileWriteHandler } from "../src/skills/file-operations.js";
import { webSearchHandler } from "../src/skills/web-search.js";
import { codeExecuteHandler } from "../src/skills/code-execution.js";

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

  it("webSearchHandler returns stub when no API key", async () => {
    // Ensure no API key is set
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const result = await Effect.runPromise(
        webSearchHandler({ query: "test query" }),
      );

      const typed = result as { query: string; results: unknown[]; error: string };
      expect(typed.query).toBe("test query");
      expect(typed.results).toEqual([]);
      expect(typed.error).toContain("TAVILY_API_KEY");
    } finally {
      if (original) process.env.TAVILY_API_KEY = original;
    }
  });

  it("codeExecuteHandler returns stub response", async () => {
    const result = await Effect.runPromise(
      codeExecuteHandler({ code: "console.log('hello')" }),
    );

    const typed = result as { code: string; executed: boolean; message: string };
    expect(typed.code).toBe("console.log('hello')");
    expect(typed.executed).toBe(false);
    expect(typed.message).toContain("stub");
  });
});
