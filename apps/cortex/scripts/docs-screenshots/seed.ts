/**
 * Seeds the demo Cortex db (same file the demo server reads) with the states the docs
 * screenshots show. Everything is scripted: the `test` provider, offline tools, no keys.
 * Chat states only; runs BEFORE the server starts (the server restores pending approvals from the
 * durable store on boot). MCP servers and channels are seeded after it by `seed-http.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

if (!process.env.DEMO_DIR) throw new Error("DEMO_DIR is required");
const demoDir = resolve(process.env.DEMO_DIR);
// Fail closed, same rule as demo-server.ts: the process must have been spawned with HOME=DEMO_DIR.
if (homedir() !== demoDir) throw new Error(`os.homedir() is ${homedir()}, expected ${demoDir}: spawn with HOME=$DEMO_DIR`);
process.env.HOME = demoDir;
process.env.REACTIVE_AGENTS_RUNS_DIR = join(demoDir, "runs");

const workspace = join(demoDir, "workspace");
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, "CHANGELOG.md"), "# Changelog\n\n## 0.4.0\n- Faster startup\n- Fix flaky retry\n");
writeFileSync(join(workspace, "STYLE.md"), "# Style notes\n\nPlain words. Short sentences.\n");
writeFileSync(join(workspace, "README.md"), "# Acme API\n\nA small HTTP service.\n");

const { createCortexRuntime } = await import("../../server/runtime.js");
const { ChatSessionService } = await import("../../server/services/chat-session-service.js");
const { interruptChatTurn } = await import("../../server/services/chat-run-control.js");

const rt = createCortexRuntime({ port: 0, dbPath: join(demoDir, "cortex", "cortex.db"), openBrowser: false });
const svc = new ChatSessionService(rt.rawDb, { ingestLayer: rt.ingestLayer });

const common = { provider: "test", model: "demo-model", enableTools: true, tools: ["file-read"], workspace, maxIterations: 8 } as const;
const out: Record<string, string> = {};

// 1. Plan mode: a plan the person can edit, then Execute (the driver clicks it).
{
  const id = await svc.createSession({
    name: "Prepare the 0.5.0 release notes",
    agentConfig: {
      ...common,
      testScenario: [
        { toolCall: { name: "file-read", args: { path: join(workspace, "CHANGELOG.md") } } },
        { toolCall: { name: "file-read", args: { path: join(workspace, "README.md") } } },
        { toolCall: { name: "file-read", args: { path: join(workspace, "STYLE.md") } } },
        { text: "Read the changelog, the README and the style notes. The 0.4.0 entry lists two changes; the release notes draft is ready for review." },
      ],
    },
    seedTurns: [
      { role: "user", content: "Prepare release notes for 0.5.0 from the changelog." },
      { role: "assistant", content: "I will plan it first. Edit the steps if you want a different order, then Execute." },
    ],
  });
  await svc.setMode(id, "plan");
  await svc.plans.write(
    id,
    [
      { id: "changelog", title: "Read the changelog", tool: "file-read", args: { path: "CHANGELOG.md" } },
      { id: "readme", title: "Read the README for naming and tone", tool: "file-read", args: { path: "README.md" } },
      { id: "style", title: "Read the style notes", tool: "file-read", args: { path: "STYLE.md" }, dependsOn: ["changelog", "readme"] },
    ],
    "Prepare the 0.5.0 release notes",
  );
  out["plan"] = id;
}

// 2. A durable run the person stopped: Continue picks it up where it left off.
{
  const id = await svc.createSession({
    name: "Audit the docs folder",
    agentConfig: {
      ...common,
      // Explicit dir: `durableRunsDbPath` (server/services/crashed-runs.ts) passes `homedir()` to the framework
      // resolver, which then ignores REACTIVE_AGENTS_RUNS_DIR on the read path. An explicit dir is honoured everywhere.
      durableRuns: { enabled: true, dir: join(demoDir, "durable") },
      testScenario: [
        { toolCall: { name: "file-read", args: { path: join(workspace, "README.md") } } },
        { toolCall: { name: "file-read", args: { path: join(workspace, "CHANGELOG.md") } }, delayMs: 1500 },
        { text: "Audit finished." },
      ],
    },
  });
  const stream = svc.chatStream(id, "Audit the docs folder and summarise what is out of date.");
  const tags: string[] = [];
  let sawTool: () => void = () => {};
  const toolDone = new Promise<void>((r) => { sawTool = r; });
  const drain = (async () => { for await (const ev of stream) { tags.push(ev._tag); if (/ToolCallCompleted/.test(ev._tag)) sawTool(); } })();
  await Promise.race([toolDone, new Promise((r) => setTimeout(r, 8000))]);
  out["tags"] = [...new Set(tags)].join(",");
  const answer = await interruptChatTurn(svc, id, "stop");
  await drain;
  out["stopped"] = id;
  out["stopAnswer"] = JSON.stringify(answer);
  out["resumable"] = JSON.stringify(await svc.resume.list(id));
}

// 3. A run that spent its step budget: the cause card says why and what to try; Continue is offered.
{
  const id = await svc.createSession({
    name: "Summarise every open issue",
    agentConfig: {
      ...common,
      maxIterations: 3,
      durableRuns: { enabled: true, dir: join(demoDir, "durable") },
      testScenario: [
        { toolCall: { name: "file-read", args: { path: "README.md" } } },
        { toolCall: { name: "file-read", args: { path: "CHANGELOG.md" } } },
        { toolCall: { name: "file-read", args: { path: "STYLE.md" } } },
        { toolCall: { name: "file-read", args: { path: "README.md" } } },
        { text: "Summary done." },
      ],
    },
  });
  for await (const _ of svc.chatStream(id, "Summarise every open issue in the workspace.")) { /* drained */ }
  out["budget"] = id;
  out["budgetResumable"] = JSON.stringify(await svc.resume.list(id));
}

// 4. A durable turn paused on an approval: the card shows the tool and its full parameters.
{
  const id = await svc.createSession({
    name: "Publish the release notes",
    agentConfig: {
      ...common,
      tools: ["file-read", "file-write"],
      durableRuns: { enabled: true, dir: join(demoDir, "durable-approvals"), approvalTools: ["file-write"] },
      testScenario: [
        {
          toolCall: {
            name: "file-write",
            args: { path: "RELEASE_NOTES.md", content: "# 0.5.0\n\n- Faster startup\n- Fixed a flaky retry\n" },
          },
        },
        { text: "Published the release notes." },
      ],
    },
  });
  for await (const _ of svc.chatStream(id, "Publish the 0.5.0 release notes to RELEASE_NOTES.md.")) { /* drained at the pause */ }
  out["approval"] = id;
}

console.log(JSON.stringify(out, null, 2));
await svc.disposeAll();
process.exit(0);
