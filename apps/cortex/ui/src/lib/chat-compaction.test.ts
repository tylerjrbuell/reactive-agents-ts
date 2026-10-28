import { expect, test } from "bun:test";
import { COMPACTED_USER_MARKER, compactionRows } from "./chat-compaction.js";

test("marker row and the summary after it are identified", () => {
  const { markers, summaries } = compactionRows([
    { role: "user", content: COMPACTED_USER_MARKER },
    { role: "assistant", content: "summary" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ]);
  expect([...markers]).toEqual([0]);
  expect([...summaries]).toEqual([1]);
});
