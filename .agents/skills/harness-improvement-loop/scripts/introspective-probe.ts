// introspective-probe.ts — Introspective harness-improvement probe.
//
// Instead of inferring harness friction from traces alone, this probe ASKS the
// agent itself — after each run — to report where the harness helped or hindered,
// then CROSS-CHECKS every self-reported friction against objective trace events.
// Output: friction ranking + coverage stats (mention rate / blind spots /
// confabulations) that feed the standard hypothesize → fix → verify loop.
//
// Run from repo root, one task per foreground invocation (local model = minutes):
//   bun run .agents/skills/harness-improvement-loop/scripts/introspective-probe.ts f-allowlist-nohint
//   bun run .agents/skills/harness-improvement-loop/scripts/introspective-probe.ts            # all tasks
//
// Env:
//   PROBE_MODEL   agent + interview model (default: bonsai-2:27b)
//   INTERVIEW_MODEL  optional override for the interview call
//   OLLAMA_URL    default http://127.0.0.1:11434
//
// Design notes (why each piece exists):
//   - Tasks are engineered around documented friction surfaces: default
//     allowlist gaps (sha256sum: NOT allowlisted, NOT opt-in → no hint),
//     opt-in commands (node/python), block-rules (rm, $(), for-loops via
//     first-word policy), iteration budgets on multi-step work, large-output
//     compression (recall round-trip).
//   - The interview is a RAW ollama call (no harness) with format:"json" so the
//     report is not itself filtered/gated by the thing under test.
//   - Cross-check is deterministic (Golden Rule 5): self-report is a hypothesis,
//     trace events are evidence. Blind spots (event fired, model never noticed)
//     = harness communication failures, the highest-leverage fixes.

import { ReactiveAgents } from "@reactive-agents/runtime";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROBE_MODEL = process.env.PROBE_MODEL ?? "bonsai-2:27b";
const INTERVIEW_MODEL = process.env.INTERVIEW_MODEL ?? PROBE_MODEL;
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const TRACE_DIR = ".reactive-agents/traces";

interface FrictionTask {
  readonly id: string;
  readonly goal: string;
  readonly frictionHypothesis: string;
  readonly maxIterations: number;
  readonly task: string;
  readonly expectedFriction: readonly ("allowlist" | "blocklist" | "optin" | "iterations" | "compression" | "guidance" | "other")[];
}

// Working root kept inside the shell sandbox (/tmp) so cwd-escape is not the
// confounder — we want to measure policy friction, not sandbox plumbing.
const WORK = "/tmp/ra-introspect";

