// Run: bun test packages/core/tests/sha256.test.ts --timeout 15000
//
// core's synchronous sha256 must be byte-identical to node:crypto: media
// summaries hash with it and their 12-char prefix must match llm-provider's
// `[image:<media_type>:<sha256-12>]` placeholder (hashed with node:crypto).
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../src/utils/sha256.js";

const nodeSha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex", () => {
  it("matches the FIPS empty-string and 'abc' vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches node:crypto across block boundaries, multibyte UTF-8 and a large base64 payload", () => {
    const inputs = [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "héllo wörld 日本語 🎉",
      "https://x/y.jpg",
      Buffer.from(Uint8Array.from({ length: 200 * 1024 }, (_, i) => (i * 31 + 7) % 251)).toString("base64"),
    ];
    for (const s of inputs) expect(sha256Hex(s)).toBe(nodeSha(s));
  });

  it("the core root stays browser-safe: no node: imports in the media modules", () => {
    for (const rel of ["../src/utils/sha256.ts", "../src/types/content-summary.ts"]) {
      expect(readFileSync(join(import.meta.dir, rel), "utf8")).not.toMatch(/from\s+"node:/);
    }
  });
});
