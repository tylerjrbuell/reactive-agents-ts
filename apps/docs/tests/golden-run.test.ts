import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { goldenRunProblems, MAX_MINORS_BEHIND } from "../scripts/golden-run-freshness";
import { builderSnippet, highlightLine } from "../src/components/highlight-builder";

const cap = (frameworkVersion: string, capturedAt = "2026-11-17") => ({ capture: { frameworkVersion, capturedAt } });

describe("golden-run freshness guard", () => {
  it("passes when captured on the current minor", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), "0.18.0")).toEqual([]);
  });

  it("passes at exactly the allowed lag", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), `0.${18 + MAX_MINORS_BEHIND}.0`)).toEqual([]);
  });

  it("fails when a simulated newer version is more than two minors ahead", () => {
    const problems = goldenRunProblems("g", cap("0.18.0"), "0.21.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("3 minors behind");
  });

  it("fails on a major bump", () => {
    expect(goldenRunProblems("g", cap("0.18.0"), "1.0.0")[0]).toContain("major differs");
  });

  it("fails when the capture block or date is missing", () => {
    expect(goldenRunProblems("g", {}, "0.18.0")[0]).toContain("capturedAt");
    expect(goldenRunProblems("g", cap("0.18.0", ""), "0.18.0")[0]).toContain("capturedAt");
    expect(goldenRunProblems("g", { capture: { capturedAt: "2026-11-17" } }, "0.18.0")[0]).toContain("frameworkVersion");
  });

  it("the committed data files carry capture provenance and are fresh against VERSION", () => {
    const dir = resolve(import.meta.dir, "../src/data");
    const version = readFileSync(resolve(import.meta.dir, "../../../VERSION"), "utf-8").trim();
    for (const f of ["golden-run.json", "golden-run-failed.json"]) {
      const data = JSON.parse(readFileSync(resolve(dir, f), "utf-8"));
      expect(goldenRunProblems(f, data, version)).toEqual([]);
    }
  });
});

describe("golden-run builder snippet", () => {
  it("highlights keyword, method, string and comment, and escapes markup", () => {
    expect(highlightLine(`const agent = await ReactiveAgents.create()`)).toBe(
      `<span class="rk">const</span> agent = <span class="rk">await</span> ReactiveAgents.<span class="rm">create</span>()`,
    );
    expect(highlightLine(`  .withModel("gemma4:e4b")`)).toBe(`  .<span class="rm">withModel</span>(<span class="rs">"gemma4:e4b"</span>)`);
    expect(highlightLine(`a < b // c`)).toBe(`a &lt; b <span class="rc">// c</span>`);
  });

  it("is derived from the captured lines, not hand-copied", () => {
    const data = JSON.parse(readFileSync(resolve(import.meta.dir, "../src/data/golden-run.json"), "utf-8"));
    const html = builderSnippet(data.capture.builderLines, data.task.prompt).join("\n");
    for (const line of data.capture.builderLines as string[]) {
      expect(html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<")).toContain(line);
    }
  });

  it("RunReplay no longer carries a hand-copied builder constant", () => {
    const src = readFileSync(resolve(import.meta.dir, "../src/components/RunReplay.astro"), "utf-8");
    expect(src).not.toContain("AGENT_CODE");
    expect(src).not.toContain('"gemma4:e4b"');
  });
});