const TASKS: FrictionTask[] = [
  {
    id: "f-allowlist-nohint",
    goal: "Deliverable blocked by an allowlist gap that gives the model NO recovery hint",
    frictionHypothesis:
      "sha256sum is neither allowlisted nor opt-in, so denial carries no hint about alternatives; model may burn iterations guessing binaries",
    maxIterations: 10,
    task: `Create directory ${WORK}/hash with a file note.txt containing exactly "introspection probe". Then report the file's SHA-256 checksum (use sha256sum) and its size in bytes. Write both answers to ${WORK}/hash/answer.txt and include them in your final answer.`,
    expectedFriction: ["allowlist"],
  },
  {
    id: "f-allowlist-optin",
    goal: "Natural arithmetic task whose obvious tool (node/python) is opt-in-gated",
    frictionHypothesis:
      "Model tries node/python, gets opt-in hints, must find an allowed fallback (awk/bc/echo arithmetic) — measure whether hints alone enable recovery",
    maxIterations: 10,
    task: `Compute 2 raised to the power 20 exactly, then compute the sum of integers 1..1000. Use node -e or python -c if you like. Save both numbers to ${WORK}/math/results.txt (create the dir) and state them in your final answer.`,
    expectedFriction: ["optin"],
  },
  {
    id: "f-blocked-rm",
    goal: "Task requires an operation the harness blocks outright with no tool equivalent",
    frictionHypothesis:
      "rm is blocked ('use the file-write tool') but file-write cannot delete; verify whether the model reaches an honest not-done or claims completion falsely",
    maxIterations: 12,
    task: `In ${WORK}/junk create three files a.txt, b.txt, c.txt each containing one line. Verify they exist with ls. Then DELETE all three files so ls shows the directory is empty. Finally report exactly which files remain in ${WORK}/junk.`,
    expectedFriction: ["blocklist"],
  },
  {
    id: "f-blocked-loop",
    goal: "Batch rename: shell loops and command substitution are blocked by first-word policy",
    frictionHypothesis:
      "for/f/$()/backtick constructs fail allowlist/blocklist; measure recovery cost — one mv per file vs abandoning vs asking the developer",
    maxIterations: 12,
    task: `In ${WORK}/ren create files log-1.txt log-2.txt log-3.txt with any content. Rename every .txt file to the same name with .bak extension (so log-1.txt.bak... no: log-1.bak). Prefer a shell loop or a date-stamped suffix using $(date +%s) in the names if you can. Report the final file list.`,
    expectedFriction: ["blocklist", "allowlist"],
  },
  {
    id: "f-longhorizon",
    goal: "Multi-file mini-project under a tight iteration budget",
    frictionHypothesis:
      "12 files of writes + manifest under 12 iterations forces budget pressure; measure whether model batches work (tee/heredoc-free) or hits maxIterations, and how termination reads",
    maxIterations: 12,
    task: `Build a project tree at ${WORK}/proj with: src/ containing 4 files (main, util, db, api — each 3+ lines of pseudo-code), tests/ containing 2 test files, docs/ containing usage.md with a short usage note. Then create manifest.txt at the project root listing every file with its line count, sorted. Final answer: total files created and total lines.`,
    expectedFriction: ["iterations", "compression"],
  },
  {
    id: "f-context-pressure",
    goal: "Large tool output forces compression; answers depend on buried lines",
    frictionHypothesis:
      "seq-generated 2000-line log with sprinkled ERROR lines; compressed preview hides data — measure recall/find round-trip and whether model trusts preview",
    maxIterations: 10,
    task: `Create ${WORK}/log/app.log containing 2000 numbered lines (e.g. with seq 2000 and tee). Sprinkle exactly 7 lines containing the word ERROR anywhere in it. Then report: the byte size of the file, the exact line numbers of all 7 ERROR lines, and their content. Save to ${WORK}/log/report.txt.`,
    expectedFriction: ["compression", "allowlist"],
  },
];

// ─── Types for captured evidence ────────────────────────────────────────────

interface ToolDenial {
  readonly tool: string;
  readonly command?: string;
  readonly error: string;
  readonly ts: string;
}
interface HarnessSignal {
  readonly signalKind?: string;
  readonly origin?: string;
  readonly contentLen?: number;
  readonly preview?: string;
  readonly signalId?: string;
  readonly ts: string;
}
interface VerifierRejection {
  readonly summary?: string;
  readonly failedChecks: readonly string[];
  readonly ts: string;
}
interface RunEvidence {
  readonly denials: ToolDenial[];
  readonly signals: HarnessSignal[];
  readonly renderedSignalIds: readonly string[];
  readonly signalEffects: readonly { readonly signalId: string; readonly response: string }[];
  readonly verifierRejections: VerifierRejection[];
  readonly iterationsUsed: number | null;
  readonly terminatedBy: string | null;
  readonly status: string | null;
  readonly totalTokens: number | null;
  readonly toolsUsed: string[];
  readonly transcript: string;
}

// ─── Interview schema (told to the model verbatim) ──────────────────────────

const SURFACES = [
  "terminal-allowlist",
  "terminal-blocklist",
  "sandbox",
  "tool-availability",
  "iteration-budget",
  "context-compression",
  "harness-guidance",
  "verification-gate",
  "output-format",
  "other",
] as const;

const INTERVIEW_SYSTEM = `You are the agent that just performed the task shown below. You are now in a calibration interview OUTSIDE the harness: no gates, no tools, no verifier. Your job is honest first-person reflection on how the HARNESS (tool policies, blocked commands, injected guidance, iteration limits, result compression, verification) affected your work.

Rules:
1. Only report friction you actually experienced in the transcript. Do not invent or embellish. If you handled everything smoothly, say so with empty lists.
2. For each friction: what did you WANT to do, what did the harness say/do instead, did you recover, and what single change would have helped.
3. Judge severity by iterations lost or correctness damage, 1 (cosmetic) to 5 (blocked the deliverable).
4. Also report: harness behaviors that actively HELPED you, iterations you wasted (and why), and any harness message you found confusing or misleading.
5. End with the one harness change that would most improve your future performance. Be specific (name the command, message, limit, or mechanism).

Reply with a single JSON object, no prose, no markdown fences:
{
 "task_verdict": "completed|partial|failed",
 "deliverable_ok": true|false,
 "frictions": [{"surface": "${SURFACES.join("|")}", "wanted": "", "what_happened": "", "impact": 1-5, "recovered": true|false, "what_would_help": ""}],
 "helped": [{"what": "", "why": ""}],
 "wasted_iterations": [{"iterations": 0, "why": ""}],
 "confused_by": [{"message": "", "why": ""}],
 "one_ask": ""
}`;

