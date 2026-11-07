// File: src/kernel/contract/run-contract.ts
//
// RunContract — the goal compiler (the harness "comprehend" node, meta-loop
// spec §1). The FIRST node of the one-directional meta-loop DAG:
//
//   RunContract → RunLedger → RunAssessment → (Control / Policy) → Actuators → Projector
//
// One typed object, compiled ONCE at run start and then FROZEN, that answers the
// single question every subsystem today re-derives independently from a prose
// string: *what does DONE mean for this run?* Later waves consume it — the
// terminal gate (check 2.5 = contract vs ledger), the progress estimator, pace
// bands, receipts (`deliverables[]`), the projector (renders outstanding items).
//
// GRAFT, DO NOT FORK. The requirement + deliverable specs are grafted directly
// onto the live PostCondition vocabulary (../capabilities/verify/post-conditions.ts:
// ToolCalled / ArtifactProduced / OutputContains) — already ledger-verified by
// the pure verify() gate. A requirement's deterministic side IS a PostCondition;
// B2's terminal gate verifies it with the existing verify(), unchanged.
//
// DAG law: this compiler reads TASK INPUTS ONLY (task prose, declared
// TaskContract, required tools, comprehend classification). It never reads
// runtime loop state — no back-edges.

import type { RunPosture, TaskContract } from "@reactive-agents/core";
import { PLAN_POSTURE_TOOLS } from "../policy/run-posture.js";
import { extractCurrentTurn } from "./current-turn.js";
import { classifyTaskHorizon, type TaskHorizon } from "../capabilities/comprehend/task-horizon.js";
import {
  deriveDeliverableItems,
  isPlainWordGap,
  pickWritingTool,
} from "../capabilities/verify/derive-conditions.js";
import { declaredItem, type DeclaredDeliverable } from "./declared-deliverables.js";
import { isStepScope, type DeliveryScope } from "./delivery-scope.js";
export { deliveryRails, isStepScope, type DeliveryScope } from "./delivery-scope.js";
import {
  inputRead,
  outputContains,
  toolCalled,
  type PostCondition,
} from "../capabilities/verify/post-conditions.js";
import { deriveListedInputs } from "../capabilities/verify/derive-inputs.js";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/** How strongly a requirement / deliverable can be verified (stakes-tiered). */
export type AcceptanceTier = "deterministic" | "checker" | "self-critique";

/**
 * The requirement families the contract can express. `input-coverage` (one per
 * input the task lists, `InputRead`) compiles only under the `inputCoverage`
 * harness switch.
 */
export type RequirementKind =
  | "question-answered"
  | "artifact-produced"
  | "constraint-held"
  | "tool-coverage"
  | "action-required"
  | "input-coverage";

/**
 * Who declared a per-item deliverable (Plan 8 L7 — one accept list, G2).
 * Every source lands the SAME requirement shape (artifact-produced → a file
 * exists; tool-coverage → a tool succeeded), so the terminal gate, the
 * receipt, and the outcome treat them identically:
 *  - `task-explicit`  — the task literally names the item (`a.txt, b.txt`).
 *  - `plan-declared`  — the run's declared plan / checklist (not wired yet).
 *  - `caller-accept`  — the caller's `accept[]` list (not wired yet).
 */
export type DeliverableSource = "task-explicit" | "plan-declared" | "caller-accept";

/** How many distinct items a `question-answered` enumeration requirement expects. */
export interface EnumerationHint {
  /** A literal count parsed from the task text, or "unknown" when none is derivable. */
  readonly expectedCount: number | "unknown";
  readonly itemShape: "list-entry" | "table-row";
}

/**
 * How a requirement is verified. `condition` is the GRAFT onto the live
 * PostCondition vocabulary — present when the requirement is deterministically
 * ledger-checkable (tool-coverage → ToolCalled, artifact-produced →
 * ArtifactProduced, an OutputContains question-section). Absent for the base
 * answer requirement, which only a checker / self-critique can judge.
 */
