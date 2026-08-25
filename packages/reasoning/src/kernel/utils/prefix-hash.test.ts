import { describe, expect, it } from "bun:test";
import { hashPromptPrefix, hashToolSurface } from "./prefix-hash.js";

describe("hashPromptPrefix", () => {
  it("is stable for identical input", () => {
    expect(hashPromptPrefix("you are a helpful agent")).toBe(
      hashPromptPrefix("you are a helpful agent"),
    );
  });

  it("changes when one character changes", () => {
    expect(hashPromptPrefix("Remaining steps: 4")).not.toBe(
      hashPromptPrefix("Remaining steps: 3"),
    );
  });

  it("returns a 16-char hex string, never empty, for undefined input", () => {
    const h = hashPromptPrefix(undefined);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("hashToolSurface", () => {
  it("is stable for the same tools in the same order", () => {
    expect(hashToolSurface(["file-read", "file-write"])).toBe(
      hashToolSurface(["file-read", "file-write"]),
    );
  });

  it("is ORDER SENSITIVE — reordering breaks the Anthropic cache prefix", () => {
    expect(hashToolSurface(["file-read", "file-write"])).not.toBe(
      hashToolSurface(["file-write", "file-read"]),
    );
  });

  it("changes when a tool is added", () => {
    expect(hashToolSurface(["file-read"])).not.toBe(
      hashToolSurface(["file-read", "recall"]),
    );
  });

  it("does not collide between a joined name and two names", () => {
    // A naive join(",") makes ["a,b"] and ["a","b"] hash identically.
    expect(hashToolSurface(["a,b"])).not.toBe(hashToolSurface(["a", "b"]));
  });

  it("returns a 16-char hex string for undefined input", () => {
    expect(hashToolSurface(undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});
