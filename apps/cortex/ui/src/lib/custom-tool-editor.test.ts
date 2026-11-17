import { describe, expect, test } from "bun:test";
import { customToolChanges, customToolProblem, EMPTY_PARAM_ROW, paramsFromRows, previewJson, removeRow, rowsFromParams, setRow } from "./custom-tool-editor.js";

const saved = [{ name: "query", type: "string", required: true, description: "Search", enum: ["a", "b"] }];

describe("rows and params", () => {
  test("a saved tool round-trips through the rows", () => {
    expect(paramsFromRows(rowsFromParams(saved))).toEqual(saved);
    expect(rowsFromParams(saved)[0]?.enumText).toBe("a, b");
  });

  test("blank-name rows are dropped and an empty enum is left out", () => {
    const rows = [{ ...EMPTY_PARAM_ROW }, { ...EMPTY_PARAM_ROW, name: " limit ", type: "number", enumText: " , " }];
    expect(paramsFromRows(rows)).toEqual([{ name: "limit", type: "number", required: false, description: "" }]);
  });

  test("preview is the JSON the server stores", () => {
    expect(JSON.parse(previewJson(rowsFromParams(saved)))).toEqual(saved);
    expect(previewJson([])).toBe("[]");
  });

  test("setRow and removeRow return new arrays and ignore a bad index", () => {
    const rows = rowsFromParams(saved);
    expect(setRow(rows, 0, { required: false })[0]?.required).toBe(false);
    expect(rows[0]?.required).toBe(true);
    expect(setRow(rows, 5, { required: false })).toEqual(rows);
    expect(removeRow(rows, 0)).toEqual([]);
  });
});

describe("customToolProblem", () => {
  const ok = { name: "my-tool", description: "Does it", rows: rowsFromParams(saved) };

  test("a good draft has no problem", () => expect(customToolProblem(ok)).toBeNull());

  test("kebab name, description and duplicate parameter names", () => {
    expect(customToolProblem({ ...ok, name: "My Tool" })).toContain("kebab-case");
    expect(customToolProblem({ ...ok, name: "" })).toContain("kebab-case");
    expect(customToolProblem({ ...ok, description: "  " })).toContain("description");
    expect(customToolProblem({ ...ok, rows: [...ok.rows, ...ok.rows] })).toBe('Two parameters are named "query".');
  });
});

describe("customToolChanges", () => {
  const base = { name: "my-tool", description: "Does it", parameters: saved };
  const same = { name: "my-tool", description: "Does it", rows: rowsFromParams(saved) };

  test("nothing changed is null, so Save sends no request", () => {
    expect(customToolChanges(base, same)).toBeNull();
  });

  test("only the changed fields go out", () => {
    expect(customToolChanges(base, { ...same, description: "New" })).toEqual({ description: "New" });
    expect(customToolChanges(base, { ...same, name: "other" })).toEqual({ name: "other" });
    expect(customToolChanges(base, { ...same, rows: [] })).toEqual({ parameters: [] });
  });
});