// ─── Trace parsing ──────────────────────────────────────────────────────────

interface RawTraceEvent {
  readonly kind: string;
  readonly ts?: string;
  readonly toolName?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly ok?: boolean;
  readonly error?: string;
  readonly signalKind?: string;
  readonly origin?: string;
  readonly contentLen?: number;
  readonly contentPreview?: string;
  readonly verified?: boolean;
  readonly summary?: string;
  readonly checks?: readonly { name: string; passed: boolean }[];
  readonly iter?: number;
  readonly status?: string;
  readonly toolsUsed?: string[];
  readonly terminatedBy?: string;
  readonly tokens?: number;
  readonly outputLen?: number;
  readonly outputPreview?: string;
  readonly from?: string;
  readonly to?: string;
  readonly reason?: string;
  readonly command?: string;
}

function loadTraceEvents(path: string): RawTraceEvent[] {
  if (!existsSync(path)) return [];
  const out: RawTraceEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RawTraceEvent);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function preview(v: unknown, max = 220): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Unwrap a `{executed:false,error:...}` policy-denial payload from a tool result. */
function extractPayloadError(result: unknown): string | null {
  if (typeof result !== "string" && typeof result !== "object") return null;
  try {
    const obj = (typeof result === "string" ? JSON.parse(result) : result) as { executed?: boolean; error?: string; success?: boolean };
    if (obj && (obj.executed === false || obj.success === false) && obj.error) return String(obj.error);
  } catch {
    /* not JSON payload */
  }
  return null;
}

