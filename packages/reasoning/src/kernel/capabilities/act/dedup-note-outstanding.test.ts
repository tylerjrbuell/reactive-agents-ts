// Run: bun test packages/reasoning/src/kernel/capabilities/act/dedup-note-outstanding.test.ts --timeout 20000
//
// duplicateGuard's note on a repeated identical call must not steer to a
// final answer while work is outstanding. Live repro (targeted H3 at 94f0c9ea5,
// cogito:8b h3-todo-heavy): after `file-read notes-2.txt` the model re-read the
// same file and got "42 [Already done — do NOT repeat. Give FINAL ANSWER if all
// steps are complete.]" with 5 of 6 output files still unwritten. The note now
// names what is outstanding (the exit gate's own list) and keeps "do NOT repeat".
import { describe, expect, it } from "bun:test";
import { duplicateGuard } from "./guard.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { artifactProduced } from "../verify/post-conditions.js";
import { initialKernelState, transitionState, type KernelState } from "../../state/kernel-state.js";
import { makeKernelInput, makeKernelRunOptions } from "../../../testing/kernel-fixtures.js";
import type { ReasoningStep } from "../../../types/index.js";
import { GUARD_OBSERVATION_TAG } from "../../state/kernel-constants.js";

const read = (id: string, path: string, out: string): ReasoningStep[] => [
  makeStep("action", `file-read(${JSON.stringify({ path })})`, {
    toolCall: { id, name: "file-read", arguments: { path } },
  }),
  makeStep("observation", out, {
    toolCallId: id,
    observationResult: makeObservationResult("file-read", true, out),
  }),
];

const options = makeKernelRunOptions({ strategy: "reactive", maxIterations: 14 });
const stateWith = (steps: ReasoningStep[], postConditions: KernelState["meta"]["postConditions"]): KernelState => {
  const base = initialKernelState(options);
  return transitionState(base, { steps, meta: { ...base.meta, postConditions } });
};
const input = makeKernelInput({ task: "Read notes-2.txt and write out-2.txt and out-3.txt." });
const repeat = { id: "c2", name: "file-read", arguments: { path: "notes-2.txt" } };

describe("duplicateGuard note names outstanding work instead of a final answer", () => {
  it("lists the unwritten files and keeps 'do NOT repeat' while deliverables are outstanding", () => {
    const state = stateWith(read("c1", "notes-2.txt", "42"), [
      artifactProduced("./out-2.txt"),
      artifactProduced("./out-3.txt"),
    ]);
    const r = duplicateGuard(repeat, state, input);
    expect(r.pass).toBe(false);
    if (r.pass) return;
    expect(r.observation.startsWith("42 [Already done — do NOT repeat.")).toBe(true);
    expect(r.observation).not.toContain("FINAL ANSWER");
    expect(r.observation).toContain("Still outstanding:");
    expect(r.observation).toContain("out-2.txt");
    expect(r.observation).toContain("out-3.txt");
  });

  it("keeps the final-answer hint when nothing is outstanding", () => {
    const state = transitionState(stateWith(read("c1", "notes-2.txt", "42"), []), {
      steps: [
        ...read("c1", "notes-2.txt", "42"),
        makeStep("thought", "The value in notes-2.txt is 42, so the answer is 42."),
      ],
    });
    const r = duplicateGuard(repeat, state, input);
    expect(r.pass).toBe(false);
    if (r.pass) return;
    expect(r.observation).toContain("[Already done — do NOT repeat.");
    expect(r.observation).not.toContain("Still outstanding:");
  });

  it("still names a missing required tool first (existing contract)", () => {
    const state = stateWith(read("c1", "notes-2.txt", "42"), [artifactProduced("./out-2.txt")]);
    const r = duplicateGuard(repeat, state, makeKernelInput({ task: "x", requiredTools: ["file-write"] }));
    expect(r.pass).toBe(false);
    if (r.pass) return;
    expect(r.observation).toContain("You still need to call: file-write. Do that now.");
    expect(r.observation).not.toContain("FINAL ANSWER");
  });
});

// Live repro (campaign enum, gpt-oss lh-enumerate-audit r2): a later identical
// file-write got the note twice. The guard's own blocked answer (recorded
// success=true, tagged harness-guard) was matched as the "prior successful
// call", so the note nested.
describe("duplicateGuard ignores its own blocked answers", () => {
  it("does not nest the note when the latest match is a guard-blocked call", () => {
    const args = { path: "audit.json", content: "[]" };
    const write = (id: string): ReasoningStep => makeStep("action", "file-write(...)", {
      toolCall: { id, name: "file-write", arguments: args },
    });
    const ran = makeStep("observation", "✓ Written to audit.json", {
      toolCallId: "w1",
      observationResult: makeObservationResult("file-write", true, "✓ Written to audit.json"),
    });
    const blockedText = "✓ Written to audit.json [Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete.]";
    const blocked = makeStep("observation", blockedText, {
      toolCallId: "w2",
      frameworkInstrumentation: GUARD_OBSERVATION_TAG,
      observationResult: makeObservationResult("file-write", true, blockedText),
    });
    const state = stateWith([write("w1"), ran, write("w2"), blocked], []);
    const r = duplicateGuard({ id: "w3", name: "file-write", arguments: args }, state, input);
    expect(r.pass).toBe(false);
    if (r.pass) return;
    expect(r.observation.match(/Already done/g)?.length).toBe(1);
  });
});