export interface RequirementSpec {
  /** Human/steering description of what must hold ("produce ./report.md"). */
  readonly description: string;
  /** The deterministic, ledger-checkable condition — a live PostCondition. */
  readonly condition?: PostCondition;
  /** Verification tier for this requirement. */
  readonly acceptance: AcceptanceTier;
  /** Present only on enumeration-shaped `question-answered` requirements (FM-16). */
  readonly enumeration?: EnumerationHint;
  /**
   * Present only on `action-required` requirements (GH #244): the external
   * capability the task needs (e.g. "send-message"). The satisfiability
   * preflight (contract/satisfiability.ts) checks it against the tool surface
   * at iteration 0; it carries no PostCondition because the compiler cannot
   * know WHICH tool will serve it.
   */
  readonly capability?: ActionCapability;
  /** Present only on per-item deliverable requirements: who declared the item. */
  readonly source?: DeliverableSource;
}

/**
 * Where a requirement / deliverable came from. Typed + trace-visible
 * (`contract-compiled.requirements[].provenance`) so "why is this outstanding?"
 * is answerable from one trace. `span` is a half-open `[start, end)` offset into
 * the ORIGINAL task string, present only for `task-text` sources.
 */
export interface RequirementProvenance {
  readonly source: "task-text" | "required-tools" | "task-contract" | "floor";
  readonly span?: { readonly start: number; readonly end: number };
}

/** One thing that must be true for the run to count as DONE. */
export interface TaskRequirement {
  /** Stable id — the ref B2's ledger + projector address this requirement by. */
  readonly id: string;
  readonly kind: RequirementKind;
  readonly spec: RequirementSpec;
  /** Where this requirement was derived from (see {@link RequirementProvenance}). */
  readonly provenance?: RequirementProvenance;
}

/** A concrete producible output the receipt reports as produced|missing. */
export interface DeliverableSpec {
  /** Stable id (mirrors the owning requirement's id). */
  readonly id: string;
  readonly kind: "file" | "answer-section" | "structured-object";
  /** How to verify it was produced — a live PostCondition (graft). */
  readonly matcher: PostCondition;
  /** Where this deliverable was derived from (mirrors the owning requirement). */
  readonly provenance?: RequirementProvenance;
  /** Who declared it (mirrors the owning requirement's `spec.source`). */
  readonly source?: DeliverableSource;
}

/** A hard boundary the run must not cross. */
export type Constraint =
  | { readonly kind: "forbidden-tool"; readonly tool: string }
  | { readonly kind: "output-format"; readonly format: string };

/**
 * The declared deny-list: tool names the contract forbids. This is the ONLY
 * read path for `constraints.forbidden-tool`, and it backs the hard guarantee
 * documented on `TaskContract.tools` ("the tool MUST NOT be visible to the
 * LLM"). Consumed by the tool-surface resolver, where deny beats every
 * visibility floor (required / allowed / meta).
 *
 * An absent contract yields an empty list, so the default surface is unchanged.
 */
export function forbiddenTools(contract: RunContract | undefined): readonly string[] {
  if (contract === undefined) return [];
  return contract.constraints
    .filter((c): c is { kind: "forbidden-tool"; tool: string } => c.kind === "forbidden-tool")
    .map((c) => c.tool);
}

/**
 * True when the compiled contract expects a CODE answer: a declared
 * `answer-section` deliverable whose matcher requires a fenced code block
 * (`OutputContains` with a ``` pattern, from TaskContract
 * `outputShape.mustInclude`). This is the only code-answer representation the
 * contract carries; an absent contract or no such deliverable ⇒ `false`.
 * Read by output assembly (Rule 2) — never a regex over the task text.
 */
export function expectsCodeAnswer(contract: RunContract | undefined): boolean {
  if (contract === undefined) return false;
  return contract.deliverables.some(
    (d) => d.kind === "answer-section" && d.matcher.kind === "OutputContains" && d.matcher.pattern.includes("```"),
  );
}

