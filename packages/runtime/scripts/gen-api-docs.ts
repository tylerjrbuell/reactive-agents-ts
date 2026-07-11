#!/usr/bin/env bun
/**
 * Generate (or --check) the dual-API reference tables in apps/docs.
 *
 * Usage:
 *   bun run docs:gen:api            # regenerate the marked blocks in place
 *   bun run docs:gen:api --check    # exit 1 if any committed block is stale
 *
 * The generated tables render from the SINGLE source (AgentConfigSchema + the
 * builder prototype) via `capability/docs-gen.ts`. Only the marker-delimited
 * blocks are machine-owned; surrounding prose is preserved. --check is the
 * wire-and-pin: a hand-edited table (or a schema/wither change not regenerated)
 * makes CI go RED.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GENERATED_BLOCKS,
  replaceBlock,
} from "../src/capability/docs-gen.js";
import { correspondenceCoverage } from "../src/capability/api-correspondence.js";

const DOCS_ROOT = resolve(import.meta.dir, "../../../apps/docs");
const check = process.argv.includes("--check");

let drifted = false;
for (const block of GENERATED_BLOCKS) {
  const path = resolve(DOCS_ROOT, block.file);
  const current = readFileSync(path, "utf8");
  const next = replaceBlock(current, block.id, block.render());
  if (next === current) {
    console.log(`✓ ${block.file} — ${block.id} up to date`);
    continue;
  }
  if (check) {
    drifted = true;
    console.error(
      `✗ ${block.file} — block "${block.id}" is STALE. Run \`bun run docs:gen:api\`.`,
    );
  } else {
    writeFileSync(path, next);
    console.log(`↻ ${block.file} — regenerated block "${block.id}"`);
  }
}

const c = correspondenceCoverage();
console.log(
  `correspondence: ${c.configWithers} config withers, ${c.overlayWithers} overlays, ` +
    `${c.coveredLeaves}/${c.schemaLeaves} schema leaves covered, ` +
    `${c.orphanLeaves.length} orphan leaves, ${c.orphanKeys.length} orphan keys.`,
);

if (check && drifted) {
  process.exit(1);
}
