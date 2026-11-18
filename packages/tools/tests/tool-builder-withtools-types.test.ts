/**
 * `ToolBuilder...build()` fits `.withTools({ tools: [...] })` with no cast,
 * and a built tool without a handler is rejected there.
 *
 * The package typecheck covers `src/` only, so this test compiles the
 * type-only fixture with the TypeScript compiler (root tsconfig, workspace
 * paths) and expects zero diagnostics. The fixture's `@ts-expect-error` lines
 * pin the rejections: one that stops erroring is a diagnostic too.
 */
import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import ts from "typescript";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const FIXTURE = path.join(import.meta.dir, "fixtures/tool-builder-withtools.types.ts");

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

describe("ToolBuilder build() output vs withTools()", () => {
  it("a built tool with a handler fits withTools; one without is rejected", () => {
    expect(compileFixture()).toEqual([]);
  }, 60_000);
});
