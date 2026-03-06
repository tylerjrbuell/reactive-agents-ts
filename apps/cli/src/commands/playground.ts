import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ReactiveAgents } from "@reactive-agents/runtime";

const HELP = `
  Usage: rax playground [options]

  Launch an interactive prompt loop backed by a single agent session.

  Options:
    --provider <name>   Provider: anthropic|openai|ollama|gemini|litellm|test (default: test)
    --model <model>     Model identifier
    --name <name>       Agent name (default: playground-agent)
    --tools             Enable tools
    --reasoning         Enable reasoning
    --memory            Enable conversational memory (defaults to tier 1)
    --memory-tier <n>   Memory tier: 1|2 (default: 1 when --memory is set)
    --stream            Stream token output
    --help              Show this help

  Commands:
    /exit               Quit the playground
    /help               Show command help
    /memory             Show memory status and recent turns
    /memory clear       Clear in-session conversation history
    /memory on          Enable session memory context injection
    /memory off         Disable session memory context injection
`.trimEnd();

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini", "litellm", "test"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];
const VALID_MEMORY_TIERS = ["1", "2"] as const;
type MemoryTier = (typeof VALID_MEMORY_TIERS)[number];

function isValidProvider(value: string): value is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function isValidMemoryTier(value: string): value is MemoryTier {
  return (VALID_MEMORY_TIERS as readonly string[]).includes(value);
}

function buildPromptWithHistory(
  line: string,
  history: ReadonlyArray<{ user: string; agent: string }>,
): string {
  if (history.length === 0) return line;

  const recent = history.slice(-8);
  const transcript = recent
    .map((turn, index) => `Turn ${index + 1}\nUser: ${turn.user}\nAssistant: ${turn.agent}`)
    .join("\n\n");

  return [
    "Conversation context from this playground session:",
    transcript,
    "",
    "Instruction: If the user asks about previously shared personal preferences/details from this same session (for example name), answer using the session context above.",
    "Current user message:",
    line,
  ].join("\n");
}

export async function runPlayground(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  let provider: Provider = "test";
  let model: string | undefined;
  let name = "playground-agent";
  let enableTools = false;
  let enableReasoning = false;
  let enableMemory = false;
  let memoryTier: MemoryTier = "1";
  let stream = false;

  const formatThought = (content: string): string => content.replace(/\s+/g, " ").trim();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      const raw = args[++i];
      if (!isValidProvider(raw)) {
        console.error(`Unknown provider: \"${raw}\". Valid providers: ${VALID_PROVIDERS.join(", ")}`);
        process.exit(1);
      }
      provider = raw;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (arg === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (arg === "--tools") {
      enableTools = true;
    } else if (arg === "--reasoning") {
      enableReasoning = true;
    } else if (arg === "--memory") {
      enableMemory = true;
    } else if (arg === "--memory-tier" && args[i + 1]) {
      const rawTier = args[++i];
      if (!isValidMemoryTier(rawTier)) {
        console.error(`Invalid memory tier: \"${rawTier}\". Valid tiers: ${VALID_MEMORY_TIERS.join(", ")}`);
        process.exit(1);
      }
      enableMemory = true;
      memoryTier = rawTier;
    } else if (arg === "--stream") {
      stream = true;
    }
  }

  let builder = ReactiveAgents.create().withName(name).withProvider(provider);
  if (model) builder = builder.withModel(model);
  if (enableTools) builder = builder.withTools();
  if (enableReasoning) builder = builder.withReasoning();
  if (enableMemory) builder = builder.withMemory(memoryTier);

  const agent = await builder.build();

  console.log(`Playground ready. Agent: ${agent.agentId}`);
  console.log("Type /help for commands, /exit to quit.\n");

  const conversationHistory: Array<{ user: string; agent: string }> = [];

  const rl = createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        console.log("Commands: /help, /exit, /memory, /memory clear, /memory on, /memory off\n");
        continue;
      }
      if (line === "/memory") {
        const status = enableMemory ? `enabled (tier ${memoryTier})` : "disabled";
        console.log(`memory> ${status}`);
        if (conversationHistory.length === 0) {
          console.log("memory> no conversation history saved\n");
          continue;
        }

        const recent = conversationHistory.slice(-5);
        console.log(`memory> showing ${recent.length} most recent turn(s):`);
        for (let i = 0; i < recent.length; i++) {
          const turn = recent[i];
          const userPreview = turn.user.replace(/\s+/g, " ").slice(0, 80);
          const agentPreview = turn.agent.replace(/\s+/g, " ").slice(0, 80);
          console.log(`  ${i + 1}. user: ${userPreview}${turn.user.length > 80 ? "..." : ""}`);
          console.log(`     agent: ${agentPreview}${turn.agent.length > 80 ? "..." : ""}`);
        }
        console.log("");
        continue;
      }
      if (line === "/memory clear") {
        conversationHistory.length = 0;
        console.log("memory> cleared session history\n");
        continue;
      }
      if (line === "/memory on") {
        enableMemory = true;
        console.log(`memory> enabled (tier ${memoryTier})\n`);
        continue;
      }
      if (line === "/memory off") {
        enableMemory = false;
        console.log("memory> disabled\n");
        continue;
      }

      const prompt = enableMemory
        ? buildPromptWithHistory(line, conversationHistory)
        : line;

      if (stream) {
        process.stdout.write("agent> ");

        let printedToolEvent = false;
        for await (const event of agent.runStream(prompt, { density: "full" })) {
          switch (event._tag) {
            case "TextDelta":
              process.stdout.write(event.text);
              break;
            case "ThoughtEmitted":
              process.stdout.write(`\nthought> ${formatThought(event.content)}\n`);
              if (printedToolEvent) {
                process.stdout.write("agent> ");
                printedToolEvent = false;
              }
              break;
            case "ToolCallStarted":
              process.stdout.write(`\naction> ${event.toolName} (call ${event.callId})\n`);
              process.stdout.write("agent> ");
              printedToolEvent = true;
              break;
            case "ToolCallCompleted":
              process.stdout.write(`\nresult> ${event.toolName} ${event.success ? "ok" : "error"} (${event.durationMs}ms)\n`);
              process.stdout.write("agent> ");
              printedToolEvent = true;
              break;
            case "StreamError":
              process.stdout.write(`\n[stream error] ${event.cause}\n`);
              break;
            case "StreamCompleted":
              conversationHistory.push({ user: line, agent: event.output });
              break;
            default:
              break;
          }
        }
        process.stdout.write("\n\n");
      } else {
        let outputText = "";
        let streamError: string | null = null;

        for await (const event of agent.runStream(prompt, { density: "full" })) {
          switch (event._tag) {
            case "TextDelta":
              outputText += event.text;
              break;
            case "ThoughtEmitted":
              console.log(`thought> ${formatThought(event.content)}`);
              break;
            case "ToolCallStarted":
              console.log(`action> ${event.toolName} (call ${event.callId})`);
              break;
            case "ToolCallCompleted":
              console.log(`result> ${event.toolName} ${event.success ? "ok" : "error"} (${event.durationMs}ms)`);
              break;
            case "StreamCompleted":
              if (outputText.length === 0) {
                outputText = event.output;
              }
              conversationHistory.push({ user: line, agent: event.output });
              break;
            case "StreamError":
              streamError = event.cause;
              break;
            default:
              break;
          }
        }

        if (streamError) {
          console.error(`agent> [failed] ${streamError}\n`);
          continue;
        }

        console.log(`agent> ${outputText}\n`);
      }
    }
  } finally {
    rl.close();
    await agent.dispose();
  }
}
