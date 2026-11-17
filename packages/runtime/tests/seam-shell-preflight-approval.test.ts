// Run: bun test packages/runtime/tests/seam-shell-preflight-approval.test.ts --timeout 30000
//
// Seam pin: the REAL `shell-execute` (terminal: true, default allowlist) driven
// through the runtime builder with an approval policy. A call the allowlist
// would refuse at execution time (`gh` is not on the default list) is refused
// UP FRONT by the tool's `preflight`: no approval pause, no decider call, and
// the model's next turn sees the allowlist refusal. An allowed command still
// asks for approval. Fixes the Cortex repeated-approval loop (approved
// `which gh; gh --version` was then refused by the allowlist, the model retried,
// a new approval card each time).
//
// Cells:
//   (a) detach + `which gh; gh --version`: not awaiting-approval, no pending
//       approval, observation carries the allowlist refusal.
//   (b) detach + `echo hi`: pauses (awaiting-approval) with the shell pending.
//   (c) block + decider spy: not called for the refused call, called for echo.
//   (d) compound `ls && gh --version`: refused up front (no pause).
//
// RED-ON-CUT: making `preflightToolCall` (tools) return undefined, or removing
// its call from the kernel approval gate (reasoning approval-gate.ts), makes
// (a), (c) and (d) fail (the refused call pauses / reaches the decider).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { ApprovalPolicyConfig } from "../src/builder/types.js";

const dir = mkdtempSync(join(tmpdir(), "ra-shell-preflight-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const REFUSAL = 'Command "gh" is not in the allowed commands list';

type Seen = { readonly toolName: string; readonly success?: boolean; readonly result?: unknown; readonly error?: unknown };

async function runShell(
  command: string,
  policy: ApprovalPolicyConfig,
  durable: boolean,
) {
  const seen: Seen[] = [];
  let b = ReactiveAgents.create()
    .withName("shell-preflight")
    .withProvider("test")
    .withTestScenario([
      { toolCall: { name: "shell-execute", args: { command } } },
      { text: "FINAL ANSWER: done." },
    ] as never)
    .withTools({ terminal: true })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .withApprovalPolicy(policy);
  if (durable) b = b.withDurableRuns({ dir, checkpointEvery: 1 });
  const agent = await b.build();
  try {
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "shell-execute") seen.push(e as Seen);
    });
    const result = await agent.run("run the shell command");
    // Raw (un-JSON'd) text so the quoted command name in the refusal matches.
    const text = [...seen.map((s) => String(s.error ?? s.result ?? "")), String(result.output ?? "")].join("\n");
    return { result, seen, text };
  } finally {
    await agent.dispose();
  }
}

describe("shell-execute preflight vs approval gate (real allowlist)", () => {
  it("(a) detach: a refused gh call does not pause and surfaces the allowlist refusal", async () => {
    const { result, text } = await runShell(
      "which gh; gh --version",
      { tools: ["shell-execute"], mode: "detach" },
      true,
    );
    expect(result.status).not.toBe("awaiting-approval");
    expect(result.pendingApproval).toBeUndefined();
    expect(text).toContain(REFUSAL);
  }, 30_000);

  it("(b) detach: an allowed command still pauses for approval", async () => {
    const { result } = await runShell("echo hi", { tools: ["shell-execute"], mode: "detach" }, true);
    expect(result.status).toBe("awaiting-approval");
    expect(result.pendingApproval?.toolName).toBe("shell-execute");
  }, 30_000);

  it("(c) block: decider not called for the refused call, called for the allowed one", async () => {
    let refusedAsked = 0;
    const refused = await runShell(
      "which gh; gh --version",
      { tools: ["shell-execute"], mode: "block", onApprove: () => ((refusedAsked += 1), true) },
      false,
    );
    expect(refusedAsked).toBe(0);
    expect(refused.text).toContain(REFUSAL);

    let allowedAsked = 0;
    await runShell(
      "echo hi",
      { tools: ["shell-execute"], mode: "block", onApprove: () => ((allowedAsked += 1), true) },
      false,
    );
    expect(allowedAsked).toBeGreaterThan(0);
  }, 30_000);

  it("(d) detach: compound `ls && gh --version` is refused up front", async () => {
    const { result, text } = await runShell(
      "ls && gh --version",
      { tools: ["shell-execute"], mode: "detach" },
      true,
    );
    expect(result.status).not.toBe("awaiting-approval");
    expect(result.pendingApproval).toBeUndefined();
    expect(text).toContain(REFUSAL);
  }, 30_000);
});
