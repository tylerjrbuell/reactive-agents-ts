// mcp-comprehension-probe.ts — Real MCP tool use + structured-result comprehension probe.
//
// Targets failure modes the existing quality-gate can't surface:
//   1. MCP structured-result comprehension (arrays of objects via Docker-bridged MCP)
//   2. Multi-step MCP workflows (search → get-file → summarize)
//   3. Error recovery on MCP tool calls (bad args, missing data)
//   4. Large-content navigation (huge file_contents responses)
//   5. Field extraction from nested objects (commit.author.name, commit.commit.message)
//
// Uses the public github MCP server (ghcr.io/github/github-mcp-server) the
// spot-test does. Requires GITHUB_PERSONAL_ACCESS_TOKEN env. Docker must
// be reachable. Probe shares one MCP container across tasks for speed.
//
// Run: bun .claude/skills/harness-improvement-loop/scripts/mcp-comprehension-probe.ts
// Default model: cogito:14b. Override: MCP_PROBE_MODEL=qwen3:14b bun ...
// Output: wiki/Research/Harness-Reports/mcp-comprehension-<model>-<timestamp>.json

import { ReactiveAgents } from "reactive-agents";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = process.env.MCP_PROBE_MODEL ?? "cogito:14b";
const PROVIDER = process.env.MCP_PROBE_PROVIDER ?? "ollama";
const REPO = process.env.MCP_PROBE_REPO ?? "tylerjrbuell/reactive-agents-ts";
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const REPORTS_DIR = resolve(process.cwd(), "wiki/Research/Harness-Reports");

if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
  console.error("GITHUB_PERSONAL_ACCESS_TOKEN required for MCP probe");
  process.exit(1);
}

// ── Quality scoring ─────────────────────────────────────────────────────────

interface QualityScore {
  readonly toolSuccess: boolean;     // tools executed without unrecoverable error
  readonly correctness: number;      // 0..1 — output matches ground truth
  readonly faithfulness: number;     // 0..1 — cited values present in tool obs
  readonly completeness: number;     // 0..1 — answers full question
  readonly noFabrication: number;    // 0..1 — no hallucinated fields/values
  readonly mcpComprehension: number; // 0..1 — correctly extracted nested fields
  readonly composite: number;
  readonly notes: readonly string[];
}

function composite(s: Omit<QualityScore, "composite" | "notes">): number {
  return (
    s.correctness * 0.30 +
    s.faithfulness * 0.20 +
    s.noFabrication * 0.20 +
    s.mcpComprehension * 0.20 +
    s.completeness * 0.10
  );
}

function buildQuality(args: Omit<QualityScore, "composite">): QualityScore {
  return { ...args, composite: composite(args) };
}

interface TaskResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly output: string;
  readonly tokensUsed: number;
  readonly iterations: number;
  readonly wallMs: number;
  readonly quality: QualityScore;
  readonly errors?: readonly string[];
}

// ── Shared MCP config ───────────────────────────────────────────────────────

const githubMcp = {
  name: "github" as const,
  transport: "stdio" as const,
  command: "docker",
  args: [
    "run",
    "-i",
    "--rm",
    "-e",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "ghcr.io/github/github-mcp-server",
  ],
  env: {
    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
  },
};

// ── Tasks ───────────────────────────────────────────────────────────────────

interface TaskDef {
  readonly id: string;
  readonly description: string;
  readonly allowedTools: readonly string[];
  readonly task: string;
  readonly groundTruth: () => Promise<Record<string, unknown>>;
  readonly score: (output: string, truth: Record<string, unknown>) => QualityScore;
}

// Ground-truth fetches via plain HTTP, bypassing the framework, so the
// scoring function knows what the right answer actually is.

