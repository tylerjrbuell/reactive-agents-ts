// Run: bun test packages/reasoning/tests/kernel/abstention-names-its-cause.test.ts
//
// F7 (2026-07-28) — an honest abstention told the user nothing about WHY.
//
// `decideForcedAbstention` has always computed a specific cause ("no successful
// tool call for required tools (web-search); could not ground an answer in
// available evidence") and stashed it in `meta.abstention.reason`. Nothing
// rendered it. Every forced abstention therefore reached the user as the same
// sentence naming no cause, on any task, from any trigger.
//
// Measured live (haiku-4.5, "population of the fictional city of Aetheria",
// required web-search): the run declined correctly and reported
//   "Could not complete the task — no grounded answer could be produced from the
//    available tools."
// while the identical run WITHOUT a required tool kept the model's own far more
// useful "I was unable to find information about Aetheria through web search."
//
// WHY THE FIX IS A `Cause:` SUFFIX AND NOT THE MODEL'S TEXT. The obvious repair
// — surface the model's decline instead of the sentinel — is wrong here. The two
// forced-abstention triggers are "a required tool was unavailable" and "the
// model's synthesis was REJECTED as ungrounded". Promoting the rejected
// synthesis to output would undo the rejection and re-open the dishonest-success
// hole closed on 2026-07-22. The harness's own reason string carries no
// model-authored content, so it adds information at zero fabrication risk.
//
// RED-ON-CUT: drop the `detail` argument at the `sentinelDeliverable(...)` call
// in runner.ts / iterate-pass.ts, or drop the ` Cause: …` suffix in
// deliverable.ts — the first cell fails.
import { describe, it, expect } from "bun:test";
import { deliverableToContent, sentinelDeliverable } from "@reactive-agents/core";

describe("a forced abstention names its cause", () => {
  it("renders the harness's own reason string", () => {
    const d = sentinelDeliverable(
      "no_substantive_output",
      "no successful tool call for required tools (web-search); could not ground an answer in available evidence",
    );

    const text = deliverableToContent(d);

    expect(text).toContain("Could not complete the task");
    // The load-bearing half: the cause has to survive to the user.
    expect(text).toContain("web-search");
    expect(text).toContain("Cause:");
  });

  it("model-initiated abstention carries its cause too", () => {
    const text = deliverableToContent(
      sentinelDeliverable("model-abstained", "evidence contradicted the premise"),
    );

    expect(text).toContain("Declined to answer");
    expect(text).toContain("evidence contradicted the premise");
  });

  it("without a cause the historical text is byte-identical", () => {
    // Every pre-2026-07-28 pin on these strings still has to hold — the detail
    // is additive, not a rewrite. Without this cell the fix could silently
    // change the no-detail wording and nothing would notice.
    expect(deliverableToContent(sentinelDeliverable("no_substantive_output"))).toBe(
      "Could not complete the task — no grounded answer could be produced from the available tools.",
    );
    expect(deliverableToContent(sentinelDeliverable("model-abstained"))).toBe(
      "Declined to answer — the available evidence was insufficient to ground a response.",
    );
  });

  it("does not carry model-authored content into the deliverable", () => {
    // Pins the design decision above. If someone later "improves" this by
    // routing the rejected synthesis in as `detail`, this cell is the tripwire:
    // the sentinel path must stay harness-authored.
    const d = sentinelDeliverable("no_substantive_output", "required tool unavailable");
    expect(deliverableToContent(d)).not.toContain("Aetheria");
  });
});
