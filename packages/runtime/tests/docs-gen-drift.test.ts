// Run: bun test packages/runtime/tests/docs-gen-drift.test.ts
//
// DOCS DRIFT-GATE (spec §4/Q8): the generated reference tables in apps/docs must
// equal a fresh generation from the single source (AgentConfigSchema + builder
// prototype). Hand-editing a generated block, or changing the schema/withers
// without running `bun run docs:gen:api`, makes this RED.
//
// MUTATION PROOF: edit any row inside a `<!-- BEGIN GENERATED … -->` block →
// this test fails; re-run `bun run docs:gen:api` → green.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GENERATED_BLOCKS, replaceBlock } from "../src/capability/docs-gen.js";

const DOCS_ROOT = resolve(import.meta.dir, "../../../apps/docs");

describe("generated docs drift-gate", () => {
  for (const block of GENERATED_BLOCKS) {
    it(`${block.file} block "${block.id}" matches a fresh generation`, () => {
      const path = resolve(DOCS_ROOT, block.file);
      const current = readFileSync(path, "utf8");
      const fresh = replaceBlock(current, block.id, block.render());
      expect(
        current === fresh,
        `Stale generated block "${block.id}" in ${block.file}. ` +
          "Run `bun run docs:gen:api`.",
      ).toBe(true);
    });
  }
});
