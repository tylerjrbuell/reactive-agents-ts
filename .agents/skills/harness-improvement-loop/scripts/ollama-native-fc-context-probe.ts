import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { Ollama } from "ollama";
import {
  LLMService,
  createLLMProviderLayer,
  type LLMMessage,
  type ToolDefinition,
} from "@reactive-agents/llm-provider";
import { createToolCallResolver } from "@reactive-agents/tools";

type Scenario = {
  readonly id: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly messages: readonly LLMMessage[];
};

type ToolCallSummary = {
  readonly name: string;
  readonly argKeys: readonly string[];
  readonly args: Record<string, unknown>;
};

type PathResult = {
  readonly stopReason?: string;
  readonly contentPreview: string;
  readonly toolCalls: readonly ToolCallSummary[];
  readonly error?: string;
};

type ResolverResultSummary = {
  readonly tag: "tool_calls" | "final_answer" | "thinking";
  readonly contentPreview?: string;
  readonly toolCalls: readonly ToolCallSummary[];
};

type ScenarioDiagnostics = {
  readonly countsAligned: boolean;
  readonly namesAligned: boolean;
  readonly argKeysAligned: boolean;
  readonly notes: readonly string[];
};

type ScenarioReport = {
  readonly run: number;
  readonly id: string;
  readonly description: string;
  readonly sdk: PathResult;
  readonly framework: PathResult;
  readonly resolver?: ResolverResultSummary;
  readonly diagnostics: ScenarioDiagnostics;
  readonly frameworkNoThinking?: PathResult;
  readonly resolverNoThinking?: ResolverResultSummary;
  readonly diagnosticsNoThinking?: ScenarioDiagnostics;
};

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const PROBE_MODEL = process.env.PROBE_MODEL ?? "gemma4:e4b";
const PROBE_TEMPERATURE = Number(process.env.PROBE_TEMPERATURE ?? "0");
const PROBE_MAX_TOKENS = Number(process.env.PROBE_MAX_TOKENS ?? "1024");
const PROBE_REPEATS = Math.max(1, Number(process.env.PROBE_REPEATS ?? "1"));
const PROBE_SCENARIOS = (process.env.PROBE_SCENARIOS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

const TASK =
  "Fetch the current USD price for: XRP, XLM, ETH, Bitcoin. " +
  "Then render a markdown table with columns: Currency | Price | Source.";

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "web-search",
    description: "Searches the web and returns snippets/URLs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
];

const OLLAMA_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
}));

function buildHarnessLikeSystemPrompt(threadLines?: readonly string[]): string {
  const thread = threadLines && threadLines.length > 0
    ? `\n\n── thread (${threadLines.length} lines) ──\n${threadLines.join("\n")}`
    : "";
  return [
    "Available Tools:",
    "- web-search(query: string, maxResults: number?)",
    "",
    `Task: ${TASK}`,
    "",
    "RULES:",
    "1. When actions are independent, issue multiple tool calls in the same response.",
    "2. Use EXACT tool names and parameter names from the tool reference.",
    "3. Do NOT fabricate data. Only use information from tool results.",
    "4. Do NOT repeat identical calls (same tool + same arguments).",
    "5. REQUIRED tools MUST be called before giving FINAL ANSWER.",
    "6. For four currencies, prefer four distinct web-search calls.",
    thread,
  ].join("\n");
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "fresh-task-parallel",
    description: "No prior thread; asks for four independent searches in one turn.",
    systemPrompt: buildHarnessLikeSystemPrompt(),
    messages: [
      { role: "user", content: `${TASK} Use one web-search call per currency in this response.` },
    ],
  },
  {
    id: "after-one-result-nudge",
    description: "Simulates second turn after one successful XRP result and explicit quota nudge.",
    systemPrompt: buildHarnessLikeSystemPrompt([
      "[USER] Fetch the current USD price for: XRP, XLM, ETH, Bitcoin.",
      "----",
      "[TOOL] [web-search result — XRP snippets omitted]",
      "----",
      "[USER] You must still call: web-search (1/4 calls done). Call web-search now with the appropriate arguments.",
    ]),
    messages: [
      { role: "user", content: "Now call web-search with the appropriate arguments." },
    ],
  },
  {
    id: "conflicting-nudges",
    description: "Injects conflicting prior nudges to measure FC stability under noisy context.",
    systemPrompt: buildHarnessLikeSystemPrompt([
      "[USER] You must still call: web-search (3/4 calls done). Call web-search now.",
      "----",
      "[USER] Required tool calls are satisfied. Give FINAL ANSWER now.",
      "----",
      "[USER] Required tool quota not met: web-search. Continue calling missing required tool(s).",
    ]),
    messages: [
      { role: "user", content: "Continue. Use native function calls only." },
    ],
  },
  {
    id: "replay-failing-thread-shape",
    description: "Replays failing harness thread pattern: XRP then XLM then duplicated XRP and contradictory quota nudges.",
    systemPrompt: buildHarnessLikeSystemPrompt([
      "[USER] Fetch the current USD price for: XRP, XLM, ETH, Bitcoin. Then render a markdown table with columns: Currency | Price | Source.",
      "----",
      "[TOOL] [web-search result — XRP snippets omitted]",
      "----",
      "[USER] You must still call: web-search (1/4 calls done). Call web-search now with the appropriate arguments.",
      "----",
      "[TOOL] [web-search result — XLM snippets omitted]",
      "----",
      "[USER] You must still call: web-search (2/4 calls done). Call web-search now with the appropriate arguments.",
      "----",
      "[TOOL] [web-search result — XRP snippets omitted] [Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete.]",
      "----",
      "[USER] You must still call: web-search (3/4 calls done). Call web-search now with the appropriate arguments.",
      "----",
      "[USER] Required tool quota not met: web-search. Continue calling the missing required tool(s) before attempting completion.",
    ]),
    messages: [
      {
        role: "user",
        content:
          "Continue from this exact state. Use native function calls only and call web-search for missing currencies.",
      },
    ],
  },
];

