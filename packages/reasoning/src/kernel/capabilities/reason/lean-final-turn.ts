/**
 * Think phase — lean final turn (harness switch `leanFinalTurn`, default OFF).
 *
 * Golden-run diagnosis 2026-11-18 (wiki/Research/Harness-Reports/2026-11-18-extra-iterations):
 * the final-answer turn after the last write cost 26% of tokens and 34% of LLM
 * time, while still shipping every tool schema and a thinking chain. Once the
 * tool work is done, that turn only has to write the answer.
 *
 * A think call is a lean final turn when ALL of these hold (deterministic, read
 * from state the harness already computed, no LLM call):
 *  - the switch is on, native function calling, not plan posture;
 *  - the run contract DECLARED tool work: a requirement of a tool-work kind
 *    (`artifact-produced`, `tool-coverage`, `action-required`, `input-coverage`,
 *    `write-coverage`). A contract with only answer requirements never
 *    qualifies: there "nothing left" cannot be told from "nothing started";
 *  - that tool work is settled ({@link toolWorkSettled}, shared with the budget
 *    answer turn): validated tool evidence, no blocking contract item, no
 *    requested action undone;
 *  - every file the task names was touched by a tool ({@link unreadNamedInputs});
 *    a satisfied `tool-coverage` alone is not evidence the task is answerable
 *    (ablation 2026-11-18: one of two files read, tool-less partial reply ended the run),
 *    and every prose-named input has a call ({@link unreadProseInputs});
 *  - no lean turn was taken since the last tool call (`leanFinalTurnAtActions`).
 *
 * Such a call ships with NO tools (the same withhold as the exit gate's answer
 * turn, so a stray tool call is refused, never run), `thinking: false`
 * (providers that support the switch turn reasoning off), and the think output
 * budget WITHOUT the thinking allowance (a bounded `maxTokens`; for a
 * non-thinking model the budget is unchanged). If the reply is not accepted as
 * the final answer, the next call has its tools again; another lean turn needs
 * another tool call first.
 *
 * Record: one `guard-fired` event per lean turn (`guard: "lean_final_turn"`,
 * outcome `redirect`, activity key `guard:lean_final_turn:redirect`).
 */
import { Effect } from "effect";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { transitionState, type KernelContext, type KernelState } from "../../state/kernel-state.js";
import type { PendingGuidance } from "../../state/guidance-channel.js";
import type { RequirementKind } from "../../contract/run-contract.js";
import { isPlanPosture } from "../../policy/run-posture.js";
import { toolWorkSettled } from "../../loop/budget-answer-turn.js";
import { guidanceForAnswerTurn } from "./answer-turn.js";
import { deriveDeliverablePaths } from "../verify/derive-conditions.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../../state/kernel-state.js" {
  interface KernelMeta {
    /** Lean final turn: the run's action-step count when the last lean turn was taken. */
    readonly leanFinalTurnAtActions?: number;
  }
}

/** Guard name on every lean-final-turn record. */
export const LEAN_FINAL_TURN_GUARD = "lean_final_turn";

/** The guidance line the lean turn renders (the turn has no tools). */
export const LEAN_FINAL_TURN_HINT =
  "The tool work this task needs is done, so tools are not available on this turn. Write the final answer now from the results you have.";

/** Contract requirement kinds that declare TOOL work (not answer shape). */
const TOOL_WORK_KINDS: ReadonlySet<RequirementKind> = new Set<RequirementKind>([
  "artifact-produced",
  "tool-coverage",
  "action-required",
  "input-coverage",
  "write-coverage",
]);