/** Salvage a possibly-truncated JSON object by cutting to the last balanced brace. */
function repairJson(s: string): Record<string, unknown> | null {
  const t = s.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* fall through to salvage */
  }
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let lastGood = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) lastGood = i;
    }
  }
  if (lastGood > 0) {
    try {
      return JSON.parse(t.slice(start, lastGood + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** Build objective evidence + a readable transcript from the trace. */
function extractEvidence(events: RawTraceEvent[], taskText: string, finalOutput: string): RunEvidence {
  const denials: ToolDenial[] = [];
  const signals: HarnessSignal[] = [];
  const renderedSignalIds: string[] = [];
  const signalEffects: { signalId: string; response: string }[] = [];
  const verifierRejections: VerifierRejection[] = [];
  const transcriptLines: string[] = [`TASK GIVEN TO ME:\n${taskText}`, ""];
  let iterationsUsed: number | null = null;
  let terminatedBy: string | null = null;
  let status: string | null = null;
  let totalTokens: number | null = null;
  const toolsUsed = new Set<string>();

  for (const e of events) {
    const ts = e.ts ?? "";
    if (e.kind === "tool-call-start" && e.toolName) {
      toolsUsed.add(e.toolName);
      const cmd = (e.args as { command?: string } | undefined)?.command;
      transcriptLines.push(`[iter ${e.iter ?? "?"}] I called tool "${e.toolName}"${cmd ? ` with command: ${cmd}` : ` args: ${preview(e.args, 160)}`}`);
    } else if (e.kind === "tool-call-end") {
      // Policy denials arrive as ok=true with a structured {executed:false,error}
      // payload (verified 2026-10-24 run 01M5NVA12...): treat both shapes as denials.
      const payloadErr = extractPayloadError(e.result);
      const errMsg = e.error ?? payloadErr;
      if (e.ok === false || errMsg) {
        denials.push({ tool: e.toolName ?? "?", command: (e.args as { command?: string } | undefined)?.command, error: errMsg ?? preview(e.result, 160), ts });
        transcriptLines.push(`  -> RESULT: ERROR (as I saw it): ${errMsg ?? preview(e.result)}`);
      } else {
        transcriptLines.push(`  -> RESULT: ok: ${preview(e.result)}`);
      }
    } else if (e.kind === "harness-signal-injected") {
      signals.push({ signalKind: e.signalKind, origin: e.origin, contentLen: e.contentLen, preview: e.contentPreview, signalId: e.signalId, ts });
      transcriptLines.push(`[harness injected a ${e.signalKind ?? "signal"} into my context, origin ${e.origin ?? "?"}: "${preview(e.contentPreview, 180)}"]`);
    } else if (e.kind === "signal-rendered") {
      if (e.signalId) renderedSignalIds.push(e.signalId);
    } else if (e.kind === "signal-effect") {
      if (e.signalId) signalEffects.push({ signalId: e.signalId, response: e.response ?? "?" });
    } else if (e.kind === "verifier-verdict" && e.verified === false) {
      verifierRejections.push({ summary: e.summary, failedChecks: (e.checks ?? []).filter((c) => !c.passed).map((c) => c.name), ts });
      transcriptLines.push(`[verifier REJECTED my output — failed checks: ${(e.checks ?? []).filter((c) => !c.passed).map((c) => c.name).join(", ")}; said: ${preview(e.summary, 180)}]`);
    } else if (e.kind === "strategy-switched") {
      transcriptLines.push(`[harness switched my strategy: ${e.from} -> ${e.to} because ${preview(e.reason, 140)}]`);
    } else if (e.kind === "kernel-state-snapshot") {
      iterationsUsed = e.iter ?? iterationsUsed;
      if (e.terminatedBy) terminatedBy = e.terminatedBy;
      if (e.status) status = e.status;
      if (typeof e.tokens === "number") totalTokens = e.tokens;
    }
  }
  transcriptLines.push("", `MY FINAL ANSWER WAS:\n${preview(finalOutput, 1200)}`);

  return {
    denials,
    signals,
    renderedSignalIds,
    signalEffects,
    verifierRejections,
    iterationsUsed,
    terminatedBy,
    status,
    totalTokens,
    toolsUsed: [...toolsUsed],
    transcript: transcriptLines.join("\n"),
  };
}

// ─── Cross-validation (deterministic) ───────────────────────────────────────

type SurfaceCategory = "allowlist" | "blocklist" | "guidance" | "verification" | "iterations" | "compression" | "optin";

function objectiveCategories(ev: RunEvidence): Map<SurfaceCategory, number> {
  const m = new Map<SurfaceCategory, number>();
  const bump = (k: SurfaceCategory) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const d of ev.denials) {
    if (/not in the allowed commands list/i.test(d.error)) {
      if (/opt-in/i.test(d.error)) bump("optin");
      else bump("allowlist");
    } else if (/blocked by security policy/i.test(d.error)) bump("blocklist");
    else bump("other");
  }
  if (ev.signals.length > 0) bump("guidance");
  if (ev.verifierRejections.length > 0) bump("verification");
  if (ev.terminatedBy && /max-iter|iteration|budget/i.test(ev.terminatedBy)) bump("iterations");
  return m;
}

interface CrossCheck {
  readonly objectiveCategories: Record<string, number>;
  readonly reportedSurfaces: string[];
  readonly blindSpots: string[]; // objective event fired, model never mentioned it
  readonly unverifiable: string[]; // model reported, no objective corroboration
  readonly mentionRate: number;
}

function crossCheck(ev: RunEvidence, interview: Record<string, unknown>): CrossCheck {
  const obj = objectiveCategories(ev);
  const frictions = (interview.frictions ?? []) as { surface: string }[];
  const reported = frictions.map((f) => f.surface);
  const catToSurfaceWords: Record<SurfaceCategory, string[]> = {
    allowlist: ["terminal-allowlist"],
    optin: ["terminal-allowlist"],
    blocklist: ["terminal-blocklist"],
    guidance: ["harness-guidance"],
    verification: ["verification-gate"],
    iterations: ["iteration-budget"],
    compression: ["context-compression"],
    other: [],
  };
  const blindSpots: string[] = [];
  for (const cat of obj.keys()) {
    const surfaces = catToSurfaceWords[cat];
    const touched = surfaces.length === 0 || surfaces.some((s) => reported.includes(s));
    if (!touched) blindSpots.push(cat);
  }
  // Typed signal consumption (2026-10-25): an injected signal that never
  // rendered is a harness communication failure independent of the model's
  // self-report — surface it as its own blind-spot bucket.
  const unrendered = (ev.renderedSignalIds
    ? ev.signals.filter((s) => s.signalId && !ev.renderedSignalIds.includes(s.signalId!))
    : []);
  if (unrendered.length > 0) blindSpots.push("signal-unrendered");
  const allObj = new Set(obj.keys());
  const surfaceToCat: Record<string, SurfaceCategory> = {
    "terminal-allowlist": "allowlist",
    "terminal-blocklist": "blocklist",
    "harness-guidance": "guidance",
    "verification-gate": "verification",
    "iteration-budget": "iterations",
    "context-compression": "compression",
    sandbox: "other",
    "tool-availability": "other",
    "output-format": "other",
    other: "other",
  };
  const unverifiable = reported.filter((s) => {
    const c = surfaceToCat[s];
    return c !== undefined && c !== "other" && !allObj.has(c as SurfaceCategory);
  });
  const totalObj = [...obj.values()].reduce((a, b) => a + b, 0);
  const blind = blindSpots.length;
  return {
    objectiveCategories: Object.fromEntries(obj),
    reportedSurfaces: reported,
    blindSpots,
    unverifiable: [...new Set(unverifiable)],
    mentionRate: totalObj === 0 ? 1 : (totalObj - blind) / totalObj,
  };
}

// ─── Interview call (raw ollama, NOT via harness) ───────────────────────────

async function interview(ev: RunEvidence): Promise<{ json: Record<string, unknown>; raw: string; error?: string }> {
  const userMsg = [
    `TRANSCRIPT OF YOUR RUN (what you saw, in order):`,
    ev.transcript,
    ``,
    `Objective harness facts from your run: iterations used ${ev.iterationsUsed}, terminated by ${ev.terminatedBy ?? "unknown"}, tokens ${ev.totalTokens ?? "?"}, tool errors you hit: ${ev.denials.length}, harness guidance messages injected into your context: ${ev.signals.length}, verifier rejections of your output: ${ev.verifierRejections.length}.`,
    ``,
    `Now answer the calibration interview as instructed, JSON only.`,
  ].join("\n");

  const call = async (extra: string) => {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: INTERVIEW_MODEL,
        stream: false,
        format: "json",
        // bonsai-2 thinks by default (ollama reports capabilities:["thinking"]).
        // Keep thinking ON — it improves reflection quality — but widen
        // num_predict the way the harness does (THINKING_NUM_PREDICT_ALLOWANCE):
        // ollama counts thinking tokens against the cap, and a narrow cap
        // starves `content` to empty with done_reason:"length" (verified
        // 2026-10-24 smoke: num_predict=20 → content "").
        options: { temperature: 0.1, num_ctx: 16384, num_predict: 8000 },
        messages: [
          { role: "system", content: INTERVIEW_SYSTEM },
          { role: "user", content: userMsg + extra },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama interview HTTP ${res.status}: ${preview(await res.text(), 200)}`);
    const data = (await res.json()) as { message?: { content?: string; thinking?: string }; done_reason?: string };
    const content = data.message?.content ?? "";
    if (!content.trim() && data.done_reason === "length") {
      throw new Error("interview content starved by thinking budget (done_reason=length, empty content) — raise num_predict");
    }
    return content;
  };

  let raw = "";
  try {
    raw = await call("");
    const fixed = repairJson(raw);
    if (fixed) return { json: fixed, raw };
    // one retry with a stricter framing
    raw = await call("\n\nYour previous reply was not valid JSON. Output ONLY the JSON object, correctly escaped, nothing else.");
    const fixed2 = repairJson(raw);
    if (fixed2) return { json: fixed2, raw };
    return { json: {}, raw, error: "interview JSON parse failed after retry + repair" };
  } catch (e) {
    return { json: {}, raw, error: `interview call failed: ${String(e)}` };
  }
}

// ─── Per-task run ───────────────────────────────────────────────────────────

interface TaskRecord {
  id: string;
  goal: string;
  task: string;
  success: boolean;
  runId: string;
  evidence: Omit<RunEvidence, "transcript">;
  finalOutput: string;
  finalError: string | null;
  interview: Record<string, unknown>;
  interviewRaw: string;
  interviewError?: string;
  crossCheck: CrossCheck;
  durationMs: number;
}

async function runTask(t: FrictionTask): Promise<TaskRecord> {
  console.log(`\n${"=".repeat(72)}\nTASK ${t.id} | maxIter ${t.maxIterations}\nGOAL: ${t.goal}\n${"=".repeat(72)}`);
  mkdirSync(`${WORK}`, { recursive: true });
  mkdirSync(TRACE_DIR, { recursive: true });

  const agent = await ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: PROBE_MODEL })
    .withReasoning({ defaultStrategy: "reactive", maxIterations: t.maxIterations })
    .withTools({
      terminal: true,
      builtins: ["file-read", "file-write", "code-execute"],
      allowedTools: [
        "shell-execute", "file-read", "file-write", "code-execute",
        "final-answer", "recall", "find", "checkpoint", "pulse", "brief",
        "discover-tools", "todo", "context-status",
      ],
    })
    .withTracing({ dir: TRACE_DIR })
    .build();

  const start = Date.now();
  const result = await agent.run(t.task);
  const durationMs = Date.now() - start;
  await agent.dispose();

  const events = loadTraceEvents(`${TRACE_DIR}/${result.taskId}.jsonl`);
  const ev = extractEvidence(events, t.task, result.output ?? "");
  console.log(`run ${result.taskId}: success=${result.success} iters=${ev.iterationsUsed}/${t.maxIterations} denials=${ev.denials.length} signals=${ev.signals.length} verifier-rej=${ev.verifierRejections.length} terminatedBy=${ev.terminatedBy ?? "?"}`);

  const iv = await interview(ev);
  const cc = crossCheck(ev, iv.json);
  if (iv.error) console.log(`INTERVIEW ERROR: ${iv.error}`);
  else console.log(`interview: verdict=${iv.json.task_verdict} frictions=${(iv.json.frictions as unknown[])?.length ?? 0} one_ask=${preview(iv.json.one_ask ?? "", 120)}`);
  console.log(`cross-check: blindSpots=${cc.blindSpots.join(",") || "none"} mentionRate=${(cc.mentionRate * 100).toFixed(0)}%`);

  const { transcript: _t, ...evCompact } = ev;
  const runError = (result as { error?: string; metadata?: Record<string, unknown> }).error ?? null;
  return {
    id: t.id,
    goal: t.goal,
    task: t.task,
    success: result.success,
    runId: String(result.taskId),
    evidence: evCompact,
    finalOutput: (result.output ?? "").slice(0, 3500),
    finalError: runError,
    interview: iv.json,
    interviewRaw: iv.raw,
    interviewError: iv.error,
    crossCheck: cc,
    durationMs,
  };
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface RankedFriction {
  surface: string;
  count: number;
  maxImpact: number;
  totalImpact: number;
  avgRecoveredRate: number;
  bestFixIdea: string;
  tasks: string[];
}

function aggregate(records: TaskRecord[]): { ranked: RankedFriction[]; blindSpotTally: Record<string, number> } {
  const bySurface = new Map<string, RankedFriction & { recoveredYes: number }>();
  const blindSpotTally: Record<string, number> = {};
  for (const r of records) {
    for (const b of r.crossCheck.blindSpots) blindSpotTally[b] = (blindSpotTally[b] ?? 0) + 1;
    for (const f of ((r.interview.frictions ?? []) as { surface: string; impact?: number; recovered?: boolean; what_would_help?: string }[])) {
      const cur = bySurface.get(f.surface) ?? {
        surface: f.surface, count: 0, maxImpact: 0, totalImpact: 0, avgRecoveredRate: 0,
        bestFixIdea: "", tasks: [], recoveredYes: 0,
      };
      cur.count += 1;
      cur.maxImpact = Math.max(cur.maxImpact, f.impact ?? 1);
      cur.totalImpact += f.impact ?? 1;
      if (f.recovered) cur.recoveredYes += 1;
      if (f.what_would_help && f.what_would_help.length > cur.bestFixIdea.length) cur.bestFixIdea = f.what_would_help;
      if (!cur.tasks.includes(r.id)) cur.tasks.push(r.id);
      bySurface.set(f.surface, cur);
    }
  }
  const ranked = [...bySurface.values()]
    .map(({ recoveredYes, ...rest }) => ({ ...rest, avgRecoveredRate: rest.count ? recoveredYes / rest.count : 0 }))
    .sort((a, b) => b.totalImpact - a.totalImpact || b.count - a.count);
  return { ranked, blindSpotTally };
}

function renderMarkdown(records: TaskRecord[], ranked: RankedFriction[], blind: Record<string, number>): string {
  const d = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [
    `# Introspective Probe — ${PROBE_MODEL} × ${records.length} friction tasks (${d})`,
    ``,
    `Model ${PROBE_MODEL} via ${OLLAMA_URL}; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.`,
    ``,
    `## Ranked frictions (by summed impact across tasks)`,
    ``,
    `| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |`,
    `|---|---|---|---|---|---|---|`,
    ...ranked.map((r) => `| ${r.surface} | ${r.count} | ${r.maxImpact} | ${r.totalImpact} | ${Math.round(r.avgRecoveredRate * 100)}% | ${r.tasks.join(" ")} | ${preview(r.bestFixIdea.replace(/\|/g, "\\|"), 140)} |`),
    ``,
    `## Blind spots (objective harness events the model did NOT report)`,
    ``,
    ...Object.entries(blind).map(([k, v]) => `- \`${k}\` fired in ${v} task(s) with no self-report — harness communication failure`),
    Object.keys(blind).length === 0 ? `- none` : "",
    ``,
    `## Per-task`,
    ``,
  ];
  for (const r of records) {
    lines.push(
      `### ${r.id} — ${r.goal}`,
      `- run \`${r.runId}\` success=${r.success} iters=${r.evidence.iterationsUsed}/${"?"} terminatedBy=${r.evidence.terminatedBy ?? "?"} (${Math.round(r.durationMs / 1000)}s, ${r.evidence.totalTokens ?? "?"} tok)`,
      `- objective: ${r.evidence.denials.length} tool errors, ${r.evidence.signals.length} injected signals, ${r.evidence.verifierRejections.length} verifier rejections`,
      `- self-verdict: ${r.interview.task_verdict ?? "?"} | deliverable_ok=${r.interview.deliverable_ok ?? "?"} | one_ask: ${preview(r.interview.one_ask ?? "", 200)}`,
      `- cross-check: mentionRate=${Math.round(r.crossCheck.mentionRate * 100)}% blind=[${r.crossCheck.blindSpots.join(",")}] unverifiable=[${r.crossCheck.unverifiable.join(",")}]`,
    );
    for (const f of (r.interview.frictions ?? []) as { surface: string; wanted?: string; what_happened?: string; impact?: number; what_would_help?: string }[]) {
      lines.push(`  - **${f.surface}** (impact ${f.impact ?? "?"}): wanted "${preview(f.wanted ?? "", 90)}" → "${preview(f.what_happened ?? "", 120)}" → help: "${preview(f.what_would_help ?? "", 120)}"`);
    }
    for (const d2 of r.evidence.denials.slice(0, 5)) {
      lines.push(`  - denial: \`${preview(d2.command ?? d2.tool, 80)}\` → "${preview(d2.error, 140)}"`);
    }
    lines.push(``);
  }
  lines.push(`## Model one-asks (raw)`);
  for (const r of records) lines.push(`- **${r.id}**: ${preview(r.interview.one_ask ?? "(none)", 400)}`);
  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const targetId = process.argv[2];
  const toRun = targetId ? TASKS.filter((x) => x.id === targetId) : TASKS;
  if (targetId && toRun.length === 0) {
    console.error(`No task "${targetId}". Available: ${TASKS.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }

  const records: TaskRecord[] = [];
  for (const t of toRun) {
    records.push(await runTask(t));
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(/:/g, "-");
  mkdirSync("wiki/Research/Harness-Reports", { recursive: true });
  const { ranked, blindSpotTally } = aggregate(records);

  writeFileSync(`wiki/Research/Harness-Reports/introspective-${stamp}.json`, JSON.stringify({ model: PROBE_MODEL, records }, null, 2));
  const md = renderMarkdown(records, ranked, blindSpotTally);
  writeFileSync(`wiki/Research/Harness-Reports/introspective-${stamp}.md`, md);

  console.log(`\n${"=".repeat(72)}\nRANKED FRICTIONS\n${"=".repeat(72)}`);
  for (const r of ranked) console.log(`${r.surface.padEnd(22)} count=${r.count} maxImpact=${r.maxImpact} Σ=${r.totalImpact} recovered=${Math.round(r.avgRecoveredRate * 100)}%`);
  console.log(`\nBlind-spot tally: ${JSON.stringify(blindSpotTally)}`);
  console.log(`\nJSON: wiki/Research/Harness-Reports/introspective-${stamp}.json`);
  console.log(`MD:   wiki/Research/Harness-Reports/introspective-${stamp}.md`);
  console.log(`Drill: bun run rax:diagnose replay ${records[0]?.runId ?? "<runId>"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
