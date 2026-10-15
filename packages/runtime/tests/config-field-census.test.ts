// Run: bun test packages/runtime/tests/config-field-census.test.ts --timeout 15000
//
// Wave 6.4 — config-field census (boundary-level prevention). Extends the
// wither-census pattern from builder methods to PUBLIC CONFIG SCHEMA FIELDS:
// every field needs a named non-test consumer or an ALLOWLIST entry with a
// justification + issue link. A newly added field with no row fails CI; a
// removed field with a stale row fails CI.
//
// Scope (bounded, plan-named): gateway policy fields (both mirrors),
// plan-execute strategy fields, RunLedger entry kinds. The docs-phantom
// `patchStrategy` row (documented, never declared) was deleted from
// reasoning.mdx in 6.4, and `verifierTier` was deleted outright in 7.4
// (ladder with no consumer) — docs drift and dead config are census
// casualties, not allowlist entries.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema, SchemaAST } from "effect";
import { PlanExecuteConfigSchema } from "@reactive-agents/reasoning";
import { GatewayConfigSchema } from "../src/agent-config.js";
import { PolicyConfigSchema } from "@reactive-agents/gateway";

type Proof =
  | { readonly status: "PROVEN"; readonly consumer: string }
  | { readonly status: "ALLOWLIST"; readonly justification: string; readonly link: string };

const fieldNames = (schema: Schema.Schema.AnyNoContext): readonly string[] =>
  asStruct(schema.ast).propertySignatures.map((p) => String(p.name));

const asStruct = (type: Schema.Schema.AnyNoContext["ast"]): SchemaAST.TypeLiteral => {
  const ast = type as SchemaAST.TypeLiteral | SchemaAST.Union | SchemaAST.Transformation;
  if (ast._tag === "TypeLiteral") return ast;
  if (ast._tag === "Transformation") {
    // Schemas with defaults/optionalWith wrap the struct in a Transformation
    // — read the field side.
    const from = (ast as SchemaAST.Transformation).from;
    if (from._tag === "TypeLiteral") return from;
  }
  // Schema.optional(...) wraps the struct in a Union — take the object member.
  const member = (ast as SchemaAST.Union).types.find((t) => t._tag === "TypeLiteral");
  if (!member || member._tag !== "TypeLiteral") throw new Error("census expects a struct schema");
  return member;
};

const policiesOf = (schema: Schema.Schema.AnyNoContext, path: string): readonly string[] => {
  const ast = schema.ast;
  if (ast._tag !== "TypeLiteral") throw new Error("census expects a struct schema");
  const prop = (ast as SchemaAST.TypeLiteral).propertySignatures.find((p) => String(p.name) === path);
  if (!prop) throw new Error(`no ${path} on schema`);
  return asStruct(prop.type as Schema.Schema.AnyNoContext["ast"]).propertySignatures.map((p) =>
    String(p.name),
  );
};

const GATEWAY_POLICIES = [
  "dailyTokenBudget",
  "maxActionsPerHour",
  "heartbeatPolicy",
  "mergeWindowMs",
  "requireApprovalFor",
] as const;

const FIELD_PROOF: Readonly<Record<string, Proof>> = {
  // ─── gateway policies (runtime mirror — the enforced route) ───
  "gateway.policies.dailyTokenBudget": {
    status: "PROVEN",
    consumer: "packages/gateway/src/services/gateway-service.ts (cost-budget policy)",
  },
  "gateway.policies.maxActionsPerHour": {
    status: "PROVEN",
    consumer: "packages/gateway/src/services/gateway-service.ts (rate-limit policy)",
  },
  "gateway.policies.heartbeatPolicy": {
    status: "PROVEN",
    consumer: "packages/gateway/src/services/gateway-service.ts (adaptive heartbeat)",
  },
  "gateway.policies.mergeWindowMs": {
    status: "PROVEN",
    consumer: "packages/gateway/src/services/gateway-service.ts (event merging)",
  },
  "gateway.policies.requireApprovalFor": {
    status: "PROVEN",
    consumer: "packages/runtime/src/builder.ts build() merge → kernel approval gate (gateway-approval-wire.test.ts)",
  },
  // ─── gateway package mirror (scheduling-only service; enforcement lives runtime-side) ───
  "gateway-pkg.policies.requireApprovalFor": {
    status: "ALLOWLIST",
    justification:
      "gateway-service never executes tools so the field cannot honestly enforce there; enforcement route is the runtime builder merge (6.1); declaration kept for config-surface compat",
    link: "https://github.com/tylerjrbuell/reactive-agents-ts/issues/247",
  },
  // ─── plan-execute strategy fields ───
  "planExecute.maxRefinements": {
    status: "PROVEN",
    consumer: "packages/reasoning/src/strategies/plan-execute.ts (refine loop)",
  },
  "planExecute.reflectionDepth": {
    status: "PROVEN",
    consumer: "packages/reasoning/src/strategies/plan-execute.ts (reflection prompt budget)",
  },
  "planExecute.stepKernelMaxIterations": {
    status: "PROVEN",
    consumer: "packages/reasoning/src/strategies/plan-execute.ts (derived step budget, 5.5)",
  },
  "planExecute.planMode": {
    status: "PROVEN",
    consumer: "packages/reasoning/src/strategies/plan-execute.ts (linear/dag execution)",
  },
  "planExecute.stepRetries": {
    status: "PROVEN",
    consumer: "packages/reasoning/src/strategies/plan-execute.ts (per-step retry)",
  },
};

