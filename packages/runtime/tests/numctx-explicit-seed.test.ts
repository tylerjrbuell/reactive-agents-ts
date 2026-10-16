// Run: bun test packages/runtime/tests/numctx-explicit-seed.test.ts --timeout 15000
/**
 * GH #241 producer seam (second half): `createRuntime` /
 * `buildLightRuntimeConfig` must seed `contextProfile.explicitNumCtx` from
 * `options.numCtx` (the `.withModel({ numCtx })` value, threaded via
 * `runtime-construction.ts:454` → `createRuntime({ numCtx })`).
 *
 * The kernel-warden consumer (`resolveEffectiveNumCtx()` = explicit ??
 * maxTokens in `@reactive-agents/reasoning`, read by think.ts for the guard
 * preflight ceiling and demand-bucket cap) is a safe no-op until this
 * producer threads the field — these tests pin the threading.
 *
 * Seams:
 *  - `buildLightRuntimeConfig` is pure and exported, so the light path is
 *    pinned directly (same pattern as sub-agent-light-config.test.ts). The
 *    full `createRuntime` seed site carries character-identical logic;
 *    grep (`explicitNumCtx.*options.numCtx`) confirms both sites.
 */
import { describe, it, expect } from "bun:test";
import { buildLightRuntimeConfig } from "../src/runtime.js";

const base = {
  agentId: "numctx-seed-probe",
  provider: "test" as const,
};

describe("numCtx seeds contextProfile.explicitNumCtx (GH #241 producer)", () => {
  it("numCtx with no profile seeds both maxTokens and explicitNumCtx", () => {
    const config = buildLightRuntimeConfig({ ...base, numCtx: 65_536 });
    expect(config.contextProfile?.maxTokens).toBe(65_536);
    // RED before the fix: nothing sets this field, so it is undefined.
    expect(config.contextProfile?.explicitNumCtx).toBe(65_536);
  });

  it("absent numCtx leaves the profile untouched (no phantom field)", () => {
    const config = buildLightRuntimeConfig({ ...base });
    expect(config.contextProfile).toBeUndefined();

    const profile = { maxTokens: 4096 } as const;
    const withProfile = buildLightRuntimeConfig({ ...base, contextProfile: { ...profile } });
    expect(withProfile.contextProfile?.maxTokens).toBe(4096);
    expect(withProfile.contextProfile?.explicitNumCtx).toBeUndefined();
  });

  it("an explicit profile maxTokens still wins, but explicitNumCtx tracks numCtx", () => {
    const config = buildLightRuntimeConfig({
      ...base,
      numCtx: 65_536,
      contextProfile: { maxTokens: 4096 },
    });
    expect(config.contextProfile?.maxTokens).toBe(4096);
    expect(config.contextProfile?.explicitNumCtx).toBe(65_536);
  });

  it("an explicit profile explicitNumCtx wins over numCtx (caller override)", () => {
    const config = buildLightRuntimeConfig({
      ...base,
      numCtx: 65_536,
      contextProfile: { maxTokens: 4096, explicitNumCtx: 16_384 },
    });
    expect(config.contextProfile?.explicitNumCtx).toBe(16_384);
    expect(config.contextProfile?.maxTokens).toBe(4096);
  });

  it("invalid numCtx never poisons explicitNumCtx (consumer falls back to maxTokens)", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const config = buildLightRuntimeConfig({ ...base, numCtx: bad });
      expect(config.contextProfile?.explicitNumCtx, `numCtx=${String(bad)}`).toBeUndefined();
    }
  });
});
