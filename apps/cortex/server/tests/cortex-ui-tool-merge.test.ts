import { describe, it, expect } from "bun:test";
import { mergeCortexUiToolNames, splitCortexListInput } from "../services/cortex-agent-config.js";

describe("splitCortexListInput", () => {
  it("splits commas and newlines", () => {
    expect(splitCortexListInput("a, b\nc")).toEqual(["a", "b", "c"]);
    expect(splitCortexListInput(undefined)).toEqual([]);
  });
});

describe("mergeCortexUiToolNames", () => {
  it("dedupes and splits on comma and newline", () => {
    expect(mergeCortexUiToolNames(["web-search", " web-search "], "http-get,\nfile-read")).toEqual([
      "web-search",
      "http-get",
      "file-read",
    ]);
  });

  it("handles undefined inputs", () => {
    expect(mergeCortexUiToolNames(undefined, undefined)).toEqual([]);
    expect(mergeCortexUiToolNames([], "  ")).toEqual([]);
  });
});
