/**
 * Tests for parseToolRequestGroup — multi-tool execution (parallel & chain)
 */
import { describe, it, expect } from "bun:test";
import { parseToolRequestGroup } from "../../src/strategies/shared/tool-utils.js";

describe("parseToolRequestGroup", () => {
  it("single ACTION → single mode", () => {
    const thought = `I need to read a file.
ACTION: file-read({"path": "./data.txt"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("single");
    expect(group.requests).toHaveLength(1);
    expect(group.requests[0]!.tool).toBe("file-read");
  });

  it("multiple ACTION lines → parallel mode", () => {
    const thought = `I can fetch both files at once.
ACTION: file-read({"path": "./a.txt"})
ACTION: file-read({"path": "./b.txt"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("parallel");
    expect(group.requests).toHaveLength(2);
    expect(group.requests[0]!.tool).toBe("file-read");
    expect(group.requests[1]!.tool).toBe("file-read");
  });

  it("ACTION + THEN → chain mode (chain takes precedence over parallel)", () => {
    const thought = `Search first, then write the result.
ACTION: web-search({"query": "reactive agents"})
THEN: file-write({"path": "./result.txt", "content": "$RESULT"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("chain");
    expect(group.requests).toHaveLength(2);
    expect(group.requests[0]!.tool).toBe("web-search");
    expect(group.requests[1]!.tool).toBe("file-write");
  });

  it("caps parallel at 3", () => {
    const thought = `Read four files concurrently.
ACTION: file-read({"path": "./a.txt"})
ACTION: file-read({"path": "./b.txt"})
ACTION: file-read({"path": "./c.txt"})
ACTION: file-read({"path": "./d.txt"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("parallel");
    expect(group.requests).toHaveLength(3);
  });

  it("side-effect tools (send_) force single mode", () => {
    const thought = `Send two messages.
ACTION: send_message({"to": "alice", "text": "hello"})
ACTION: send_message({"to": "bob", "text": "hi"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("single");
    expect(group.requests).toHaveLength(1);
    expect(group.requests[0]!.tool).toBe("send_message");
  });

  it("side-effect tools (create_) force single mode", () => {
    const thought = `Create two resources.
ACTION: create_issue({"title": "Bug A"})
ACTION: create_issue({"title": "Bug B"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("single");
    expect(group.requests).toHaveLength(1);
  });

  it("THEN: with $RESULT in input — chain mode preserves $RESULT placeholder", () => {
    const thought = `Run search and pipe result to file.
ACTION: web-search({"query": "Effect TS"})
THEN: file-write({"path": "./output.txt", "content": "$RESULT"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("chain");
    expect(group.requests[1]!.input).toContain("$RESULT");
  });

  it("no ACTION in thought → single mode with empty requests", () => {
    const thought = "I need to think about this more carefully.";
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("single");
    expect(group.requests).toHaveLength(0);
  });

  it("caps chain at 3", () => {
    const thought = `Chain four steps.
ACTION: web-search({"query": "step 1"})
THEN: file-write({"path": "./1.txt", "content": "$RESULT"})
THEN: file-read({"path": "./1.txt"})
THEN: code-execute({"code": "console.log('done')"})`;
    const group = parseToolRequestGroup(thought);
    expect(group.mode).toBe("chain");
    expect(group.requests).toHaveLength(3);
  });
});