// Path segments may lead with a dot (`.bench-run-1-ab/`, `~/.config/`, `./.env.local`): zoo-live 2026-11-18.
const FILE_TOKEN = /(?:^|[\s"'`(,])((?:(?:~|\.{0,2})\/)?\.?[\w-]+(?:[/.]\.?[\w-]+)*\.[A-Za-z][A-Za-z0-9]{0,4})(?=$|[\s"'`),;:!?]|\.(?:\s|$))/g;

/** Any whitespace-delimited token that looks like a file: a path with an extension, or a common data/code extension. */
const LOOSE_FILE_TOKEN =
  /(?:^|[\s"'`(,])([^\s"'`(),;]*\/[^\s"'`(),;]*\.[A-Za-z][A-Za-z0-9]{0,4}|[^\s"'`(),;/]+\.(?:json|jsonl|csv|tsv|txt|md|ts|tsx|js|py|ya?ml|toml|log|html|xml|pdf|sql|env))(?=$|[\s"'`),;:!?]|\.(?:\s|$))/gi;

/**
 * Fail-closed check: true when every file-looking token the task names (and
 * does not write) is also matched by {@link unreadNamedInputs}' extractor. A
 * task that names files the extractor cannot read must not be taken as "all
 * inputs read" (zoo-live 2026-11-18: zero tokens extracted read as nothing unread).
 */
export function namedInputsExtractable(task: string): boolean {
  const written = new Set(deriveDeliverablePaths(task).map((p) => p.replace(/^\.\//, "")));
  const strict = new Set<string>();
  for (const m of task.matchAll(FILE_TOKEN)) strict.add((m[1] ?? "").replace(/^\.\//, ""));
  for (const m of task.matchAll(LOOSE_FILE_TOKEN)) {
    const token = (m[1] ?? "").replace(/^\.\//, "");
    if (token.length === 0 || written.has(token) || strict.has(token)) continue;
    return false;
  }
  return true;
}

/**
 * Files the task names that no tool call has touched yet. A file the task asks
 * to WRITE is a deliverable (the contract tracks it), not an input to read.
 * Deterministic. A satisfied `tool-coverage` ("file-read ran once") does not
 * mean every named input was read: ablation 2026-11-18 (h3-exact-value) read
 * a.json only, went tool-less, and the partial reply ended the run.
 */
export function unreadNamedInputs(task: string, steps: readonly { readonly type: string; readonly content: string }[]): readonly string[] {
  const written = new Set(deriveDeliverablePaths(task).map((p) => p.replace(/^\.\//, "")));
  const touched = steps.filter((s) => s.type === "action" || s.type === "observation").map((s) => s.content);
  const out = new Set<string>();
  for (const m of task.matchAll(FILE_TOKEN)) {
    const path = (m[1] ?? "").replace(/^\.\//, "");
    if (path.length === 0 || written.has(path)) continue;
    const base = path.split("/").pop() ?? path;
    if (!touched.some((c) => c.includes(base))) out.add(path);
  }
  return [...out];
}

/** A read-type verb and the object phrase it governs, up to the clause end. */
const READ_CLAUSE =
  /\b(?:read|open|load|fetch|review|inspect|gather|retrieve|look\s+at)\s+([^.;:\n]*?)(?=,?\s+(?:and\s+then|then|after|before|so|to)\b|[.;:\n]|$)/gi;
/** A counted object starts with a determiner or ordinal ("the first report"), so a second VERB phrase is not one. */
const COUNTED_OBJECT = /^(?:the|a|an|my|our|each|both|this|that|first|second|third|fourth|fifth|\d+)\b/i;

/**
 * Inputs the task names in PROSE ("read the first report and the second report")
 * that no tool call has covered yet: the coordinated objects of a read verb,
 * minus the tool calls made so far. Filename tokens are blind to such inputs
 * (zoo shape unread-input-prose: one read, then a tool-less partial reply ended
 * the run), so the lean turn holds until the task's declared count of read
 * objects has a call each. Over-counting only keeps the full turn (the safe
 * side). Deterministic; a task with fewer than two counted objects reports 0.
 */
export function unreadProseInputs(task: string, steps: readonly { readonly type: string }[]): number {
  let wanted = 0;
  for (const m of task.matchAll(READ_CLAUSE)) {
    const parts = (m[1] ?? "").split(/\s*(?:,|\band\b)\s*/).filter((p) => p.trim().length > 0);
    if (parts.length >= 2 && parts.every((p) => COUNTED_OBJECT.test(p.trim()))) wanted = Math.max(wanted, parts.length);
  }
  return Math.max(0, wanted - steps.filter((s) => s.type === "action").length);
}

/** The deterministic facts {@link shouldTakeLeanFinalTurn} decides from. */
export interface LeanFinalTurnFacts {
  readonly enabled: boolean;
  readonly nativeFC: boolean;
  readonly planPosture: boolean;
  readonly declaresToolWork: boolean;
  readonly toolWorkSettled: boolean;
  /** Every file the task names has been read (or is a write target). */
  readonly inputsRead: boolean;
  readonly actions: number;
  readonly takenAtActions: number | undefined;
}

/** True when this think call is a lean final turn. Pure. */
export function shouldTakeLeanFinalTurn(t: LeanFinalTurnFacts): boolean {
  return (
    t.enabled &&
    t.nativeFC &&
    !t.planPosture &&
    t.declaresToolWork &&
    t.toolWorkSettled &&
    t.inputsRead &&
    t.takenAtActions !== t.actions
  );
}

/**
 * The guidance a lean turn renders: the answer turn's allowlist (nothing that
 * steers toward a tool call), plus {@link LEAN_FINAL_TURN_HINT} when no gate
 * hint is already there.
 */
export function guidanceForLeanFinalTurn(g: PendingGuidance): PendingGuidance {
  return guidanceForAnswerTurn({ ...g, qualityGateHint: g.qualityGateHint ?? LEAN_FINAL_TURN_HINT });
}

/** What {@link decideLeanFinalTurn} returns: the state (stamped when taken) and the decision. */
export interface LeanFinalTurnDecision {
  readonly state: KernelState;
  readonly taken: boolean;
}

/**
 * Decide, before the call, whether this think call is a lean final turn. When
 * taken: stamps `meta.leanFinalTurnAtActions` and emits the guard record.
 * Cheap gates first: the contract check runs only when the switch is on.
 */
export function decideLeanFinalTurn(args: {
  readonly state: KernelState;
  readonly context: KernelContext;
  readonly enabled: boolean;
}): Effect.Effect<LeanFinalTurnDecision, never> {
  return Effect.gen(function* () {
    const { state, context } = args;
    const input = context.input;
    if (!args.enabled || context.toolCallingDriver.mode !== "native-fc" || isPlanPosture(input)) {
      return { state, taken: false };
    }
    const actions = state.steps.filter((s) => s.type === "action").length;
    const taken = shouldTakeLeanFinalTurn({
      enabled: true,
      nativeFC: true,
      planPosture: false,
      declaresToolWork: (state.meta.runContract?.requirements ?? []).some((r) => TOOL_WORK_KINDS.has(r.kind)),
      toolWorkSettled: toolWorkSettled(state, input) !== undefined,
      inputsRead: namedInputsExtractable(input.task) && unreadNamedInputs(input.task, state.steps).length === 0 && unreadProseInputs(input.task, state.steps) === 0,
      actions,
      takenAtActions: state.meta.leanFinalTurnAtActions,
    });
    if (!taken) return { state, taken: false };
    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: LEAN_FINAL_TURN_GUARD,
      outcome: "redirect",
      reason: "only-answer-outstanding",
      metadata: { tools: 0, thinking: false, actions },
    });
    return {
      state: transitionState(state, { meta: { ...state.meta, leanFinalTurnAtActions: actions } }),
      taken: true,
    };
  });
}
