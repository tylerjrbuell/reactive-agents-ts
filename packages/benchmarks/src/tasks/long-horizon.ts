import type { BenchmarkTask } from "../types.js"

// ── Long-horizon research-and-deliver tasks (lh-*) ────────────────────────────
//
// lh-1 is the instrument for the "long-horizon" disease surfaced in the
// 2026-07-08 sweep (write-only harness / no shared progress currency /
// deliverable-blind): a task that CANNOT finish inside the 420s bench wall and
// demands the agent sustain progress across ≥40 tool-using iterations while
// producing a structured multi-file deliverable — not a single text answer.
//
// The N=6 research questions (Q1–Q6) each require multi-source web gathering.
// The deliverable is three files the agent WRITES into its working dir:
//   - findings.json — machine-checkable: array of one entry per question.
//   - report.md     — the human-facing synthesis, one section per question.
//   - sources.md    — the flat list of every source URL used.
//
// Deterministic scoring (anti-reward-hack, mirrors rw-7 a9727e8c): the success
// criterion runs a SCORER-WRITTEN hidden-reference.test.ts (never visible to
// the agent) with partial credit. Its assertions are STRUCTURAL and
// CONSISTENCY checks over the three files — a vacuous/empty deliverable scores
// 0, a complete one scores 1, and partial coverage earns partial credit. It
// deliberately does NOT judge factual truth (that is the LLM-judge rubrics'
// job) — only that every question is addressed with a sourced answer and that
// the deliverable is internally consistent (every cited source is listed).

/**
 * Stable research-question IDs. The prompt, the deliverable format, and the
 * hidden reference tests all key off these — changing them is a breaking
 * change to the instrument.
 */
export const LH1_QUESTION_IDS: readonly string[] = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]

/** Floor on the number of distinct source URLs the whole deliverable must cite. */
export const LH1_MIN_SOURCES = 6

/** Floor on the length (chars) of each per-question answer in findings.json. */
const LH1_MIN_ANSWER_CHARS = 40

/** Floor on the length (chars) of each per-question section body in report.md. */
const LH1_MIN_SECTION_CHARS = 120

/**
 * Hidden reference tests (anti-reward-hack). Written by the scorer AFTER the
 * agent run, run ONLY as `bun test ./hidden-reference.test.ts` with partial
 * credit, so agent-authored tests can neither inflate nor poison the grade.
 *
 * Reads the agent's three deliverable files from the CWD (scoreVerifiable
 * spawns bun with cwd = the per-cell tmpDir). Each check is its own `it()` so
 * the pass/total ratio yields graded partial credit: one test per question
 * (Q1–Q6) plus structural + consistency tests. All values are baked in from
 * the exported constants above so the test file and the task stay in lockstep.
 */
