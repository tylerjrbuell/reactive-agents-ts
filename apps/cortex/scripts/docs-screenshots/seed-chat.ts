/**
 * Seeds the `chat` dataset: a Cortex with exactly two chats, one finished turn (a tool call, the answer, the
 * action row) and one empty chat for the composer shots. Kept apart from `seed.ts` so the sidebar of the other
 * chat shots does not change. Scripted `test` provider, offline tools, no keys. Runs BEFORE the server starts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

if (!process.env.DEMO_DIR) throw new Error("DEMO_DIR is required");
const demoDir = resolve(process.env.DEMO_DIR);
// Fail closed, same rule as seed.ts: the process must have been spawned with HOME=DEMO_DIR.
if (homedir() !== demoDir) throw new Error(`os.homedir() is ${homedir()}, expected ${demoDir}: spawn with HOME=$DEMO_DIR`);
process.env.HOME = demoDir;
process.env.REACTIVE_AGENTS_RUNS_DIR = join(demoDir, "runs");

const workspace = join(demoDir, "workspace");
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, "CHANGELOG.md"), "# Changelog\n\n## 0.4.0\n- Faster startup\n- Fix flaky retry\n");

const { createCortexRuntime } = await import("../../server/runtime.js");
const { ChatSessionService } = await import("../../server/services/chat-session-service.js");

const rt = createCortexRuntime({ port: 0, dbPath: join(demoDir, "cortex", "cortex.db"), openBrowser: false });
const svc = new ChatSessionService(rt.rawDb, { ingestLayer: rt.ingestLayer });
const common = { provider: "test", model: "demo-model", enableTools: true, tools: ["file-read"], workspace, maxIterations: 8 } as const;

// A finished turn: one tool call, then the answer (markdown, so the action row and rich text show).
const finished = await svc.createSession({
  name: "Summarise the changelog",
  agentConfig: {
    ...common,
    testScenario: [
      { toolCall: { name: "file-read", args: { path: "CHANGELOG.md" } } },
      {
        text: "The latest release is **0.4.0**. It has two changes:\n\n- Faster startup\n- A fix for a flaky retry\n\nNothing in it needs a migration.",
      },
    ],
  },
});
for await (const _ of svc.chatStream(finished, "What changed in the latest release? Read the changelog.")) { /* drained */ }

// An empty chat: the composer, its quick bar and the Config popover.
await svc.createSession({ name: "New chat", agentConfig: { ...common } });

// Fixed order (see seed.ts): the empty chat on top, one second apart.
{
  const now = Date.now();
  ["New chat", "Summarise the changelog"].forEach((name, i) => {
    rt.rawDb.prepare(`UPDATE cortex_chat_sessions SET last_used_at = ? WHERE name = ?`).run(now - i * 1000, name);
  });
}

console.log(JSON.stringify({ finished }, null, 2));
await svc.disposeAll();
process.exit(0);