function contentToText(content: string | readonly unknown[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (typeof block === "object" && block !== null && "text" in block) {
        return String((block as { readonly text?: unknown }).text ?? "");
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

function parseArguments(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: input };
    }
    return { _raw: input };
  }
  if (typeof input === "object" && input !== null) {
    return input as Record<string, unknown>;
  }
  return {};
}

function summarizeCallsFromSdk(
  toolCalls: readonly { readonly function?: { readonly name?: string; readonly arguments?: unknown } }[] | undefined,
): readonly ToolCallSummary[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls.map((call) => {
    const args = parseArguments(call.function?.arguments);
    return {
      name: call.function?.name ?? "(missing-name)",
      argKeys: Object.keys(args).sort(),
      args,
    };
  });
}

function summarizeCallsFromFramework(
  toolCalls: readonly { readonly name: string; readonly input: unknown }[] | undefined,
): readonly ToolCallSummary[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls.map((call) => {
    const args = parseArguments(call.input);
    return {
      name: call.name,
      argKeys: Object.keys(args).sort(),
      args,
    };
  });
}

function summarizeCallsFromResolver(
  toolCalls: readonly { readonly name: string; readonly arguments: Record<string, unknown> }[],
): readonly ToolCallSummary[] {
  return toolCalls.map((call) => ({
    name: call.name,
    argKeys: Object.keys(call.arguments).sort(),
    args: call.arguments,
  }));
}

function names(calls: readonly ToolCallSummary[]): readonly string[] {
  return calls.map((call) => call.name);
}

function argKeySignatures(calls: readonly ToolCallSummary[]): readonly string[] {
  return calls.map((call) => `${call.name}:${call.argKeys.join(",")}`);
}

function incrementFrequency(
  target: Record<string, number>,
  key: number,
): void {
  const stringKey = String(key);
  target[stringKey] = (target[stringKey] ?? 0) + 1;
}

function compareScenario(
  sdk: PathResult,
  framework: PathResult,
): ScenarioDiagnostics {
  const notes: string[] = [];
  const countsAligned = sdk.toolCalls.length === framework.toolCalls.length;
  const namesAligned =
    JSON.stringify(names(sdk.toolCalls)) === JSON.stringify(names(framework.toolCalls));
  const argKeysAligned =
    JSON.stringify(argKeySignatures(sdk.toolCalls)) === JSON.stringify(argKeySignatures(framework.toolCalls));

  if (!countsAligned) {
    notes.push(`tool_call_count mismatch sdk=${sdk.toolCalls.length} framework=${framework.toolCalls.length}`);
  }
  if (!namesAligned) {
    notes.push("tool name sequence differs between SDK and framework response");
  }
  if (!argKeysAligned) {
    notes.push("tool argument keys differ between SDK and framework response");
  }
  if (!sdk.stopReason || !framework.stopReason) {
    notes.push("missing stop reason in one of the paths");
  }

  return {
    countsAligned,
    namesAligned,
    argKeysAligned,
    notes,
  };
}

