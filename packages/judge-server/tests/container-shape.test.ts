// Run: bun test packages/judge-server/tests/container-shape.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dockerfilePath = join(import.meta.dir, "..", "Dockerfile");

describe("judge-server Dockerfile shape", () => {
  it("Dockerfile exists at packages/judge-server/Dockerfile", () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  }, 15000);

  it("pins a specific bun version (no 'oven/bun:latest')", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).not.toMatch(/oven\/bun:latest/);
    expect(content).toMatch(/oven\/bun:[\d.]+/);
  }, 15000);

  it("declares JUDGE_MODEL_SHA build arg", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ARG\s+JUDGE_MODEL_SHA/);
  }, 15000);

  it("declares JUDGE_CODE_SHA build arg", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ARG\s+JUDGE_CODE_SHA/);
  }, 15000);

  it("propagates JUDGE_MODEL_SHA and JUDGE_CODE_SHA to ENV for runtime", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/ENV\s+JUDGE_MODEL_SHA=\$\{JUDGE_MODEL_SHA\}/);
    expect(content).toMatch(/ENV\s+JUDGE_CODE_SHA=\$\{JUDGE_CODE_SHA\}/);
  }, 15000);

  it("exposes port 8910", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/EXPOSE\s+8910/);
  }, 15000);

  it("uses bun install --frozen-lockfile for reproducibility", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/bun install --frozen-lockfile/);
  }, 15000);

  it("CMD or ENTRYPOINT runs the judge-server src/index.ts", () => {
    const content = readFileSync(dockerfilePath, "utf8");
    expect(content).toMatch(/(CMD|ENTRYPOINT).*judge-server\/src\/index\.ts/);
  }, 15000);
});
