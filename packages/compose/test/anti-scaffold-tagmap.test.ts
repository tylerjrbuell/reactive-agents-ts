/**
 * WS-4 Phase 6 — TagMap anti-scaffold coverage gate
 * ────────────────────────────────────────────────────────────────────────────
 * Master plan §8.1: "Every entry in TagMap / ControllerDecision union /
 * CapabilityRegistry has paired emit + consumer (CI lint)."
 *
 * This file implements the TagMap half of the gate.
 *  - ControllerDecision union is gated by
 *    `packages/reactive-intelligence/tests/controller/decision-coverage.test.ts`
 *    + `…/no-half-implemented-evaluators.test.ts`.
 *  - CapabilityRegistry is gated by
 *    `packages/runtime/tests/harness-profile.test.ts` registry-drift guard.
 *
 * What this test asserts
 * ──────────────────────
 *   For every tag in `ALL_TAGS` (runtime constant exported from
 *   @reactive-agents/core), the production source surface (packages/<*>/src,
 *   apps/<*>/src) must contain at least one EMIT site AND at least one
 *   CONSUMER site, using explicit-literal tag references only (wildcard
 *   patterns are not counted — they would hide gaps).
 *
 * Why receiver-based disambiguation of `.transform`
 * ─────────────────────────────────────────────────
 *   `pipeline.transform(tag, defaultValue, ctx)` (3-arg, called on the runtime
 *   pipeline) is the canonical EMIT pattern for tags whose payload is
 *   transformable (`prompt.system`, `nudge.loop-detected`, `message.tool-result`).
 *   It both fires the tag through registered transforms and produces the
 *   final value used downstream.
 *
 *   `h.transform(pattern, fn)` (2-arg DSL, called on the Harness) is a
 *   CONSUMER registration — it adds a transform handler that pipeline.transform
 *   will invoke at emit time.
 *
 *   Same disambiguation applies to `.emit` (pipeline emits; harness doesn't).
 *
 *   The master plan §8.1 spec text lumped both `.transform` forms under
 *   consumers; this is a doc-side mis-classification. Receiver disambiguates.
 *   Filed as follow-up — see commit body / WS-4 Phase 6 report.
 */

import { describe, it, expect } from 'bun:test';
import { ALL_TAGS } from '@reactive-agents/core';
import type { Tag } from '@reactive-agents/core';
import { Glob } from 'bun';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Workspace roots scanned for production source ────────────────────────────

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * Glob patterns relative to REPO_ROOT. Production source only — tests, dist
 * artifacts, .turbo cache, node_modules are excluded.
 *
 * The runtime constant is colocated with the production code it covers, so the
 * compose package's own src is not scanned to avoid trivially self-satisfying
 * the gate (compose only consumes via pre-built killswitches that take user
 * input — not by hardcoding tag literals).
 */
const PROD_GLOBS = [
  'packages/*/src/**/*.ts',
  'apps/*/src/**/*.ts',
  'apps/*/index.ts',
] as const;

const EXCLUDE_FRAGMENTS = [
  '/dist/',
  '/node_modules/',
  '/.turbo/',
  '/.svelte-kit/',
  '/test/',
  '/tests/',
  '/__tests__/',
] as const;

// ── Signature builders ───────────────────────────────────────────────────────

/**
 * Build a regex matching emit-site invocations for an exact tag literal.
 *
 * Receiver-based discrimination of `.transform`:
 *   - any *.transform with `pipeline`-shaped receiver (incl. obfuscated
 *     names like `_hPipeline`, `harnessPipeline`) counts as EMIT
 *   - `h.transform` / `harness.transform` (DSL) does NOT count as emit
 *
 * Quoting accepts single, double, and backtick literals.
 */
function buildEmitRegex(tag: Tag): RegExp {
  // Tag literal — quoted with ' or " or `
  const tagLit = `(?:'${tag}'|"${tag}"|\\\`${tag}\\\`)`;

  // Receiver names that denote a runtime pipeline (3-arg transform = emit)
  // Anchored with a non-word boundary so `myharnessPipeline.transform(…)` is
  // captured (harness-name-prefixed pipelines are still pipelines).
  const pipelineReceiver = '(?:\\b\\w*[Pp]ipeline\\b)';

  // 1. emitToCompose(<pipeline>, <tag>, …)
  //    First positional may be any identifier; tag is the 2nd arg.
  const emitToCompose = `\\bemitToCompose\\s*\\(\\s*[\\w$.\\[\\]]+\\s*,\\s*${tagLit}`;

  // 2. <pipeline>.emit(<tag>, …)
  const pipelineEmit = `${pipelineReceiver}\\s*\\.\\s*emit\\s*\\(\\s*${tagLit}`;

  // 3. <pipeline>.transform(<tag>, …) — runtime EMIT pattern
  const pipelineTransform = `${pipelineReceiver}\\s*\\.\\s*transform\\s*\\(\\s*${tagLit}`;

  return new RegExp(`(?:${emitToCompose}|${pipelineEmit}|${pipelineTransform})`, 'g');
}