function generateLh1HiddenReferenceTests(): string {
  const ids = JSON.stringify(LH1_QUESTION_IDS)
  return `// hidden-reference.test.ts — reference checks for the lh-1 deliverable.
// Written by the benchmark scorer AFTER the agent run. Not agent-authored.
import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"

const QUESTION_IDS: string[] = ${ids}
const MIN_SOURCES = ${LH1_MIN_SOURCES}
const MIN_ANSWER_CHARS = ${LH1_MIN_ANSWER_CHARS}
const MIN_SECTION_CHARS = ${LH1_MIN_SECTION_CHARS}
const URL_RE = /https?:\\/\\/[^\\s)\\]"'<>]+/g

function readOr(path: string, fallback: string): string {
  try { return readFileSync(path, "utf8") } catch { return fallback }
}

interface Finding { id?: unknown; question?: unknown; answer?: unknown; sources?: unknown }

function loadFindings(): Finding[] {
  const raw = readOr("findings.json", "")
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  // Accept either a bare array or an object with a findings/results array.
  if (Array.isArray(parsed)) return parsed as Finding[]
  if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) return v as Finding[]
    }
  }
  return []
}

function findingFor(id: string): Finding | undefined {
  return loadFindings().find((f) => String(f.id ?? "").toUpperCase() === id.toUpperCase())
}

function urlsIn(text: string): string[] {
  return [...(text.match(URL_RE) ?? [])].map((u) => u.replace(/[.,]+$/, ""))
}

// Non-stateful URL presence check — never call the /g regex's .test() directly
// (its lastIndex is stateful across calls and would flap).
function hasUrl(text: string): boolean {
  return urlsIn(text).length > 0
}

const report = readOr("report.md", "")
const sources = readOr("sources.md", "")

describe("lh-1 deliverable structure", () => {
  it("findings.json is a non-empty array covering exactly the required question IDs", () => {
    const findings = loadFindings()
    expect(findings.length).toBeGreaterThanOrEqual(QUESTION_IDS.length)
    const ids = new Set(findings.map((f) => String(f.id ?? "").toUpperCase()))
    for (const q of QUESTION_IDS) expect(ids.has(q)).toBe(true)
  })

  it("sources.md lists at least the required floor of distinct source URLs", () => {
    const distinct = new Set(urlsIn(sources))
    expect(distinct.size).toBeGreaterThanOrEqual(MIN_SOURCES)
  })

  it("every source cited in findings.json is listed in sources.md (no orphan citations)", () => {
    const listed = new Set(urlsIn(sources))
    const findings = loadFindings()
    // Vacuous guard: an empty findings set cannot satisfy this consistency check.
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      const cited = Array.isArray(f.sources) ? f.sources.map((s) => String(s)) : []
      expect(cited.length).toBeGreaterThan(0)
      for (const c of cited) {
        const urls = urlsIn(c)
        // Each cited entry must contain a URL, and that URL must be listed.
        expect(urls.length).toBeGreaterThan(0)
        for (const u of urls) expect(listed.has(u)).toBe(true)
      }
    }
  })
})

describe("lh-1 per-question coverage", () => {
  for (const q of QUESTION_IDS) {
    it(\`\${q} is answered with a sourced finding and a report section\`, () => {
      const f = findingFor(q)
      expect(f).toBeDefined()
      expect(String(f!.question ?? "").length).toBeGreaterThan(0)
      const answer = String(f!.answer ?? "")
      expect(answer.length).toBeGreaterThanOrEqual(MIN_ANSWER_CHARS)
      const cited = Array.isArray(f!.sources) ? f!.sources.map((s) => String(s)) : []
      expect(cited.some((c) => hasUrl(c))).toBe(true)
      // report.md must carry a section for this question with real content.
      const marker = report.indexOf(q)
      expect(marker).toBeGreaterThanOrEqual(0)
      const section = report.slice(marker, marker + 400)
      expect(section.length).toBeGreaterThanOrEqual(MIN_SECTION_CHARS)
    })
  }
})
`
}

