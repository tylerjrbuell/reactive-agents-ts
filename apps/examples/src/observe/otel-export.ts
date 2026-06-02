/**
 * Example: OpenTelemetry / OpenInference export via @reactive-agents/observe.
 *
 * Demonstrates the opt-in observe surface:
 *
 *   - `setupOpenInferenceExporter` — wire an OTLP/HTTP exporter that ships
 *     OpenInference-attributed spans to any compatible backend (Phoenix,
 *     Jaeger via OTLP gateway, Honeycomb, Datadog, etc.).
 *   - `OpenInferenceTracerLayer` — Effect Layer that subscribes to the
 *     `EventBus` and produces semantic spans for the agent lifecycle, LLM
 *     calls, and tool calls.
 *
 * The example uses an *in-memory* SpanProcessor as a witness so the example
 * is hermetic (no live OTLP backend required) while still exercising the
 * real exporter setup function. Production code would point the exporter
 * at an actual collector via `endpoint:` or the
 * `OTEL_EXPORTER_OTLP_ENDPOINT` env var.
 *
 * Usage:
 *   bun run apps/examples/src/observe/otel-export.ts
 */
import { ReactiveAgents } from "reactive-agents";
import {
  OpenInferenceTracerLayer,
  setupOpenInferenceExporter,
} from "reactive-agents/observe";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as otelApi from "@opentelemetry/api";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: {
  provider?: string;
  model?: string;
}): Promise<ExampleResult> {
  const start = Date.now();

  type PN =
    | "anthropic"
    | "openai"
    | "ollama"
    | "gemini"
    | "litellm"
    | "test";
  const provider = (opts?.provider ??
    (process.env["ANTHROPIC_API_KEY"] ? "anthropic" : "test")) as PN;

  console.log("=== Reactive Agents: OTel / OpenInference Export Example ===\n");
  console.log(
    `Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`,
  );

  // ─── Stand up an in-memory span witness ──────────────────────────────────
  // This stands in for a real OTLP collector. In production you would call
  // `setupOpenInferenceExporter({ endpoint: ... })` and skip this block —
  // the exporter would ship spans over HTTP to your backend.
  const memoryExporter = new InMemorySpanExporter();
  const witnessProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
  });
  witnessProvider.register();
  otelApi.trace.setGlobalTracerProvider(witnessProvider);

  // ─── Wire the OTLP exporter (real surface, exercise the code path) ───────
  // We point at an unreachable port so this example stays hermetic — the
  // BatchSpanProcessor inside the exporter swallows export failures and
  // shutdown() flushes cleanly even when the backend is down.
  const exporterHandle = setupOpenInferenceExporter({
    endpoint: "http://127.0.0.1:65535", // unreachable, hermetic
    serviceName: "reactive-agents-example",
  });

  // setupOpenInferenceExporter installed its own global provider — restore
  // the in-memory witness so we can count spans locally.
  otelApi.trace.setGlobalTracerProvider(witnessProvider);

  // ─── Build the agent with the OpenInference tracer Layer ─────────────────
  let b = ReactiveAgents.create()
    .withName("otel-traced-agent")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") {
    b = b.withTestScenario([
      {
        text: "FINAL ANSWER: OTel traces emitted successfully for this run.",
      },
    ]);
  }
  const agent = await b
    .withMaxIterations(3)
    .withLayers(OpenInferenceTracerLayer)
    .build();

  // ─── Run a query ─────────────────────────────────────────────────────────
  const result = await agent.run(
    "Demonstrate that agent lifecycle events flow through the OTel exporter.",
  );

  // Flush pending spans through both providers.
  await exporterHandle.shutdown();
  // Give the SimpleSpanProcessor a chance to drain.
  await new Promise((r) => setTimeout(r, 10));
  await witnessProvider.forceFlush();

  // ─── Witness ─────────────────────────────────────────────────────────────
  const spans = memoryExporter.getFinishedSpans();
  const agentSpans = spans.filter((s) => s.name.startsWith("agent:"));
  const llmSpans = spans.filter((s) => s.name.startsWith("llm:"));
  const toolSpans = spans.filter((s) => s.name.startsWith("tool:"));

  console.log("─── OTel Witness ───");
  console.log(`Total spans:  ${spans.length}`);
  console.log(`  agent:*     ${agentSpans.length}`);
  console.log(`  llm:*       ${llmSpans.length}`);
  console.log(`  tool:*      ${toolSpans.length}`);
  console.log(`\n─── Result ───`);
  console.log(`Success:      ${result.success}`);
  console.log(`Output:       ${result.output.slice(0, 80)}`);
  console.log(`Steps:        ${result.metadata.stepsCount}`);
  console.log(`Tokens:       ${result.metadata.tokensUsed}`);

  await witnessProvider.shutdown();
  otelApi.trace.disable();

  // Witness passes if (a) the agent succeeded and (b) at least one workflow
  // span was produced by the OpenInferenceTracerLayer.
  const passed = result.success && agentSpans.length >= 1;
  const output = `otel-spans=${spans.length} (agent=${agentSpans.length}, llm=${llmSpans.length}, tool=${toolSpans.length}) | ${result.output.slice(0, 60)}`;

  return {
    passed,
    output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
