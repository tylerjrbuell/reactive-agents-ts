/**
 * section-coverage-grade.ts — faithfulness grade for the overflow-summarize A/B.
 *
 * The cohort comparator's "deliverable-produced" only checks a file EXISTS — it
 * cannot tell a faithful 22/22 summary from a dishonest partial that claims
 * completeness. This grader closes that hole for the #1 (content-aware projection)
 * A/B: it extracts the source doc's `##` section titles and reports how many the
 * produced summary actually covers. Apply to BOTH arms; re-grade legacy (its
 * "faithful" grade was lenient — it silently dropped tail sections).
 *
 * Usage: bun run section-coverage-grade.ts <source.md> <summary.md>
 */
import { readFileSync, existsSync } from "node:fs";

const [, , sourcePath, summaryPath] = process.argv;
if (!sourcePath || !summaryPath) {
  console.error("usage: bun run section-coverage-grade.ts <source.md> <summary.md>");
  process.exit(1);
}

const sections = readFileSync(sourcePath, "utf8")
  .split("\n")
  .filter((l) => /^##\s+/.test(l))
  .map((l) => l.replace(/^##\s+/, "").trim());

if (!existsSync(summaryPath)) {
  console.log(JSON.stringify({ summaryExists: false, covered: 0, total: sections.length, coverage: 0, missing: sections }));
  process.exit(0);
}

const summary = readFileSync(summaryPath, "utf8").toLowerCase();
// A section is "covered" if a distinctive chunk of its title appears in the summary.
// Use the title's first 3 significant words (lowercased) to tolerate paraphrase.
const norm = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ");

const covered: string[] = [];
const missing: string[] = [];
for (const s of sections) {
  const key = norm(s);
  // require the first significant word + at least one more, to avoid spurious hits
  const words = key.split(" ");
  const hit = words[0] !== undefined && summary.includes(words[0]) &&
    (words.length < 2 || words.slice(1).some((w) => summary.includes(w)));
  (hit ? covered : missing).push(s);
}

console.log(JSON.stringify({
  summaryExists: true,
  summaryChars: summary.length,
  total: sections.length,
  covered: covered.length,
  coverage: Number((covered.length / sections.length).toFixed(2)),
  missing,
}, null, 2));
