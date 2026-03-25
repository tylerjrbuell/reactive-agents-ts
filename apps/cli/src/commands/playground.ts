import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync } from "node:fs";
import chalk from "chalk";
import { ReactiveAgents } from "@reactive-agents/runtime";
import type { AgentDebrief } from "@reactive-agents/runtime";
import {
  banner,
  spinner,
  inlineSpinner,
  info,
  success,
  warn,
  fail,
  kv,
  muted,
  divider,
  agentResponse,
  toolCall,
  metricsSummary,
  box,
} from "../ui.js";

// ── Constants ────────────────────────────────────────────────

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini", "litellm", "test"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

const VALID_MEMORY_TIERS = ["basic", "enhanced"] as const;
type MemoryTier = (typeof VALID_MEMORY_TIERS)[number];

const HELP_TEXT = `
  Usage: rax playground [options]

  Launch an interactive REPL backed by a persistent agent session.

  Options:
    --provider <name>   Provider: anthropic|openai|ollama|gemini|litellm|test (default: test)
    --model <model>     Model identifier
    --name <name>       Agent name (default: playground-agent)
    --tools             Enable tools
    --reasoning         Enable reasoning
    --memory            Enable conversational memory (basic by default)
    --memory-tier <t>   Memory tier: basic|enhanced (default: basic when --memory is set)
    --documents <path>  Ingest a file into RAG memory (repeatable)
    --stream            Stream token output
    --help              Show this help

  Slash Commands:
    /help               Show slash commands
    /tools              Show available tools
    /memory             Show session conversation turns
    /debrief            Show last run debrief
    /metrics            Show last run metrics dashboard
    /strategy           Show current reasoning strategy
    /provider [name]    Switch provider: anthropic|openai|ollama|gemini|litellm|test
    /model [name]       Switch model (e.g. llama3.2, gpt-4o, claude-sonnet-4-20250514)
    /documents          Show ingested documents
    /clear              Clear conversation history
    /save [path]        Save transcript to markdown file
    /exit               Quit the playground
`.trimEnd();

const SLASH_HELP = [
  `  ${chalk.bold("/help")}              Show this list`,
  `  ${chalk.bold("/tools")}             Show available tools`,
  `  ${chalk.bold("/memory")}            Show session conversation turns`,
  `  ${chalk.bold("/debrief")}           Show last run debrief`,
  `  ${chalk.bold("/metrics")}           Show last run metrics dashboard`,
  `  ${chalk.bold("/strategy")}          Show current reasoning strategy`,
  `  ${chalk.bold("/provider [name]")}   Switch provider (anthropic, openai, ollama, ...)`,
  `  ${chalk.bold("/model [name]")}      Switch model (llama3.2, gpt-4o, ...)`,
  `  ${chalk.bold("/documents")}         Show ingested documents`,
  `  ${chalk.bold("/clear")}             Clear conversation history`,
  `  ${chalk.bold("/save [path]")}       Save transcript to markdown file`,
  `  ${chalk.bold("/exit")}              Quit the playground`,
].join("\n");

// ── Types ────────────────────────────────────────────────────

interface Turn {
  user: string;
  agent: string;
  toolsUsed?: string[];
  durationMs: number;
  tokens?: number;
}

