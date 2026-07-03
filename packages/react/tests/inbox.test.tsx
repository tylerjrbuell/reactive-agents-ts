import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render, waitFor, fireEvent } from "@testing-library/react";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useTaskInbox, type InboxRun } from "../src/hooks/use-task-inbox.js";
import { TaskInbox } from "../src/components/TaskInbox.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

const RUNS: InboxRun[] = [
  { runId: "r1", task: "research part", status: "awaiting-interaction", updatedAt: 2 },
  { runId: "r2", task: "summarize", status: "completed", updatedAt: 1 },
];

describe("Inbox", () => {
  test("useTaskInbox fetches runs on mount", async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify(RUNS), { status: 200 });
    const { result } = renderHook(() => useTaskInbox({ endpoint: "/api/inbox", fetchImpl }));
    await waitFor(() => expect(result.current.runs.length).toBe(2));
    expect(result.current.runs[0]!.runId).toBe("r1");
  });

  test("TaskInbox renders rows and fires onSelect", () => {
    let picked = "";
    const { getByText } = render(<TaskInbox runs={RUNS} onSelect={(id) => (picked = id)} />);
    fireEvent.click(getByText(/research part/));
    expect(picked).toBe("r1");
  });
});