function buildSdkMessages(scenario: Scenario): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: scenario.systemPrompt },
  ];
  for (const message of scenario.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: `[TOOL:${message.toolName ?? "unknown"}] ${message.content}`,
      });
      continue;
    }
    messages.push({
      role: message.role,
      content: contentToText(message.content),
    });
  }
  return messages;
}

async function runScenarioWithSdk(
  client: Ollama,
  scenario: Scenario,
): Promise<PathResult> {
  try {
    const response = await client.chat({
      model: PROBE_MODEL,
      messages: buildSdkMessages(scenario),
      tools: OLLAMA_TOOLS,
      stream: false,
      options: {
        temperature: PROBE_TEMPERATURE,
      },
    });

    return {
      stopReason: response.done_reason ?? undefined,
      contentPreview: (response.message?.content ?? "").slice(0, 200),
      toolCalls: summarizeCallsFromSdk(response.message?.tool_calls),
    };
  } catch (error) {
    return {
      contentPreview: "",
      toolCalls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runScenarioWithFramework(
  scenario: Scenario,
  options?: { readonly thinking?: boolean },
): Promise<{ readonly path: PathResult; readonly resolver?: ResolverResultSummary }> {
  const modelParams: {
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
  } = {
    temperature: PROBE_TEMPERATURE,
    maxTokens: PROBE_MAX_TOKENS,
  };
  if (options?.thinking !== undefined) {
    modelParams.thinking = options.thinking;
  }

  const layer = createLLMProviderLayer(
    "ollama",
    undefined,
    PROBE_MODEL,
    modelParams,
  );

  try {
    const completion = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          systemPrompt: scenario.systemPrompt,
          messages: scenario.messages,
          tools: TOOL_DEFINITIONS,
          temperature: PROBE_TEMPERATURE,
          maxTokens: PROBE_MAX_TOKENS,
        });
      }).pipe(Effect.provide(layer)),
    );

    const path: PathResult = {
      stopReason: completion.stopReason,
      contentPreview: completion.content.slice(0, 200),
      toolCalls: summarizeCallsFromFramework(completion.toolCalls),
    };

    const resolver = createToolCallResolver({
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsLogprobs: false,
    });

    const resolverResult = Effect.runSync(
      resolver.resolve(
        {
          content: completion.content,
          stopReason: completion.stopReason,
          toolCalls: completion.toolCalls?.map((call) => ({
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        },
        TOOL_DEFINITIONS.map((tool) => ({ name: tool.name })),
      ),
    );

    const resolverSummary: ResolverResultSummary =
      resolverResult._tag === "tool_calls"
        ? {
            tag: "tool_calls",
            toolCalls: summarizeCallsFromResolver(resolverResult.calls),
          }
        : resolverResult._tag === "final_answer"
          ? {
              tag: "final_answer",
              contentPreview: resolverResult.content.slice(0, 200),
              toolCalls: [],
            }
          : {
              tag: "thinking",
              contentPreview: resolverResult.content.slice(0, 200),
              toolCalls: [],
            };

    return { path, resolver: resolverSummary };
  } catch (error) {
    return {
      path: {
        contentPreview: "",
        toolCalls: [],
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function main(): Promise<void> {
  const client = new Ollama({ host: OLLAMA_HOST });
  const selectedScenarios = PROBE_SCENARIOS.length === 0
    ? SCENARIOS
    : SCENARIOS.filter((scenario) => PROBE_SCENARIOS.includes(scenario.id));
  const reports: ScenarioReport[] = [];

  console.log(`Running Ollama native FC context probe`);
  console.log(`Host:  ${OLLAMA_HOST}`);
  console.log(`Model: ${PROBE_MODEL}`);
  console.log(`Scenarios: ${selectedScenarios.length}`);
  console.log(`Repeats: ${PROBE_REPEATS}`);
  if (PROBE_SCENARIOS.length > 0) {
    console.log(`Scenario filter: ${PROBE_SCENARIOS.join(", ")}`);
  }

  for (let runIndex = 1; runIndex <= PROBE_REPEATS; runIndex++) {
    console.log(`\nRun ${runIndex}/${PROBE_REPEATS}`);
    for (const scenario of selectedScenarios) {
      const sdk = await runScenarioWithSdk(client, scenario);
      const frameworkResult = await runScenarioWithFramework(scenario);
      const frameworkNoThinking = await runScenarioWithFramework(scenario, { thinking: false });
      const diagnostics = compareScenario(sdk, frameworkResult.path);
      const diagnosticsNoThinking = compareScenario(sdk, frameworkNoThinking.path);
      const report: ScenarioReport = {
        run: runIndex,
        id: scenario.id,
        description: scenario.description,
        sdk,
        framework: frameworkResult.path,
        resolver: frameworkResult.resolver,
        diagnostics,
        frameworkNoThinking: frameworkNoThinking.path,
        resolverNoThinking: frameworkNoThinking.resolver,
        diagnosticsNoThinking,
      };
      reports.push(report);

      const resolverCount =
        frameworkResult.resolver?.tag === "tool_calls"
          ? frameworkResult.resolver.toolCalls.length
          : 0;
      const resolverNoThinkingCount =
        frameworkNoThinking.resolver?.tag === "tool_calls"
          ? frameworkNoThinking.resolver.toolCalls.length
          : 0;
      const status = diagnostics.countsAligned && diagnostics.namesAligned && diagnostics.argKeysAligned
        ? "aligned"
        : "mismatch";
      const statusNoThinking =
        diagnosticsNoThinking.countsAligned &&
        diagnosticsNoThinking.namesAligned &&
        diagnosticsNoThinking.argKeysAligned
          ? "aligned"
          : "mismatch";
      console.log(
        `- ${scenario.id}: sdk=${sdk.toolCalls.length} framework=${frameworkResult.path.toolCalls.length} resolver=${resolverCount} => ${status}`,
      );
      console.log(
        `  ${scenario.id} (framework thinking=false): sdk=${sdk.toolCalls.length} framework=${frameworkNoThinking.path.toolCalls.length} resolver=${resolverNoThinkingCount} => ${statusNoThinking}`,
      );
      if (diagnostics.notes.length > 0) {
        for (const note of diagnostics.notes) {
          console.log(`  note: ${note}`);
        }
      }
      if (diagnosticsNoThinking.notes.length > 0) {
        for (const note of diagnosticsNoThinking.notes) {
          console.log(`  note(thinking=false): ${note}`);
        }
      }
    }
  }

  const aggregateByScenario: Record<
    string,
    {
      runs: number;
      sdkCallCountFrequency: Record<string, number>;
      frameworkCallCountFrequency: Record<string, number>;
      frameworkNoThinkingCallCountFrequency: Record<string, number>;
      mismatchRuns: number;
      mismatchNoThinkingRuns: number;
    }
  > = {};
  for (const report of reports) {
    const bucket = aggregateByScenario[report.id] ?? {
      runs: 0,
      sdkCallCountFrequency: {},
      frameworkCallCountFrequency: {},
      frameworkNoThinkingCallCountFrequency: {},
      mismatchRuns: 0,
      mismatchNoThinkingRuns: 0,
    };
    bucket.runs += 1;
    incrementFrequency(bucket.sdkCallCountFrequency, report.sdk.toolCalls.length);
    incrementFrequency(bucket.frameworkCallCountFrequency, report.framework.toolCalls.length);
    incrementFrequency(
      bucket.frameworkNoThinkingCallCountFrequency,
      report.frameworkNoThinking?.toolCalls.length ?? 0,
    );
    if (!(report.diagnostics.countsAligned && report.diagnostics.namesAligned && report.diagnostics.argKeysAligned)) {
      bucket.mismatchRuns += 1;
    }
    if (
      report.diagnosticsNoThinking &&
      !(report.diagnosticsNoThinking.countsAligned &&
        report.diagnosticsNoThinking.namesAligned &&
        report.diagnosticsNoThinking.argKeysAligned)
    ) {
      bucket.mismatchNoThinkingRuns += 1;
    }
    aggregateByScenario[report.id] = bucket;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(process.cwd(), "harness-reports");
  const outputPath = join(outputDir, `ollama-native-fc-context-probe-${timestamp}.json`);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        host: OLLAMA_HOST,
        model: PROBE_MODEL,
        temperature: PROBE_TEMPERATURE,
        maxTokens: PROBE_MAX_TOKENS,
        repeats: PROBE_REPEATS,
        scenarios: reports,
        aggregateByScenario,
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote probe report: ${outputPath}`);
}

main().catch((error) => {
  console.error("Probe failed:", error);
  process.exitCode = 1;
});