interface PlaygroundConfig {
  provider: Provider;
  model: string | undefined;
  name: string;
  enableTools: boolean;
  enableReasoning: boolean;
  enableMemory: boolean;
  memoryTier: MemoryTier;
  documents: string[];
  stream: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

function isValidProvider(value: string): value is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function isValidMemoryTier(value: string): value is MemoryTier {
  return (VALID_MEMORY_TIERS as readonly string[]).includes(value);
}

function parseArgs(args: string[]): PlaygroundConfig | null {
  const config: PlaygroundConfig = {
    provider: "test",
    model: undefined,
    name: "playground-agent",
    enableTools: false,
    enableReasoning: false,
    enableMemory: false,
    memoryTier: "basic",
    documents: [],
    stream: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return null;

    if (arg === "--provider" && args[i + 1]) {
      const raw = args[++i];
      if (!isValidProvider(raw)) {
        console.error(fail(`Unknown provider: "${raw}". Valid: ${VALID_PROVIDERS.join(", ")}`));
        process.exit(1);
      }
      config.provider = raw;
    } else if (arg === "--model" && args[i + 1]) {
      config.model = args[++i];
    } else if (arg === "--name" && args[i + 1]) {
      config.name = args[++i];
    } else if (arg === "--tools") {
      config.enableTools = true;
    } else if (arg === "--reasoning") {
      config.enableReasoning = true;
    } else if (arg === "--memory") {
      config.enableMemory = true;
    } else if (arg === "--memory-tier" && args[i + 1]) {
      const rawTier = args[++i];
      // Accept legacy numeric values and new named values
      const normalized = rawTier === "1" ? "basic" : rawTier === "2" ? "enhanced" : rawTier;
      if (!isValidMemoryTier(normalized)) {
        console.error(fail(`Invalid memory tier: "${rawTier}". Valid: basic, enhanced`));
        process.exit(1);
      }
      config.enableMemory = true;
      config.memoryTier = normalized;
    } else if (arg === "--documents" && args[i + 1]) {
      config.documents.push(args[++i]);
    } else if (arg === "--stream") {
      config.stream = true;
    }
  }

  return config;
}

async function buildAgent(config: PlaygroundConfig) {
  let builder = ReactiveAgents.create()
    .withName(config.name)
    .withProvider(config.provider);

  if (config.model) builder = builder.withModel(config.model);
  if (config.enableTools) builder = builder.withTools();
  if (config.enableReasoning) builder = builder.withReasoning();
  if (config.enableMemory) {
    builder = config.memoryTier === "enhanced"
      ? builder.withMemory({ tier: "enhanced" })
      : builder.withMemory();
  }
  if (config.documents.length > 0) {
    builder = builder.withDocuments(config.documents.map((source) => ({ source })));
  }

  return builder.build();
}

function showConfig(config: PlaygroundConfig): void {
  console.log(kv("Provider", config.provider));
  if (config.model) console.log(kv("Model", config.model));
  console.log(kv("Tools", config.enableTools ? "enabled" : "disabled"));
  console.log(kv("Reasoning", config.enableReasoning ? "enabled" : "disabled"));
  console.log(kv("Memory", config.enableMemory ? `enabled (${config.memoryTier})` : "disabled"));
  if (config.documents.length > 0) console.log(kv("Documents", config.documents.join(", ")));
  console.log(kv("Streaming", config.stream ? "enabled" : "disabled"));
  console.log();
}

function formatTranscript(turns: Turn[]): string {
  const lines: string[] = [
    `# Playground Transcript`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Turns:** ${turns.length}`,
    ``,
    `---`,
    ``,
  ];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    lines.push(`### Turn ${i + 1}`);
    lines.push(``);
    lines.push(`**User:** ${t.user}`);
    lines.push(``);
    lines.push(`**Agent:** ${t.agent}`);
    if (t.toolsUsed && t.toolsUsed.length > 0) {
      lines.push(`**Tools:** ${t.toolsUsed.join(", ")}`);
    }
    lines.push(`**Duration:** ${t.durationMs}ms`);
    lines.push(``);
  }

  return lines.join("\n");
}

function showDebrief(debrief: AgentDebrief | undefined): void {
  if (!debrief) {
    console.log(warn("No debrief available. Run a message first."));
    return;
  }

  const content = [
    `${chalk.bold("Outcome:")} ${debrief.outcome}  ${chalk.bold("Confidence:")} ${debrief.confidence}`,
    ``,
    `${chalk.bold("Summary:")} ${debrief.summary}`,
  ];

  if (debrief.keyFindings.length > 0) {
    content.push(``);
    content.push(chalk.bold("Key Findings:"));
    for (const f of debrief.keyFindings) content.push(`  - ${f}`);
  }

  if (debrief.errorsEncountered.length > 0) {
    content.push(``);
    content.push(chalk.bold("Errors:"));
    for (const e of debrief.errorsEncountered) content.push(`  - ${e}`);
  }

  if (debrief.lessonsLearned.length > 0) {
    content.push(``);
    content.push(chalk.bold("Lessons:"));
    for (const l of debrief.lessonsLearned) content.push(`  - ${l}`);
  }

  if (debrief.toolsUsed.length > 0) {
    content.push(``);
    content.push(chalk.bold("Tools:"));
    for (const t of debrief.toolsUsed) {
      content.push(`  - ${t.name}: ${t.calls}x, ${t.successRate}% success`);
    }
  }

  if (debrief.metrics) {
    content.push(``);
    content.push(
      `${chalk.bold("Metrics:")} ${debrief.metrics.iterations} iters, ${debrief.metrics.tokens} tokens, ${(debrief.metrics.duration / 1000).toFixed(1)}s`,
    );
  }

  if (debrief.caveats && debrief.caveats.length > 0) {
    content.push(``);
    content.push(chalk.bold("Caveats:"));
    for (const c of debrief.caveats) content.push(`  - ${c}`);
  }

  box(content.join("\n"), { title: chalk.bold(" Debrief "), borderColor: "#8b5cf6" });
}

// ── Main ─────────────────────────────────────────────────────

export async function runPlayground(args: string[]): Promise<void> {
  const config = parseArgs(args);
  if (!config) {
    console.log(HELP_TEXT);
    return;
  }

  // Show banner + config
  banner("rax playground", "Interactive agent REPL with session memory");
  showConfig(config);

  // Build agent
  const buildSpin = spinner("Building agent...");
  let agent: Awaited<ReturnType<typeof buildAgent>>;
  try {
    agent = await buildAgent(config);
    buildSpin.succeed(`Agent ready: ${agent.agentId}`);
  } catch (err) {
    buildSpin.fail(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Create session
  let session = agent.session();
  const turns: Turn[] = [];

  console.log(muted("Type a message to chat, or /help for commands."));
  console.log();

  const rl = createInterface({ input, output });

  // Graceful Ctrl+C
  const onSigint = () => {
    console.log(muted("\nGoodbye!"));
    rl.close();
  };
  process.on("SIGINT", onSigint);

  try {
    while (true) {
      let line: string;
      try {
        line = (await rl.question(chalk.hex("#8b5cf6")("you> "))).trim();
      } catch {
        // Ctrl+D or readline close
        break;
      }

      if (!line) continue;

      // ── Slash commands ──────────────────────────────────
      if (line.startsWith("/")) {
        const [cmd, ...rest] = line.split(/\s+/);
        const arg0 = rest.join(" ").trim();

        switch (cmd) {
          case "/exit":
          case "/quit": {
            console.log(muted("Goodbye!"));
            rl.close();
            return;
          }

          case "/help": {
            console.log();
            console.log(chalk.bold("Slash Commands:"));
            console.log(SLASH_HELP);
            console.log();
            continue;
          }

          case "/tools": {
            console.log(
              info(
                config.enableTools
                  ? "Tools are enabled. Available tools depend on the agent's tool registry."
                  : "Tools are disabled. Use --tools flag to enable.",
              ),
            );
            console.log();
            continue;
          }

          case "/documents": {
            if (config.documents.length === 0) {
              console.log(info("No documents ingested. Use --documents <path> at startup."));
            } else {
              console.log(chalk.bold(`Ingested Documents (${config.documents.length}):`));
              for (const doc of config.documents) console.log(`  ${muted("•")} ${doc}`);
            }
            console.log();
            continue;
          }

          case "/memory": {
            if (turns.length === 0) {
              console.log(info("No conversation turns yet."));
              console.log();
              continue;
            }
            console.log(chalk.bold(`Session History (${turns.length} turn${turns.length === 1 ? "" : "s"}):`));
            const recent = turns.slice(-8);
            for (let i = 0; i < recent.length; i++) {
              const t = recent[i];
              const idx = turns.length - recent.length + i + 1;
              const userPreview = t.user.replace(/\s+/g, " ").slice(0, 80);
              const agentPreview = t.agent.replace(/\s+/g, " ").slice(0, 80);
              console.log(
                `  ${muted(`${idx}.`)} ${chalk.bold("user:")} ${userPreview}${t.user.length > 80 ? "..." : ""}`,
              );
              console.log(
                `     ${chalk.bold("agent:")} ${agentPreview}${t.agent.length > 80 ? "..." : ""}`,
              );
              if (t.toolsUsed && t.toolsUsed.length > 0) {
                console.log(`     ${muted(`tools: ${t.toolsUsed.join(", ")}`)}`);
              }
              console.log(`     ${muted(`${t.durationMs}ms`)}`);
            }
            console.log();
            continue;
          }

          case "/debrief": {
            showDebrief((agent as any)._lastDebrief as AgentDebrief | undefined);
            console.log();
            continue;
          }

          case "/metrics": {
            console.log(warn("No metrics dashboard available for chat-mode interactions."));
            console.log();
            continue;
          }

          case "/strategy": {
            console.log(
              info(
                config.enableReasoning
                  ? "Reasoning enabled (strategy selected adaptively per query)."
                  : "Reasoning disabled. Direct LLM chat mode.",
              ),
            );
            console.log();
            continue;
          }

          case "/provider": {
            if (!arg0) {
              console.log(info(`Current provider: ${config.provider}`));
              console.log(muted(`  Available: ${VALID_PROVIDERS.join(", ")}`));
              console.log();
              continue;
            }
            if (!isValidProvider(arg0)) {
              console.log(fail(`Unknown provider: "${arg0}". Valid: ${VALID_PROVIDERS.join(", ")}`));
              console.log();
              continue;
            }
            config.provider = arg0;
            {
              const spin = inlineSpinner(`Switching to provider: ${arg0}...`);
              try {
                await agent.dispose().catch(() => {});
                agent = await buildAgent(config);
                session = agent.session();
                spin.succeed(`Switched to ${arg0}. Agent: ${agent.agentId}`);
                console.log(muted("  Session history preserved, agent rebuilt."));
              } catch (err) {
                spin.fail(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            console.log();
            continue;
          }

          case "/model": {
            if (!arg0) {
              console.log(info(`Current model: ${config.model ?? "(default)"}`));
              console.log(info(`Current provider: ${config.provider}`));
              console.log();
              continue;
            }
            // If the user typed a provider name, switch provider instead
            if (isValidProvider(arg0)) {
              console.log(warn(`"${arg0}" is a provider, not a model. Switching provider instead.`));
              console.log(muted(`  Use /model <model-name> for a specific model (e.g. llama3.2, gpt-4o).`));
              config.provider = arg0 as Provider;
              config.model = undefined;
            } else {
              config.model = arg0;
            }
            {
              const label = config.model ? `model: ${config.model}` : `provider: ${config.provider}`;
              const spin = inlineSpinner(`Switching to ${label}...`);
              try {
                await agent.dispose().catch(() => {});
                agent = await buildAgent(config);
                session = agent.session();
                spin.succeed(`Switched to ${config.model ?? config.provider}. Agent: ${agent.agentId}`);
                console.log(muted("  Session history preserved, agent rebuilt."));
              } catch (err) {
                spin.fail(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            console.log();
            continue;
          }

          case "/clear": {
            turns.length = 0;
            try { await session.end(); } catch { /* best effort */ }
            session = agent.session();
            console.log(success("Conversation history cleared."));
            console.log();
            continue;
          }

          case "/save": {
            const path = arg0 || `playground-${Date.now()}.md`;
            try {
              writeFileSync(path, formatTranscript(turns), "utf-8");
              console.log(success(`Transcript saved to ${path}`));
            } catch (err) {
              console.log(fail(`Save failed: ${err instanceof Error ? err.message : String(err)}`));
            }
            console.log();
            continue;
          }

          default: {
            console.log(warn(`Unknown command: ${cmd}. Type /help for available commands.`));
            console.log();
            continue;
          }
        }
      }

      // ── Chat message ───────────────────────────────────
      const startMs = Date.now();

      if (config.stream) {
        // Streaming mode — use agent.runStream()
        process.stdout.write(chalk.hex("#06b6d4")("agent> "));

        let outputText = "";
        let streamError: string | null = null;
        const toolsUsed: string[] = [];

        try {
          for await (const event of agent.runStream(line, { density: "full" })) {
            switch (event._tag) {
              case "TextDelta":
                process.stdout.write(event.text);
                outputText += event.text;
                break;
              case "ThoughtEmitted":
                process.stdout.write(`\n`);
                console.log(muted(`  thought> ${event.content.replace(/\s+/g, " ").trim()}`));
                process.stdout.write(chalk.hex("#06b6d4")("agent> "));
                break;
              case "ToolCallStarted":
                process.stdout.write(`\n`);
                toolCall(event.toolName, "start");
                process.stdout.write(chalk.hex("#06b6d4")("agent> "));
                toolsUsed.push(event.toolName);
                break;
              case "ToolCallCompleted":
                process.stdout.write(`\n`);
                toolCall(event.toolName, event.success ? "done" : "error", event.durationMs);
                process.stdout.write(chalk.hex("#06b6d4")("agent> "));
                break;
              case "StreamCompleted":
                if (!outputText) outputText = event.output;
                break;
              case "StreamError":
                streamError = event.cause;
                break;
            }
          }
        } catch (err) {
          streamError = err instanceof Error ? err.message : String(err);
        }

        process.stdout.write("\n");

        const durationMs = Date.now() - startMs;

        if (streamError) {
          console.log(fail(`Error: ${streamError}`));
        } else {
          metricsSummary({
            duration: durationMs,
            steps: 0,
            tokens: 0,
            tools: toolsUsed.length,
            success: true,
          });
        }

        turns.push({
          user: line,
          agent: outputText,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
          durationMs,
        });
      } else {
        // Non-streaming — use session.chat() for stateful conversation
        const chatSpin = inlineSpinner("Thinking...");

        try {
          const chatOpts = config.enableTools ? { useTools: true } : undefined;
          const reply = await session.chat(line, chatOpts);
          const durationMs = Date.now() - startMs;
          chatSpin.stop();

          // Display response
          agentResponse(reply.message);

          // One-liner summary
          metricsSummary({
            duration: durationMs,
            steps: reply.steps ?? 0,
            tokens: reply.tokens ?? 0,
            tools: reply.toolsUsed?.length ?? 0,
            success: true,
          });

          turns.push({
            user: line,
            agent: reply.message,
            toolsUsed: reply.toolsUsed,
            durationMs,
          });
        } catch (err) {
          const durationMs = Date.now() - startMs;
          chatSpin.fail("Failed");

          const msg = err instanceof Error ? err.message : String(err);
          console.log(fail(`Error: ${msg}`));

          turns.push({
            user: line,
            agent: `[error] ${msg}`,
            durationMs,
          });
        }
      }

      console.log();
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
    try { await session.end(); } catch { /* best effort */ }
    try { await agent.dispose(); } catch { /* best effort */ }
    console.log(muted("Session ended."));
  }
}
