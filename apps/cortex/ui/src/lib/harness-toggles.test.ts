import { describe, expect, test } from "bun:test";
import { HARNESS_PLAN_TOGGLES, harnessTextEditable, harnessToggleOn, setHarnessToggle } from "./harness-toggles.js";

const [recon, budget] = [HARNESS_PLAN_TOGGLES[0]!, HARNESS_PLAN_TOGGLES[1]!];

describe("harness plan toggles", () => {
  test("lists the four framework keys with the framework defaults", () => {
    expect(Object.fromEntries(HARNESS_PLAN_TOGGLES.map((t) => [t.key, t.defaultOn]))).toEqual({
      planRecon: false, planBudget: true, wrapUpReserve: false, planToolCatalog: true,
    });
  });

  test("an absent key reads as the framework default; a present boolean wins", () => {
    expect(harnessToggleOn("", recon)).toBe(false);
    expect(harnessToggleOn("", budget)).toBe(true);
    expect(harnessToggleOn('{"planRecon":true,"planBudget":false}', recon)).toBe(true);
    expect(harnessToggleOn('{"planRecon":true,"planBudget":false}', budget)).toBe(false);
    expect(harnessToggleOn('{"planRecon":"yes"}', recon)).toBe(false);
  });

  test("flipping a switch writes its key and keeps the others", () => {
    const next = setHarnessToggle('{"toolIndex": true}', recon, true);
    expect(JSON.parse(next)).toEqual({ toolIndex: true, planRecon: true });
    expect(JSON.parse(setHarnessToggle("", budget, false))).toEqual({ planBudget: false });
  });

  test("text that is not a JSON object is left alone", () => {
    for (const bad of ["{ nope", "[1]", "3"]) {
      expect(harnessTextEditable(bad)).toBe(false);
      expect(setHarnessToggle(bad, recon, true)).toBe(bad);
      expect(harnessToggleOn(bad, budget)).toBe(true);
    }
    expect(harnessTextEditable("")).toBe(true);
    expect(harnessTextEditable('{"a":1}')).toBe(true);
  });
});