/**
 * Build a regex matching consumer-site registrations for an exact tag literal.
 *
 *   - <harness>.tap(<tag>, fn)
 *   - <harness>.transform(<tag>, fn)        ← 2-arg DSL on harness, NOT pipeline
 *   - <harness>.on(<tag>, fn)
 *
 * `<harness>` is `h` / `harness` / `reg` (the common short names from
 * `withHarness((h) => …)` and `RegistrationHarness` doc convention).
 *
 * Wildcards (`**`, `tag.*`) are deliberately excluded — they would silently
 * mask a missing explicit consumer, which is the exact failure mode the gate
 * is designed to catch.
 */
function buildConsumerRegex(tag: Tag): RegExp {
  const tagLit = `(?:'${tag}'|"${tag}"|\\\`${tag}\\\`)`;

  // Harness-shaped receivers. We intentionally exclude pipeline receivers
  // here so `pipeline.transform(<tag>)` is counted as emit, not consumer.
  const harnessReceiver = '(?:\\b(?:h|harness|reg|registration|registrationHarness)\\b)';

  const tap = `${harnessReceiver}\\s*\\.\\s*tap\\s*\\(\\s*${tagLit}`;
  const transform = `${harnessReceiver}\\s*\\.\\s*transform\\s*\\(\\s*${tagLit}`;
  const on = `${harnessReceiver}\\s*\\.\\s*on\\s*\\(\\s*${tagLit}`;

  return new RegExp(`(?:${tap}|${transform}|${on})`, 'g');
}

// ── File walker ──────────────────────────────────────────────────────────────

async function collectProductionFiles(): Promise<readonly string[]> {
  const seen = new Set<string>();
  for (const pattern of PROD_GLOBS) {
    const glob = new Glob(pattern);
    for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true, dot: false })) {
      const abs = join(REPO_ROOT, rel);
      if (EXCLUDE_FRAGMENTS.some((frag) => abs.includes(frag))) continue;
      seen.add(abs);
    }
  }
  return [...seen].sort();
}

interface TagCounts {
  emit: number;
  consumer: number;
  emitFiles: string[];
  consumerFiles: string[];
}

async function countTagSurface(
  files: readonly string[],
  tags: readonly Tag[],
): Promise<Map<Tag, TagCounts>> {
  const result = new Map<Tag, TagCounts>();
  for (const t of tags) {
    result.set(t, { emit: 0, consumer: 0, emitFiles: [], consumerFiles: [] });
  }
  const emitRe = new Map(tags.map((t) => [t, buildEmitRegex(t)] as const));
  const consumerRe = new Map(tags.map((t) => [t, buildConsumerRegex(t)] as const));

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const tag of tags) {
      const e = emitRe.get(tag)!;
      const c = consumerRe.get(tag)!;
      // Reset stateful regex
      e.lastIndex = 0;
      c.lastIndex = 0;
      const eMatches = content.match(e);
      const cMatches = content.match(c);
      const slot = result.get(tag)!;
      if (eMatches && eMatches.length > 0) {
        slot.emit += eMatches.length;
        slot.emitFiles.push(file);
      }
      if (cMatches && cMatches.length > 0) {
        slot.consumer += cMatches.length;
        slot.consumerFiles.push(file);
      }
    }
  }
  return result;
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe('WS-4 Phase 6 — TagMap anti-scaffold coverage gate', () => {
  it('ALL_TAGS is exported as a runtime iterable from @reactive-agents/core', () => {
    expect(Array.isArray(ALL_TAGS) || (ALL_TAGS as unknown) instanceof Array || typeof ALL_TAGS[Symbol.iterator] === 'function').toBe(true);
    expect(ALL_TAGS.length).toBeGreaterThan(0);
  });

  it('every TagMap entry has at least one production emit site AND one production consumer site', async () => {
    const files = await collectProductionFiles();
    expect(files.length).toBeGreaterThan(0);

    const counts = await countTagSurface(files, ALL_TAGS);

    // Build a human-readable report so a failing CI run shows exactly which
    // tag(s) regressed and which side (emit vs consumer) the gap is on.
    const lines: string[] = [];
    const failures: string[] = [];
    for (const tag of ALL_TAGS) {
      const c = counts.get(tag)!;
      lines.push(`  ${tag.padEnd(32)} emit=${c.emit}  consumer=${c.consumer}`);
      if (c.emit < 1) failures.push(`${tag}: emit=${c.emit} (need ≥1)`);
      if (c.consumer < 1) failures.push(`${tag}: consumer=${c.consumer} (need ≥1)`);
    }

    if (failures.length > 0) {
      const report = [
        'TagMap coverage gate FAILED — one or more tags missing emit or consumer:',
        ...failures.map((f) => `  - ${f}`),
        '',
        'Per-tag baseline:',
        ...lines,
      ].join('\n');
      throw new Error(report);
    }

    // Soft warning lane: ratify floor counts so a future regression that drops
    // a tag to exactly 1/1 is still visible in test output.
    if (process.env['TAGMAP_BASELINE_VERBOSE'] === '1') {
      // eslint-disable-next-line no-console
      console.log(['TagMap baseline (scanned ' + files.length + ' files):', ...lines].join('\n'));
    }

    // All assertions: positive floor per side.
    for (const tag of ALL_TAGS) {
      const c = counts.get(tag)!;
      expect(c.emit, `tag=${tag} expected emit ≥ 1`).toBeGreaterThanOrEqual(1);
      expect(c.consumer, `tag=${tag} expected consumer ≥ 1`).toBeGreaterThanOrEqual(1);
    }
  });
});