/** The compiled, frozen answer to "what does DONE mean for this run?". */
export interface RunContract {
  readonly requirements: readonly TaskRequirement[];
  readonly deliverables: readonly DeliverableSpec[];
  readonly constraints: readonly Constraint[];
  readonly horizon: TaskHorizon;
  /**
   * The deterministic floor — the union of every requirement's PostCondition —
   * so B2's terminal gate / the existing verify() can consume the contract's
   * checkable side directly without re-walking requirements.
   */
  readonly postConditions: readonly PostCondition[];
  /**
   * Which slice of the task string the contract was compiled from. When
   * `historyStripped`, prior-conversation text inlined by a chat caller was
   * excluded and `offset` is where the current turn starts in the original task.
   */
  readonly currentTurn?: { readonly offset: number; readonly historyStripped: boolean };
}

// ─── Compile options ─────────────────────────────────────────────────────────

export interface CompileRunContractOptions {
  /** Tools the dispatcher requires (the highest-confidence tool signal). */
  readonly requiredTools?: readonly string[];
  /**
   * The declared TaskContract when present (C2 ruling: RunContract absorbs and
   * extends TaskContract). Required tools are read from `.tools[required]`,
   * forbidden tools + output shape become constraints + deterministic
   * OutputContains requirements. Threaded from the runtime/bench layer — the
   * kernel does not receive TaskContract today, so this is a typed seam callers
   * populate when they have it.
   */
  readonly taskContract?: TaskContract;
  /** Override the derived horizon (else classifyTaskHorizon(task)). */
  readonly horizon?: TaskHorizon;
  /**
   * Tools ACTUALLY available to this run that can write a file artifact —
   * builtins in `WRITING_TOOL_NAMES` plus any registered tool declaring
   * `produces: "file"`.
   *
   * A derived artifact implies a writing tool was called, but the writer was
   * previously guessed as the builtin `"file-write"` regardless of what the
   * agent actually had. An agent with only a custom writer therefore carried a
   * permanently unsatisfiable `tool:file-write` requirement: the contract could
   * never be met, the terminal gate never passed, and a correct run was
   * reported failed (FM-15 layer 4).
   *
   * - provided & non-empty → require one of these instead of guessing.
   * - provided & EMPTY     → no tool can write; the requirement is
   *   unsatisfiable, so it is NOT created (the artifact requirement still
   *   stands and is disk-checkable).
   * - omitted              → legacy behaviour (guess `"file-write"`), so
   *   callers that cannot supply the set are byte-identical to before.
   */
  readonly availableWritingTools?: readonly string[];
  /**
   * Run posture. Under `"plan"` the run's tool surface is {@link PLAN_POSTURE_TOOLS}
   * only, so a requirement that can only be met by a tool outside it (tool
   * coverage, a written artifact and its derived writer) is UNSATISFIABLE by
   * construction. The contract must not carry them: otherwise `contract-coverage`
   * vetoes every plan turn to failure for work the posture itself withholds.
   * Absent / `"execute"` ⇒ byte-identical to before.
   */
  readonly posture?: RunPosture;
  /**
   * `"step"`: this kernel runs one step of a parent's plan and its task text
   * carries the parent's whole goal, so the files that text names are the
   * parent's deliverables: none is compiled into this contract (see
   * delivery-scope.ts). Absent ⇒ byte-identical to before.
   */
  readonly deliveryScope?: DeliveryScope;
  /**
   * Harness switch `inputCoverage` (default OFF): compile one `input-coverage`
   * requirement per input the task lists (derive-inputs.ts), so one read does
   * not count as having read every listed input. Not under plan posture (no
   * tools) nor in a step kernel (its text lists the parent's inputs).
   * Absent / false ⇒ byte-identical to before.
   */
  readonly inputCoverage?: boolean;
}

// ─── Freeze helpers ──────────────────────────────────────────────────────────