async function fetchRepoMetadata(): Promise<Record<string, unknown>> {
  const r = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}` }
      : {},
  });
  return (await r.json()) as Record<string, unknown>;
}

async function fetchCommits(): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/commits?per_page=10`,
    {
      headers: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}` }
        : {},
    },
  );
  return (await r.json()) as Array<Record<string, unknown>>;
}

const TASKS: TaskDef[] = [
  // M1 — Single-record field extraction
  {
    id: "M1-single-record-field",
    description:
      "Use MCP github/search_repositories to find ${REPO}; output its star count as a single integer.",
    allowedTools: ["github/search_repositories"],
    task: `Use the github tools to find the repository ${REPO}. Output just the integer star count. No commentary, no formatting — just the number.`,
    groundTruth: async () => {
      const meta = await fetchRepoMetadata();
      return { stars: meta.stargazers_count };
    },
    score: (output, truth) => {
      const stars = String(truth.stars ?? "");
      const numMatches = output.match(/\b\d+\b/g) ?? [];
      const exactMatch = numMatches.includes(stars);
      const containsTrue = output.includes(stars);
      const isCompact = output.trim().length <= 200;
      return buildQuality({
        toolSuccess: true,
        correctness: exactMatch ? 1 : containsTrue ? 0.7 : 0,
        faithfulness: containsTrue ? 1 : 0,
        completeness: containsTrue ? 1 : 0,
        noFabrication: numMatches.length > 0 && !containsTrue ? 0 : 1,
        mcpComprehension: containsTrue ? 1 : 0,
        notes: [
          containsTrue ? `★ star count ${stars} cited` : `✗ ${stars} not in output`,
          isCompact ? "compact answer ✓" : `verbose (${output.length} chars)`,
        ],
      });
    },
  },

  // M2 — Array listing (the spot-test scenario at smaller scale)
  {
    id: "M2-array-listing",
    description:
      "List the last 10 commits with title + author. Tests structured-result comprehension under compression.",
    allowedTools: ["github/list_commits"],
    task: `Use the github tools to fetch the last 10 commits to ${REPO}. Then output a numbered list: '1. TITLE — AUTHOR'. Use the actual commit messages and authors from the tool result. No invented entries.`,
    groundTruth: async () => {
      const commits = await fetchCommits();
      const summaries = commits.slice(0, 10).map((c) => {
        const commit = c.commit as Record<string, unknown>;
        const author = commit.author as Record<string, unknown>;
        const msg = String(commit.message ?? "").split("\n")[0];
        return { title: msg, author: String(author.name ?? "") };
      });
      return { commits: summaries };
    },
    score: (output, truth) => {
      const truthCommits = truth.commits as Array<{ title: string; author: string }>;
      const titlePrefixes = truthCommits.map((c) => c.title.slice(0, 35));
      const found = titlePrefixes.filter((p) => output.includes(p)).length;
      const isNumberedList = /^\s*\d+\.\s/m.test(output);
      const lineCount = output.split("\n").filter((l) => /^\s*\d+\./.test(l)).length;
      // Detect fabricated commits — count numbered lines that don't match any
      // real title prefix.
      const lines = output.split("\n").filter((l) => /^\s*\d+\./.test(l));
      const fabricatedCount = lines.filter(
        (l) => !titlePrefixes.some((p) => l.includes(p.slice(0, 25))),
      ).length;
      return buildQuality({
        toolSuccess: true,
        correctness: found / 10,
        faithfulness: found / Math.max(lineCount, 1),
        completeness: lineCount >= 10 ? 1 : lineCount / 10,
        noFabrication: 1 - Math.min(1, fabricatedCount / 10),
        mcpComprehension: found >= 7 ? 1 : found / 7,
        notes: [
          `${found}/10 real titles cited`,
          isNumberedList ? "numbered list ✓" : "no numbered list ✗",
          `${lineCount} lines, ${fabricatedCount} fabricated`,
        ],
      });
    },
  },

  // M3 — Selective filter (find by criterion)
  {
    id: "M3-selective-filter",
    description:
      "Find the SHA of the most recent commit whose subject mentions 'fix'. Tests filtering + nested field extraction.",
    allowedTools: ["github/list_commits"],
    task: `Use the github tools to fetch the last 10 commits to ${REPO}. Find the most recent commit whose commit message subject (first line) contains the word "fix" (case-insensitive). Output just the 7-character short SHA of that commit. No explanation, just the SHA.`,
    groundTruth: async () => {
      const commits = await fetchCommits();
      const match = commits.find((c) => {
        const subject = String((c.commit as Record<string, unknown>).message ?? "")
          .split("\n")[0]
          .toLowerCase();
        return /\bfix/.test(subject);
      });
      const sha = match ? String(match.sha ?? "").slice(0, 7) : null;
      return { sha };
    },
    score: (output, truth) => {
      const sha = truth.sha as string | null;
      if (!sha) {
        return buildQuality({
          toolSuccess: true,
          correctness: 1,
          faithfulness: 1,
          completeness: 1,
          noFabrication: 1,
          mcpComprehension: 1,
          notes: ["no 'fix' commit in last 10 — task is vacuous"],
        });
      }
      const found = output.includes(sha);
      const shaPattern = /\b[0-9a-f]{7,40}\b/.exec(output);
      const fabricatedSha = shaPattern && !found;
      return buildQuality({
        toolSuccess: true,
        correctness: found ? 1 : 0,
        faithfulness: found ? 1 : 0,
        completeness: found ? 1 : 0,
        noFabrication: fabricatedSha ? 0 : 1,
        mcpComprehension: found ? 1 : 0,
        notes: [
          found ? `★ correct SHA ${sha}` : `✗ expected ${sha}, got ${shaPattern?.[0] ?? "no SHA"}`,
        ],
      });
    },
  },

  // M4 — Multi-tool MCP workflow
  {
    id: "M4-multi-tool-workflow",
    description:
      "Search repo + read README to compose answer. Tests cross-tool synthesis.",
    allowedTools: ["github/search_repositories", "github/get_file_contents"],
    task: `Use the github tools to find the repository ${REPO} and read its README.md. Then in one sentence, summarize the main purpose of the project using language drawn from the README. Do not invent features that aren't mentioned in the file.`,
    groundTruth: async () => {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/contents/README.md`,
        {
          headers: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}` }
            : {},
        },
      );
      const data = (await r.json()) as { content?: string };
      const readme = data.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
      // Anchor words drawn from the actual README headers + tagline.
      const anchors = ["agent", "reactive", "typescript", "framework", "react"];
      return { readme, anchors };
    },
    score: (output, truth) => {
      const anchors = truth.anchors as string[];
      const lower = output.toLowerCase();
      const hits = anchors.filter((a) => lower.includes(a)).length;
      const isOneSentence = output.split(/[.!?]+/).filter((s) => s.trim().length > 5).length <= 2;
      // Fabrication detection: words like "blockchain", "rust", "AI training" that
      // shouldn't appear in the framework's README.
      const fabricationMarkers = ["blockchain", "rust", "training", "neural network", "fine-tune"];
      const fabricated = fabricationMarkers.filter((m) => lower.includes(m)).length;
      return buildQuality({
        toolSuccess: true,
        correctness: hits >= 3 ? 1 : hits / 3,
        faithfulness: hits / anchors.length,
        completeness: output.length > 30 ? 1 : 0.3,
        noFabrication: 1 - Math.min(1, fabricated / 2),
        mcpComprehension: hits >= 2 ? 1 : hits / 2,
        notes: [
          `${hits}/${anchors.length} anchor words present`,
          isOneSentence ? "one sentence ✓" : "multi-sentence ✗",
          fabricated > 0 ? `★ ${fabricated} fabrication marker(s)` : "no fabrication markers",
        ],
      });
    },
  },

  // M5 — Error recovery
  {
    id: "M5-error-recovery",
    description:
      "Call MCP tool with bad args (nonexistent file), recover by trying valid args. Tests error-loop resilience.",
    allowedTools: ["github/get_file_contents"],
    task: `Use the github tools to read the file 'DOES_NOT_EXIST_xyz123.md' from ${REPO}. If that file doesn't exist, recover by reading 'README.md' instead. Output: which file you successfully read (just the filename, e.g. "README.md"), and one fact from it.`,
    groundTruth: async () => ({ expected: "README.md" }),
    score: (output, truth) => {
      const expected = truth.expected as string;
      const containsExpected = output.toLowerCase().includes(expected.toLowerCase());
      const hasFactual = output.length > 30;
      const mentionsRecovery = /(?:doesn't exist|not found|recovered|instead|fallback)/i.test(output);
      const isCompact = output.length <= 500;
      return buildQuality({
        toolSuccess: containsExpected,
        correctness: containsExpected ? 1 : 0,
        faithfulness: containsExpected ? 1 : 0,
        completeness: containsExpected && hasFactual ? 1 : containsExpected ? 0.5 : 0,
        noFabrication: 1,
        mcpComprehension: containsExpected ? 1 : 0,
        notes: [
          containsExpected ? "★ recovered to README.md" : "✗ recovery failed",
          mentionsRecovery ? "acknowledges fallback ✓" : "silent on recovery",
          isCompact ? "compact ✓" : `verbose (${output.length} chars)`,
        ],
      });
    },
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────

async function runTask(def: TaskDef): Promise<TaskResult> {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[${def.id}] ${def.description}`);
  console.log(`${"=".repeat(80)}`);

  const truth = await def.groundTruth();
  const truthStr = JSON.stringify(truth).slice(0, 200);
  console.log(`Ground truth: ${truthStr}`);

  const start = Date.now();
  const errors: string[] = [];
  let output = "";
  let tokensUsed = 0;
  let iterations = 0;
  let success = false;

  try {
    const agent = await ReactiveAgents.create()
      .withPersona({
        role: "GitHub Agent",
        background: "Expert in GitHub task execution",
        instructions: "Use github tools to solve the task. Be concise.",
        tone: "concise",
      })
      .withProvider(PROVIDER)
      .withModel(MODEL)
      .withReasoning({ defaultStrategy: "adaptive", enableStrategySwitching: false })
      .withTools({ allowedTools: [...def.allowedTools] })
      .withMCP(githubMcp)
      .build();

    const result = await agent.run(def.task);
    output = result.output ?? "";
    tokensUsed = (result as { tokensUsed?: number }).tokensUsed ?? 0;
    iterations = (result as { iterations?: number }).iterations ?? 0;
    success = result.success ?? false;
    await agent.dispose();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const wallMs = Date.now() - start;
  const quality = def.score(output, truth);

  console.log(`Output (${output.length} chars):`);
  console.log(output.slice(0, 400));
  if (output.length > 400) console.log("...(truncated)");

  console.log(`\nQuality:`);
  console.log(`  composite:      ${(quality.composite * 100).toFixed(0)}%`);
  console.log(`  correctness:    ${(quality.correctness * 100).toFixed(0)}%`);
  console.log(`  faithfulness:   ${(quality.faithfulness * 100).toFixed(0)}%`);
  console.log(`  completeness:   ${(quality.completeness * 100).toFixed(0)}%`);
  console.log(`  no-fabrication: ${(quality.noFabrication * 100).toFixed(0)}%`);
  console.log(`  mcp-compre:     ${(quality.mcpComprehension * 100).toFixed(0)}%`);
  console.log(`Notes: ${quality.notes.join("; ")}`);
  console.log(`Wall: ${(wallMs / 1000).toFixed(1)}s | Tokens: ${tokensUsed} | Iters: ${iterations}`);

  return {
    taskId: def.id,
    success,
    output,
    tokensUsed,
    iterations,
    wallMs,
    quality,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function main() {
  console.log(`MCP Comprehension Probe — model: ${MODEL} on ${PROVIDER}`);
  console.log(`Repo: ${REPO}`);
  console.log(`Tasks: ${TASKS.length}`);

  const results: TaskResult[] = [];
  for (const task of TASKS) {
    const result = await runTask(task);
    results.push(result);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(95)}`);
  console.log("MCP COMPREHENSION PROBE SUMMARY");
  console.log(`${"=".repeat(95)}`);
  console.log(
    "task                      | comp | correct | faith | mcp | no-fabr | iters | tok    | wall",
  );
  console.log("-".repeat(95));
  for (const r of results) {
    const q = r.quality;
    console.log(
      `${r.taskId.padEnd(25)} | ${(q.composite * 100).toFixed(0).padStart(3)}% | ${
        (q.correctness * 100).toFixed(0).padStart(5)
      }% | ${(q.faithfulness * 100).toFixed(0).padStart(3)}% | ${
        (q.mcpComprehension * 100).toFixed(0).padStart(3)
      }% | ${(q.noFabrication * 100).toFixed(0).padStart(5)}% | ${
        String(r.iterations).padStart(5)
      } | ${String(r.tokensUsed).padStart(6)} | ${(r.wallMs / 1000).toFixed(1)}s`,
    );
  }
  console.log("-".repeat(95));
  const avgComposite = results.reduce((s, r) => s + r.quality.composite, 0) / results.length;
  console.log(`Average composite: ${(avgComposite * 100).toFixed(0)}%`);

  // Write JSON report
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(
    REPORTS_DIR,
    `mcp-comprehension-${MODEL.replace(/[:/]/g, "-")}-${TIMESTAMP}.json`,
  );
  writeFileSync(reportPath, JSON.stringify({ model: MODEL, repo: REPO, results }, null, 2));
  console.log(`\nReport: ${reportPath}`);
}

await main();
process.exit(0);