const RUN_LEDGER_DIR = join(import.meta.dir, "..", "..", "reasoning", "src", "kernel", "ledger");

const ledgerKinds = (): readonly string[] => {
  const src = readFileSync(join(RUN_LEDGER_DIR, "run-ledger.ts"), "utf8");
  const kinds = [...src.matchAll(/readonly kind: "([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(kinds)];
};

const KIND_PRODUCERS: Readonly<Record<string, string>> = {
  "tool-invocation": "packages/reasoning/src/kernel/ledger/emit.ts (recordToolDispatch)",
  "tool-result": "packages/reasoning/src/kernel/ledger/emit.ts",
  artifact: "packages/reasoning/src/kernel/ledger/artifact-projection.ts",
  requirement: "packages/reasoning/src/kernel/ledger/emit.ts",
  claim: "packages/reasoning/src/kernel/ledger/emit.ts",
  verdict: "packages/reasoning/src/kernel/ledger/emit.ts",
  "harness-signal": "packages/reasoning/src/assembly/gather-dedup.ts + emit.ts",
  handoff: "packages/reasoning/src/kernel/ledger/emit.ts",
  "compaction-marker": "packages/reasoning/src/kernel/ledger/emit.ts",
  "result-truncated": "packages/reasoning/src/kernel/ledger/emit.ts",
};

describe("config-field census (6.4)", () => {
  it("gateway policy fields are exactly the censused set", () => {
    expect([...policiesOf(GatewayConfigSchema, "policies")].sort()).toEqual([...GATEWAY_POLICIES].sort());
    expect([...fieldNames(PolicyConfigSchema)].sort()).toEqual([...GATEWAY_POLICIES].sort());
  });

  it("gateway policy fields each have a proof row", () => {
    for (const f of GATEWAY_POLICIES) {
      expect(FIELD_PROOF[`gateway.policies.${f}`], f).toBeDefined();
    }
    expect(FIELD_PROOF["gateway-pkg.policies.requireApprovalFor"]).toBeDefined();
  });

  it("plan-execute fields are exactly the censused set", () => {
    const fields = fieldNames(PlanExecuteConfigSchema);
    expect([...fields].sort()).toEqual(
      ["maxRefinements", "reflectionDepth", "stepKernelMaxIterations", "planMode", "stepRetries"].sort(),
    );
    for (const f of fields) {
      expect(FIELD_PROOF[`planExecute.${f}`], f).toBeDefined();
    }
  });

  it("every RunLedger kind has a named non-test producer", () => {
    const kinds = ledgerKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) {
      const producer = KIND_PRODUCERS[k];
      expect(producer, `no producer for ledger kind ${k}`).toBeDefined();
      const hits = ["emit.ts", "artifact-projection.ts", "gather-dedup.ts", "run-ledger.ts"].some((f) =>
        (producer as string).includes(f),
      );
      expect(hits, `producer for ${k} is not a non-test source file`).toBe(true);
    }
    for (const k of Object.keys(KIND_PRODUCERS)) {
      expect(kinds, `stale producer row for removed kind ${k}`).toContain(k);
    }
  });

  it("allowlist rows carry justification + issue link", () => {
    for (const [name, proof] of Object.entries(FIELD_PROOF)) {
      if (proof.status !== "ALLOWLIST") continue;
      expect(proof.justification.length, name).toBeGreaterThan(0);
      expect(proof.link.startsWith("https://github.com/tylerjrbuell/reactive-agents-ts/issues/"), name).toBe(true);
    }
  });
});