/** Deep-freeze the compiled contract so no consumer can mutate it post-compile. */
function freezeContract(contract: RunContract): RunContract {
  for (const r of contract.requirements) {
    Object.freeze(r);
    Object.freeze(r.spec);
    if (r.provenance) Object.freeze(r.provenance);
    if (r.spec.condition) Object.freeze(r.spec.condition);
  }
  for (const d of contract.deliverables) {
    Object.freeze(d);
    Object.freeze(d.matcher);
    if (d.provenance) Object.freeze(d.provenance);
  }
  for (const c of contract.constraints) Object.freeze(c);
  for (const p of contract.postConditions) Object.freeze(p);
  Object.freeze(contract.requirements);
  Object.freeze(contract.deliverables);
  Object.freeze(contract.constraints);
  Object.freeze(contract.postConditions);
  if (contract.currentTurn) Object.freeze(contract.currentTurn);
  return Object.freeze(contract);
}

// ─── The compiler (deterministic core = the FLOOR) ───────────────────────────

const ENUMERATING_PATTERN = /\b(all|every|each|list(?:ing)?)\b/i;
const LITERAL_COUNT_PATTERN =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const WORD_TO_NUMBER: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const TABLE_PATTERN = /\btable\b/i;

/**
 * Deterministic classifier: does this task ask for an enumeration, and if so,
 * how many items and in what shape? Returns undefined for non-enumerating tasks
 * (FM-16 layer A) — additive, no behavior change for the common case.
 */
function classifyEnumeration(task: string): EnumerationHint | undefined {
  if (!ENUMERATING_PATTERN.test(task)) return undefined;
  const itemShape: EnumerationHint["itemShape"] = TABLE_PATTERN.test(task) ? "table-row" : "list-entry";

  // Look for a literal count in proximity to the enumerating pattern
  // (within a 50-character window after the enumerating keyword).
  const enumeratingMatch = ENUMERATING_PATTERN.exec(task);
  if (!enumeratingMatch) return { expectedCount: "unknown", itemShape };

  const startPos = enumeratingMatch.index;
  const windowEnd = Math.min(startPos + 50, task.length);
  const window = task.substring(startPos, windowEnd);

  const countMatch = window.match(LITERAL_COUNT_PATTERN);
  if (!countMatch) return { expectedCount: "unknown", itemShape };
  const raw = countMatch[1]!.toLowerCase();
  const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : WORD_TO_NUMBER[raw];
  return { expectedCount: n ?? "unknown", itemShape };
}

// ─── Action-need detection (GH #244) ─────────────────────────────────────────
// External-effect verbs only: a task that needs the world CHANGED (a message
// sent, a ticket opened, an event scheduled) compiles an `action-required`
// requirement carrying the capability it needs, so the satisfiability
// preflight can fail fast when no tool serves it. Information verbs
// (search/read/fetch/summarize/analyze) are DELIBERATELY excluded: the model
// can answer those from weights, so there is no capability to be missing and
// a bare question must never trip the preflight.

/** External capabilities an action-requiring task can need. */
export type ActionCapability = "send-message" | "create-ticket" | "schedule-event";

/** A task-side action need: WHAT external effect the task requires. */
export interface ActionNeed {
  readonly capability: ActionCapability;
  /** Short human phrase for requirement descriptions + abstention reasons. */
  readonly description: string;
  /** `[start, end)` of the verb..object match within the scanned text. */
  readonly span?: { readonly start: number; readonly end: number };
}

interface ActionRule {
  readonly capability: ActionCapability;
  /** External-effect verb present in the task. */
  readonly verb: RegExp;
  /** Target noun/context the verb acts on. */
  readonly object: RegExp;
}

