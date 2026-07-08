import { describe, it, expect } from "bun:test";
import {
  resolveProduces,
  extractArtifactFacts,
} from "../../src/artifacts/artifact-contract.js";

describe("artifact-contract — produces resolution (declaration-driven, kills the 4-name heuristic)", () => {
  it("resolves file-producing builtins to 'file' from their declarations", () => {
    expect(resolveProduces("file-write")).toBe("file");
    expect(resolveProduces("code-execute")).toBe("file");
    expect(resolveProduces("shell-execute")).toBe("file");
  });

  it("resolves read-only / data builtins correctly", () => {
    expect(resolveProduces("file-read")).toBe("none");
    expect(resolveProduces("web-search")).toBe("data");
    expect(resolveProduces("http-get")).toBe("data");
  });

  it("defaults unknown / MCP tools to 'data' (safe false-UNMET direction)", () => {
    expect(resolveProduces("some-mcp-server/write-thing")).toBe("data");
    expect(resolveProduces("totally-unknown-tool")).toBe("data");
  });
});

describe("artifact-contract — path extraction per builtin", () => {
  it("file-write: extracts the written path from the path arg, op=write", () => {
    const facts = extractArtifactFacts("file-write", {
      path: "./out/report.md",
      content: "hello world",
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.path).toBe("./out/report.md");
    expect(facts[0]!.op).toBe("write");
    // A cheap digest is derivable from the content arg.
    expect(typeof facts[0]!.digest).toBe("string");
  });

  it("file-write: honors path-key aliases (file_path, dest, ...)", () => {
    expect(extractArtifactFacts("file-write", { file_path: "a.txt", content: "x" })[0]!.path).toBe("a.txt");
    expect(extractArtifactFacts("file-write", { dest: "b.txt", content: "y" })[0]!.path).toBe("b.txt");
  });

  it("file-write: a non-path arg whose value ends with the path does NOT leak (no digest without content)", () => {
    // content is not a path key — only path keys name the file.
    const facts = extractArtifactFacts("file-write", { path: "note.md", content: "see docs/other.md" });
    expect(facts.map((f) => f.path)).toEqual(["note.md"]);
  });

  it("code-execute: extracts files written by fs calls in the code (the 01-F1 fix)", () => {
    const code = [
      "const fs = require('fs');",
      "fs.writeFileSync('data.json', JSON.stringify({a:1}));",
      "fs.appendFileSync('log.txt', 'line\\n');",
    ].join("\n");
    const facts = extractArtifactFacts("code-execute", { code });
    const byPath = Object.fromEntries(facts.map((f) => [f.path, f.op]));
    expect(byPath["data.json"]).toBe("write");
    expect(byPath["log.txt"]).toBe("append");
  });

  it("code-execute: recognizes fs.promises.writeFile and Bun.write", () => {
    const code = [
      "await fs.promises.writeFile(\"async.txt\", 'x');",
      "await Bun.write('bun-out.bin', buf);",
    ].join("\n");
    const paths = extractArtifactFacts("code-execute", { code }).map((f) => f.path).sort();
    expect(paths).toEqual(["async.txt", "bun-out.bin"]);
  });

  it("code-execute: pure computation (no fs) produces no artifacts", () => {
    expect(extractArtifactFacts("code-execute", { code: "return 2 + 2;" })).toEqual([]);
  });

  it("shell-execute: extracts redirect targets (> write, >> append)", () => {
    const facts = extractArtifactFacts("shell-execute", { command: "echo hi > out.txt && cat x >> log.txt" });
    const byPath = Object.fromEntries(facts.map((f) => [f.path, f.op]));
    expect(byPath["out.txt"]).toBe("write");
    expect(byPath["log.txt"]).toBe("append");
  });

  it("read-only / data tools extract nothing regardless of args", () => {
    expect(extractArtifactFacts("file-read", { path: "in.md" })).toEqual([]);
    expect(extractArtifactFacts("web-search", { query: "write a file to disk report.md" })).toEqual([]);
  });
});
