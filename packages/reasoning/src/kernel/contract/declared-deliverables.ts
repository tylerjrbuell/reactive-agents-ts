// File: src/kernel/contract/declared-deliverables.ts
//
// Per-item deliverables (Plan 8 L7 / OSS gap G2 "one accept list").
//
// A "do X for each item" run must not be accepted after partial work. Every
// item a run is held to — whoever declared it — compiles to ONE requirement
// shape with a deterministic evidence check:
//   file item → `artifact-produced` + ArtifactProduced (the file exists)
//   tool item → `tool-coverage`     + ToolCalled      (the tool succeeded)
// tagged with a typed `source` (task-explicit | plan-declared | caller-accept).
//
// `deliveryConditions` is the one place the terminal gates (the arbitrator's
// exit-success spine, the exit gate and terminate.ts) widen their stored
// run-start set with the contract's per-item conditions, so an item added after
// compile still blocks "done", and the unmet description names the missing item.
//
// Pure, deterministic, NO LLM, NO fs. Type-only imports from run-contract.ts.

import {
  anchorDeliverablePath,
  artifactProduced,
  toolCalled,
  type PostCondition,
} from "../capabilities/verify/post-conditions.js";
import type {
  DeliverableSource,
  DeliverableSpec,
  RequirementProvenance,
  RunContract,
  TaskRequirement,
} from "./run-contract.js";

/** One item a run must deliver, before it is compiled into the contract. */
export type DeclaredDeliverable =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "tool"; readonly tool: string };

/** The compiled form of one declared item. */
export interface DeclaredItem {
  readonly requirement: TaskRequirement;
  /** Present for file items (the receipt reports it produced | missing). */
  readonly deliverable?: DeliverableSpec;
  readonly condition: PostCondition;
}

/**
 * Compile one item into its requirement (+ deliverable) + PostCondition.
 * The single builder for every source: compileRunContract (`task-explicit`) and
 * addDeclaredDeliverables (later sources) both call it.
 */
export function declaredItem(
  item: DeclaredDeliverable,
  source: DeliverableSource,
  provenance?: RequirementProvenance,
): DeclaredItem {
  const prov = provenance !== undefined ? { provenance } : {};
  if (item.kind === "tool") {
    const condition = toolCalled(item.tool);
    return {
      requirement: {
        id: `tool:${item.tool}`,
        kind: "tool-coverage",
        spec: { description: `call the \`${item.tool}\` tool`, condition, acceptance: "deterministic", source },
        ...prov,
      },
      condition,
    };
  }
  const path = anchorDeliverablePath(item.path);
  const condition = artifactProduced(path);
  const id = `artifact:${path}`;
  return {
    requirement: {
      id,
      kind: "artifact-produced",
      spec: { description: `produce the file ${path}`, condition, acceptance: "deterministic", source },
      ...prov,
    },
    deliverable: { id, kind: "file", matcher: condition, source, ...prov },
    condition,
  };
}

/**
 * The deterministic conditions of the per-item requirements on the contract,
 * optionally restricted to some sources.
 */
export function perItemConditions(
  contract: RunContract | undefined,
  include: (source: DeliverableSource) => boolean = () => true,
): readonly PostCondition[] {
  if (contract === undefined) return [];
  const out: PostCondition[] = [];
  for (const r of contract.requirements) {
    if (r.spec.source !== undefined && r.spec.condition !== undefined && include(r.spec.source)) {
      out.push(r.spec.condition);
    }
  }
  return out;
}

/**
 * The condition set the terminal gates verify: the run-start derived set
 * (`meta.postConditions`) widened with the contract's per-item conditions,
 * de-duplicated, stored set first.
 *
 * Every per-item condition on the contract widens the set, whatever its
 * source. `task-explicit` items come from the same deriver over the same text
 * as the stored set (`deriveConditions`), so they are normally already there;
 * items from the other sources (`plan-declared`, `caller-accept`) were declared
 * FOR this run after compile. A plan-execute step kernel, whose task text
 * carries the parent's goal, is exempted where both sets are derived
 * (`deliveryScope: "step"`, delivery-scope.ts) — never inferred here.
 *
 * Returns the stored set unchanged (same reference, possibly undefined) when
 * nothing is added, so runs without per-item deliverables are byte-identical.
 */
export function deliveryConditions(meta: {
  readonly postConditions?: readonly PostCondition[];
  readonly runContract?: RunContract;
}): readonly PostCondition[] | undefined {
  const base = meta.postConditions;
  const seen = new Set((base ?? []).map((c) => JSON.stringify(c)));
  const extra = perItemConditions(meta.runContract).filter((c) => {
    const key = JSON.stringify(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (extra.length === 0) return base;
  return [...(base ?? []), ...extra];
}