const ACTION_RULES: readonly ActionRule[] = [
  {
    capability: "send-message",
    verb: /\b(send|sends|sent|post|posts|posted|publish|notify|notifies|email|emails|dm|tweet|announce|alert|broadcast|text|texts|ping|pings)\b/i,
    object: /\b(message|messages|slack|channel|#\w+|email|notification|tweet|dm|announcement|alert|team|sms|discord|telegram|whatsapp|teams)\b/i,
  },
  {
    capability: "create-ticket",
    verb: /\b(create|creates|open|opens|file|files|raise|raises|submit|submits)\b/i,
    object: /\b(issue|issues|ticket|tickets|bug|bugs|pull request|merge request)\b/i,
  },
  {
    capability: "schedule-event",
    verb: /\b(schedule|schedules|book|books|invite|invites|set up)\b/i,
    object: /\b(meeting|event|appointment|calendar|call|interview|reminder|standup|sync|demo|webinar)\b/i,
  },
];

/**
 * Tasks that ASK (a question, an explanation, a summary) are never action
 * needs — even when they mention action words ("How do I send a slack
 * message?"). Conservative: an imperative-seasoned request misread as a
 * question merely falls back to the stand-down path (status quo), while a
 * question misread as an action would wrongly abstain at iteration 0.
 */
const QUESTION_START =
  /^\s*(what|why|how|when|who|which|whom|whose|where|is|are|was|were|can|could|do|does|did|would|should|will|have|has|explain|describe|summarize|summarise|tell me|give me|list|show me)\b/i;

/**
 * Governed relation (truthfulness audit 2026-11-06, item 1). The verb must
 * GOVERN the object, not merely co-occur with it: "test file … bug", memory
 * text "files … issues" and history "sends … message" all matched the old
 * anywhere-in-the-text rule, and every rendered action requirement in a
 * 1,680-run corpus was false (45/45). Three conditions:
 *  - imperative position: only a lead-in ("please", "then", "I need you to")
 *    stands between the clause start and the verb, so "a short text for the
 *    team" (a noun) never reads as the verb "text";
 *  - the object follows the verb in the same clause;
 *  - the gap is a short run of plain words (`isPlainWordGap`, shared with the
 *    deliverable deriver), at most ACTION_OBJECT_MAX_WORDS words.
 * A verb that is its own object ("email Bob", "dm the lead") governs itself.
 */
const ACTION_OBJECT_MAX_WORDS = 4;
const ACTION_OBJECT_MAX_CHARS = 40;
/** Clause boundaries: punctuation, line breaks, and coordinating "and"/"then". */
const CLAUSE_BOUNDARY = /[.!?;:,\n]|\band\b|\bthen\b/gi;
const IMPERATIVE_LEAD_IN =
  /^\s*(?:(?:please|now|also|just|kindly|first|next|finally|go ahead and|i need you to|i want you to|you should|you need to|make sure to|be sure to|remember to)\s+)*$/i;

/** Start offset of the clause containing `at` (after the last boundary before it). */
function clauseStart(task: string, at: number): number {
  let start = 0;
  for (const m of task.slice(0, at).matchAll(CLAUSE_BOUNDARY)) {
    start = (m.index ?? 0) + m[0].length;
  }
  return start;
}

/** End offset of the clause containing `at` (the next boundary after it). */
function clauseEnd(task: string, at: number): number {
  const rest = task.slice(at);
  const m = new RegExp(CLAUSE_BOUNDARY.source, "i").exec(rest);
  return m === null ? task.length : at + m.index;
}

function globalOf(re: RegExp): RegExp {
  return new RegExp(re.source, "gi");
}

/** The object `verb` governs within its clause, or undefined. */
function governedObject(
  task: string,
  rule: ActionRule,
  verbStart: number,
  verbText: string,
): { readonly start: number; readonly text: string } | undefined {
  if (!IMPERATIVE_LEAD_IN.test(task.slice(clauseStart(task, verbStart), verbStart))) return undefined;
  if (new RegExp(`^(?:${rule.object.source})$`, "i").test(verbText)) {
    return { start: verbStart, text: verbText };
  }
  const verbEnd = verbStart + verbText.length;
  const clause = task.slice(verbEnd, clauseEnd(task, verbEnd));
  const obj = globalOf(rule.object).exec(clause);
  if (obj === null) return undefined;
  const gap = clause.slice(0, obj.index);
  const words = gap.trim().length === 0 ? 0 : gap.trim().split(/\s+/).length;
  if (words > ACTION_OBJECT_MAX_WORDS || !isPlainWordGap(gap, ACTION_OBJECT_MAX_CHARS)) return undefined;
  return { start: verbEnd + obj.index, text: obj[0] };
}

/**
 * Detect whether a task needs an external action, independent of the tool
 * surface (the surface may have NOTHING relevant — that is exactly the
 * unsatisfiable shape). Pure, deterministic, no LLM. Returns undefined for
 * questions and information tasks, and for verb/object pairs the verb does not
 * govern (see the governed-relation note above). Callers pass the user's own
 * message only (compileRunContract scopes it with `extractCurrentTurn`).
 */
export function detectActionNeed(task: string): ActionNeed | undefined {
  if (!task || task.trim().length === 0) return undefined;
  if (QUESTION_START.test(task)) return undefined;
  for (const rule of ACTION_RULES) {
    for (const verbMatch of task.matchAll(globalOf(rule.verb))) {
      const vs = verbMatch.index ?? 0;
      const object = governedObject(task, rule, vs, verbMatch[0]);
      if (object === undefined) continue;
      return {
        capability: rule.capability,
        description:
          `task requires a "${rule.capability}" action ("${verbMatch[0].toLowerCase()} … ${object.text.toLowerCase()}")`,
        span: {
          start: vs,
          end: Math.max(vs + verbMatch[0].length, object.start + object.text.length),
        },
      };
    }
  }
  return undefined;
}

/**
 * Compile the RunContract from task inputs. Deterministic, pure, NO LLM, NO fs —
 * this is the FLOOR that guarantees a non-empty contract without any model call.
 * The optional LLM decomposition (decompose.ts) only ADDS to this; it never
 * replaces it.
 *
 * DAG law: reads task prose + declared contract + required tools + comprehend
 * classification. Never reads loop state.
 */
export function compileRunContract(
  fullTask: string,
  opts: CompileRunContractOptions = {},
): RunContract {
  // Compile from the CURRENT turn only — chat callers inline prior conversation
  // ahead of it, and requirements derived from that history can never be
  // satisfied this turn (see current-turn.ts). No marker ⇒ identical to before.
  const turn = extractCurrentTurn(fullTask);
  const task = turn.text;
  const spanOf = (start: number, len: number): { start: number; end: number } => ({
    start: turn.offset + start,
    end: turn.offset + start + len,
  });
  const requirements: TaskRequirement[] = [];
  const deliverables: DeliverableSpec[] = [];
  const constraints: Constraint[] = [];
  const postConditions: PostCondition[] = [];
  const seenCond = new Set<string>();

  const pushCondition = (c: PostCondition): void => {
    const key = JSON.stringify(c);
    if (seenCond.has(key)) return;
    seenCond.add(key);
    postConditions.push(c);
  };

  // 1. Tool coverage — requiredTools + declared TaskContract required tools.
  const declaredRequired =
    opts.taskContract?.tools
      ?.filter((t) => t.kind === "required")
      .map((t) => t.name) ?? [];
  const planPosture = opts.posture === "plan";
  const requiredTools: string[] = [];
  for (const tool of [...(opts.requiredTools ?? []), ...declaredRequired]) {
    if (planPosture && !PLAN_POSTURE_TOOLS.has(tool)) continue; // withheld by plan posture
    if (typeof tool === "string" && tool.length > 0 && !requiredTools.includes(tool)) {
      requiredTools.push(tool);
    }
  }
  for (const tool of requiredTools) {
    const condition = toolCalled(tool);
    requirements.push({
      id: `tool:${tool}`,
      kind: "tool-coverage",
      spec: { description: `call the \`${tool}\` tool`, condition, acceptance: "deterministic" },
      provenance: {
        source: declaredRequired.includes(tool) && !(opts.requiredTools ?? []).includes(tool)
          ? "task-contract"
          : "required-tools",
      },
    });
    pushCondition(condition);
  }

  // 2. Artifact-produced — ALL literal deliverable paths (audit 01-F5 multi-path).
  //    Each is a per-item deliverable from source `task-explicit`, built by the
  //    same declaredItem() the addDeclaredDeliverables seam uses (Plan 8 L7).
  //    A bound template (out-N.txt over notes-1..6.txt) compiles one item per
  //    member, each spanning the template it was expanded from.
  //    Plan posture writes no artifacts; a step kernel's named files are its
  //    parent's (delivery-scope.ts). deriveConditions applies the same rule.
  const items = planPosture || isStepScope(opts) ? [] : deriveDeliverableItems(task);
  const paths = items.map((d) => d.path);
  for (const { path, template } of items) {
    const at = task.indexOf(path);
    const pathProvenance: RequirementProvenance =
      at >= 0
        ? { source: "task-text", span: spanOf(at, path.length) }
        : template !== undefined
          ? { source: "task-text", span: spanOf(template.start, template.length) }
          : { source: "task-text" };
    const item = declaredItem({ kind: "file", path }, "task-explicit", pathProvenance);
    requirements.push(item.requirement);
    if (item.deliverable !== undefined) deliverables.push(item.deliverable);
    pushCondition(item.condition);
  }
  // A derived artifact implies a writing tool must have been called — but only
  // if the run HAS one. See `availableWritingTools` above (FM-15 layer 4).
  const available = opts.availableWritingTools;
  const writer =
    available === undefined
      ? pickWritingTool(requiredTools)
      : (requiredTools.find((t) => available.includes(t)) ?? available[0]);
  if (paths.length > 0 && writer !== undefined) {
    const writerCond = toolCalled(writer);
    if (!seenCond.has(JSON.stringify(writerCond))) {
      requirements.push({
        id: `tool:${writer}`,
        kind: "tool-coverage",
        spec: { description: `call the \`${writer}\` tool`, condition: writerCond, acceptance: "deterministic" },
        provenance: { source: "floor" },
      });
      pushCondition(writerCond);
    }
  }

  // 2a. Input coverage (DEBT #39, opt-in): one requirement per listed input.
  //     `source: "task-explicit"` puts its condition in `deliveryConditions`,
  //     so the exit gate and act-or-answer see each unread input by name.
  if (opts.inputCoverage === true && !planPosture && !isStepScope(opts)) {
    for (const { entity, start } of deriveListedInputs(task)) {
      const condition = inputRead(entity);
      requirements.push({
        id: `input:${entity}`,
        kind: "input-coverage",
        spec: { description: `read the listed input ${entity}`, condition, acceptance: "deterministic", source: "task-explicit" },
        provenance: { source: "task-text", span: spanOf(start, entity.length) },
      });
      pushCondition(condition);
    }
  }

  // 2b. Action-required (GH #244) — an external-effect task compiles ONE
  // requirement carrying the capability it needs. No PostCondition: the
  // compiler cannot know which tool will serve it, so verification is
  // checker-tier and the satisfiability preflight (satisfiability.ts) owns
  // the iteration-0 fast path. Id is stable (`action:<capability>`).
  const actionNeed = detectActionNeed(task);
  if (actionNeed !== undefined) {
    requirements.push({
      id: `action:${actionNeed.capability}`,
      kind: "action-required",
      spec: {
        description: actionNeed.description,
        acceptance: "checker",
        capability: actionNeed.capability,
      },
      provenance: {
        source: "task-text",
        ...(actionNeed.span !== undefined
          ? { span: spanOf(actionNeed.span.start, actionNeed.span.end - actionNeed.span.start) }
          : {}),
      },
    });
  }

  // 3. Output-format sections — declared TaskContract mustInclude → deterministic
  //    OutputContains question-answered requirements.
  for (const inc of opts.taskContract?.outputShape?.mustInclude ?? []) {
    if (typeof inc !== "string" || inc.length === 0) continue;
    const condition = outputContains(inc);
    if (seenCond.has(JSON.stringify(condition))) continue;
    requirements.push({
      id: `output:${inc}`,
      kind: "question-answered",
      spec: { description: `include "${inc}" in the answer`, condition, acceptance: "deterministic" },
      provenance: { source: "task-contract" },
    });
    deliverables.push({ id: `output:${inc}`, kind: "answer-section", matcher: condition, provenance: { source: "task-contract" } });
    pushCondition(condition);
  }

  // 4. Constraints — forbidden tools + output format (from declared TaskContract).
  for (const t of opts.taskContract?.tools ?? []) {
    if (t.kind === "forbidden") constraints.push({ kind: "forbidden-tool", tool: t.name });
  }
  const fmt = opts.taskContract?.outputShape?.format;
  if (typeof fmt === "string" && fmt.length > 0) {
    constraints.push({ kind: "output-format", format: fmt });
  }

  // 5. The question-answered FLOOR — always present. Guarantees a non-empty
  //    contract for every task (even a bare Q&A with no tools / files), and
  //    anchors "the answer must actually address the task" as a first-class
  //    requirement the checker / self-critique tier judges.
  const enumeration = classifyEnumeration(task);
  requirements.push({
    id: "answer",
    kind: "question-answered",
    spec: {
      description: "produce a substantive answer that addresses the task",
      acceptance: "self-critique",
      ...(enumeration !== undefined ? { enumeration } : {}),
    },
    provenance: { source: "floor" },
  });

  const horizon = opts.horizon ?? classifyTaskHorizon(task).horizon;

  return freezeContract({
    requirements,
    deliverables,
    constraints,
    horizon,
    postConditions,
    currentTurn: { offset: turn.offset, historyStripped: turn.historyStripped },
  });
}

// ─── LLM-decomposition merge (the floor invariant) ───────────────────────────

/**
 * Merge LLM-decomposed requirements onto the deterministic floor. The floor is
 * NEVER removed or replaced — LLM requirements are only ADDED, and only when
 * their id does not collide with a floor requirement. Pure + deterministic given
 * its inputs, so the floor invariant is unit-testable without any model call.
 */
export function mergeLlmRequirements(
  floor: readonly TaskRequirement[],
  llmDerived: readonly TaskRequirement[],
): readonly TaskRequirement[] {
  const seen = new Set(floor.map((r) => r.id));
  const added = llmDerived.filter((r) => !seen.has(r.id));
  return [...floor, ...added];
}

/**
 * Rebuild a frozen contract with an amended requirement set (used after LLM
 * decomposition). Recomputes the postConditions floor and re-freezes.
 * Deliverables/constraints/horizon carry over.
 */
export function withRequirements(
  contract: RunContract,
  requirements: readonly TaskRequirement[],
): RunContract {
  const postConditions: PostCondition[] = [];
  const seen = new Set<string>();
  for (const r of requirements) {
    if (!r.spec.condition) continue;
    const key = JSON.stringify(r.spec.condition);
    if (seen.has(key)) continue;
    seen.add(key);
    postConditions.push(r.spec.condition);
  }
  return freezeContract({ ...contract, requirements, postConditions });
}

/**
 * THE seam for per-item deliverables declared after the task text was compiled
 * (Plan 8 L7 / G2 "one accept list"): source `plan-declared` (the run's
 * declared checklist) and `caller-accept` (the caller's `accept[]`) plug in
 * here instead of growing new parsers. Each item becomes the SAME requirement
 * (+ file deliverable + PostCondition) a `task-explicit` item compiles to, so
 * the terminal gates (see `deliveryConditions`), the receipt, and the outcome
 * treat every source identically. Items whose id is already on the contract
 * are skipped (first declarer wins). Returns a new frozen contract.
 */
export function addDeclaredDeliverables(
  contract: RunContract,
  items: readonly DeclaredDeliverable[],
  source: DeliverableSource,
): RunContract {
  const requirements = [...contract.requirements];
  const deliverables = [...contract.deliverables];
  const postConditions = [...contract.postConditions];
  const ids = new Set(requirements.map((r) => r.id));
  const conds = new Set(postConditions.map((c) => JSON.stringify(c)));
  for (const raw of items) {
    const item = declaredItem(raw, source);
    if (ids.has(item.requirement.id)) continue;
    ids.add(item.requirement.id);
    requirements.push(item.requirement);
    if (item.deliverable !== undefined) deliverables.push(item.deliverable);
    const key = JSON.stringify(item.condition);
    if (!conds.has(key)) {
      conds.add(key);
      postConditions.push(item.condition);
    }
  }
  return freezeContract({ ...contract, requirements, deliverables, postConditions });
}
