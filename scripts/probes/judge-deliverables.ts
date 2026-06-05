/**
 * judge-deliverables.ts — frontier-judge the #7 ablation's REAL deliverable outputs.
 *
 * The post-condition gate (pc1) steers cogito to always produce the summary file, but
 * thinner (fewer sections) than the rare honest pc0 success. Section-coverage measures
 * presence; this measures QUALITY: haiku scores each produced summary 0-1 on faithful,
 * useful coverage of the source's actionable content. Answers: is steered output real
 * quality (≥0.6 pass) or just present?
 *
 * Usage: bun run judge-deliverables.ts <source.md> <summary1.md> [summary2.md ...]
 * Needs ANTHROPIC_API_KEY (sourced from repo-root .env by the caller).
 */
import { readFileSync } from "node:fs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("ANTHROPIC_API_KEY required"); process.exit(1); }

const [, , sourcePath, ...summaryPaths] = process.argv;
if (!sourcePath || summaryPaths.length === 0) {
  console.error("usage: bun run judge-deliverables.ts <source.md> <summary.md ...>");
  process.exit(1);
}
const source = readFileSync(sourcePath, "utf8");

const RUBRIC =
  "You are grading a SUMMARY of a source document. Score 0.0-1.0 on how FAITHFULLY and " +
  "USEFULLY the summary covers the source's top-level (## ) sections and their actionable " +
  "content. 1.0 = every major section represented with accurate, useful substance; " +
  "0.6 = passing — most sections covered, usable by a reader; 0.3 = thin/partial, misses " +
  "much; 0.0 = empty or wrong. Penalize missing sections and vague filler. " +
  "Respond ONLY with JSON: {\"score\": <0-1>, \"sectionsCovered\": <int>, \"reason\": \"<one line>\"}.";

async function judge(summary: string): Promise<{ score: number; sectionsCovered: number; reason: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `${RUBRIC}\n\n=== SOURCE ===\n${source}\n\n=== SUMMARY TO GRADE ===\n${summary}`,
      }],
    }),
  });
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? "{}";
  const m = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m?.[0] ?? "{}"); }
  catch { return { score: -1, sectionsCovered: -1, reason: `parse-fail: ${text.slice(0, 80)}` }; }
}

for (const p of summaryPaths) {
  let summary = "";
  try { summary = readFileSync(p, "utf8"); } catch { console.log(`${p}\tMISSING`); continue; }
  const r = await judge(summary);
  console.log(`${p.split("/").pop()}\tscore=${r.score}\tjudgeSections=${r.sectionsCovered}\t${r.reason}`);
}
