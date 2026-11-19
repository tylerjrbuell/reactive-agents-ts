/**
 * Type names re-exported by the `reactive-agents` facade.
 *
 * The package typecheck covers `src/` only, so this test compiles the
 * type-only fixture with the TypeScript compiler (root tsconfig) and expects
 * zero diagnostics. A missing re-export is a diagnostic, and so is a
 * `@ts-expect-error` that stops erroring.
 */
import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import ts from "typescript";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const FIXTURE = path.join(import.meta.dir, "fixtures/facade-types.types.ts");

function compileFixture(): readonly string[] {
  const configPath = path.join(REPO_ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, REPO_ROOT, { noEmit: true }, configPath);
  const program = ts.createProgram([FIXTURE], parsed.options);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => {
      const where = d.file && d.start !== undefined
        ? `${path.relative(REPO_ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
        : "(global)";
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    });
}

describe("reactive-agents facade type re-exports", () => {
  it("ProviderName, JudgmentShadowOptions and the cost helpers/types (CostSum, PriceSource, PriceEntry, BillableUsage, PricedUsage) are exported", () => {
    expect(compileFixture()).toEqual([]);
  }, 120_000);
});