export const LONG_HORIZON_TASKS: readonly BenchmarkTask[] = [
  {
    id: "lh-1",
    // tier "real-world" wires lh-1 into the realWorldFullSession (tiers:
    // ["real-world"]) automatically; the qwen3:14b competitor session adds it
    // by explicit taskId.
    tier: "real-world",
    name: "Long-horizon research + multi-file deliverable",
    domain: "research",
    strategy: "plan-execute",
    // Six web-researchable questions on an evergreen systems topic (WASI). The
    // deliverable FORMAT is pinned precisely so the deterministic hidden checks
    // are fair (mirrors rw-7 pinning function signatures): findings.json shape,
    // report.md section markers, and sources.md URL list are all specified.
    prompt: `You are conducting a multi-source research investigation into WebAssembly outside the browser (the WASI / component-model ecosystem). Answer ALL SIX questions below. Each question requires gathering and cross-checking information from MULTIPLE independent web sources — do not rely on a single page. This is a long task: plan your searches, work through the questions methodically, and keep every question in scope until all six are complete.

Research questions:
- Q1: What is WASI (the WebAssembly System Interface) and what specific problem does it solve that core WebAssembly does not?
- Q2: What are the major server-side / standalone WebAssembly runtimes (e.g. Wasmtime, WasmEdge, Wasmer), and how do they differ in focus and capabilities?
- Q3: What is the WASI Preview 2 "component model", what does it change versus Preview 1, and what is its current standardization status?
- Q4: Which source languages can compile to WASI today, and what are the notable limitations for each (e.g. threading, networking, GC)?
- Q5: What are concrete production or near-production use cases and named adopters of server-side WebAssembly?
- Q6: What are the main open technical challenges and documented criticisms of the WASI/component-model approach today?

Produce THREE deliverable files in your working directory. The exact filenames and formats are REQUIRED:

1. findings.json — a JSON array with exactly one object per question. Each object MUST have these keys:
   - "id": the question ID string, one of "Q1".."Q6"
   - "question": the question text
   - "answer": your synthesized answer (at least a few sentences)
   - "sources": a non-empty array of the source URLs (full https URLs) you used for THIS question

2. report.md — a Markdown report with one "## Q1", "## Q2", … "## Q6" section heading per question (the ID must appear in the heading), each section containing a substantive written synthesis for that question, plus a short overall summary.

3. sources.md — a Markdown list of EVERY source URL you cited anywhere in findings.json. Every URL that appears in any finding's "sources" array MUST also appear here. Use full https URLs.

Do not fabricate sources or facts. If sources conflict or a question cannot be fully answered from available evidence, say so explicitly in that question's answer.`,
    requiresTools: true,
    // web-search + file-write are the ALL-OF grounding set: the task cannot be
    // honestly done without searching the web AND writing the deliverable
    // files. http-get (fetch a specific page) and file-read (re-read own
    // drafts) are available but not gated — forcing them would risk refusing a
    // terminal answer from a model that gathered via search alone (see the
    // rw-2 over-requiring lesson at the runner's withRequiredTools callsite).
    tools: [
      { kind: "required", name: "web-search" },
      { kind: "required", name: "file-write" },
      { kind: "available", name: "http-get" },
      { kind: "available", name: "file-read" },
    ],
    // ≥40-iteration horizon. 50 gives the agent room to run 6 research threads
    // (search → fetch → note) plus three write passes without starving.
    maxIterations: 50,
    // Per-task wall override: the shared 420s competitor wall buys ~7–20 local
    // iterations — far short of a 40+ iteration research task. 1800s (30 min)
    // gives real headroom above the observed per-iteration cost on local
    // models. Unset on every other task, so existing behavior is unchanged.
    timeoutSec: 1800,
    hiddenFixtures: [
      { path: "hidden-reference.test.ts", content: generateLh1HiddenReferenceTests() },
    ],
    successCriteria: {
      type: "verifiable",
      // Exact ./-prefixed path (not a bare filter) so only the scorer's
      // reference file runs — an agent file whose name merely contains
      // "hidden-reference" cannot join the run and dilute partial credit.
      command: "bun test ./hidden-reference.test.ts",
      partialCredit: true,
    },
    primaryDimensions: ["accuracy", "reasoning", "loop-intelligence"],
    // One judge rubric per requirement-family of a long-horizon research task.
    // (accuracy is scored deterministically by the verifiable criterion above,
    // so it is intentionally NOT repeated here — scoreTask skips accuracy in the
    // dimensionRubrics loop.)
    dimensionRubrics: [
      {
        dimension: "reasoning",
        rubric: "Across all six questions, does the agent synthesize across multiple sources rather than copy-pasting one, and does the report.md summary tie the findings together into a coherent picture (e.g. how Preview 2 relates to runtime and language support)?",
      },
      {
        dimension: "tool-mastery",
        rubric: "Does the agent gather from multiple independent sources per question (not a single page reused everywhere)? Does it use search then targeted fetches effectively, and avoid redundant re-searches for facts it already has?",
      },
      {
        dimension: "loop-intelligence",
        rubric: "Over this long (40+ iteration) horizon, does the agent make steady forward progress question-by-question, or does it stall, loop, or repeat the same search? Does it converge and produce the deliverable rather than churning?",
      },
      {
        dimension: "memory-fidelity",
        rubric: "Are ALL six questions (Q1–Q6) carried to completion with no earlier question silently dropped once later ones are started? Does the final deliverable cover the same six requirements stated at the outset?",
      },
      {
        dimension: "honest-uncertainty",
        rubric: "Where sources conflict or a question cannot be fully answered, does the agent flag it explicitly rather than fabricating a confident answer or inventing sources?",
      },
    ],
    optimalHarnessConfig: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true, strategy: "plan-execute" },
    tags: ["long-horizon", "research", "multi-file-deliverable", "web-search", "horizon:long"],
  },
]
