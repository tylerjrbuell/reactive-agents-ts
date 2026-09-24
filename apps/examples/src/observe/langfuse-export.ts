/**
 * End-to-end verification: ship agent traces to a real Langfuse project.
 *
 * Unlike `otel-export.ts` (which is hermetic and points at an unreachable
 * port), this script exports to an ACTUAL Langfuse backend via the
 * `setupLangfuseExporter` preset, then queries Langfuse's public API to confirm
 * the trace landed. This is the honest "spans actually arrive and look sane"
 * check the exporter's acceptance criteria call for.
 *
 * You do NOT need an LLM API key — the deterministic `test` provider still
 * drives the OpenInferenceTracerLayer to emit agent + llm spans. Set
 * ANTHROPIC_API_KEY (etc.) to exercise a live model + tool spans instead.
 *
 * Required env:
 *   LANGFUSE_PUBLIC_KEY=pk-lf-...
 *   LANGFUSE_SECRET_KEY=sk-lf-...
 * Optional:
 *   LANGFUSE_HOST=https://us.cloud.langfuse.com   (default https://cloud.langfuse.com)
 *
 * Usage:
 *   LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
 *     bun run apps/examples/src/observe/langfuse-export.ts
 */
import { ReactiveAgents } from "reactive-agents";
import {
  OpenInferenceTracerLayer,
  setupLangfuseExporter,
} from "reactive-agents/observe";

const publicKey = process.env["LANGFUSE_PUBLIC_KEY"];
const secretKey = process.env["LANGFUSE_SECRET_KEY"];
const host = (process.env["LANGFUSE_HOST"] ?? "https://cloud.langfuse.com").replace(
  /\/$/,
  "",
);

if (!publicKey || !secretKey) {
  console.error(
    "Missing credentials. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY " +
      "(from your Langfuse project settings) and re-run.",
  );
  process.exit(2);
}

const SERVICE_NAME = "reactive-agents-langfuse-verify";

async function main() {
  console.log("=== Langfuse End-to-End Export Verification ===\n");
  console.log(`Host:    ${host}`);

  const provider = (process.env["ANTHROPIC_API_KEY"] ? "anthropic" : "test") as
    | "anthropic"
    | "test";
  console.log(
    `Mode:    ${provider === "test" ? "TEST (deterministic, no LLM key)" : "LIVE (anthropic)"}\n`,
  );

  // ─── Wire the real Langfuse exporter ─────────────────────────────────────
  const handle = setupLangfuseExporter({
    publicKey,
    secretKey,
    host,
    serviceName: SERVICE_NAME,
  });

  // ─── Build a traced agent ────────────────────────────────────────────────
  let b = ReactiveAgents.create()
    .withName("langfuse-traced-agent")
    .withProvider(provider);
  if (provider === "test") {
    b = b.withTestScenario([
      { text: "FINAL ANSWER: Trace shipped to Langfuse for verification." },
    ]);
  }
  const agent = await b
    .withMaxIterations(3)
    .withLayers(OpenInferenceTracerLayer)
    .build();

  const result = await agent.run(
    "Emit an agent lifecycle so we can confirm Langfuse ingestion.",
  );
  console.log(`Agent run success: ${result.success}`);

  // Flush pending spans over HTTP to Langfuse, then shut down.
  await handle.shutdown();
  console.log("Spans flushed. Confirming ingestion via Langfuse API…\n");

  // ─── Confirm the spans landed (poll — ingestion is async) ────────────────
  // Uses the v2 observations API. The legacy GET /api/public/traces is
  // disabled for Langfuse orgs created on/after 2026-09-16, and v4 exposes
  // OTLP-ingested span data through observations, not the traces list.
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const from = new Date(Date.now() - 5 * 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const url =
    `${host}/api/public/v2/observations` +
    `?fromStartTime=${encodeURIComponent(from)}` +
    `&toStartTime=${encodeURIComponent(to)}&limit=50`;

  let landed = false;
  for (let attempt = 1; attempt <= 12 && !landed; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      console.error(`Langfuse API ${res.status}: ${await res.text()}`);
      break;
    }
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const observations = body.data ?? [];
    const match = observations.find((o) =>
      JSON.stringify(o).includes("langfuse-traced-agent"),
    );
    if (match) {
      landed = true;
      console.log("✅ Span found in Langfuse:");
      console.log(`   observation id: ${match["id"]}`);
      console.log(`   name:           ${match["name"]}`);
      console.log(`   trace id:       ${match["traceId"]}`);
      console.log(`   view:           ${host}/trace/${match["traceId"]}`);
    } else {
      console.log(
        `   …not visible yet (attempt ${attempt}/12, ${observations.length} recent), retrying in 3s`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (!landed) {
    console.error(
      "\n❌ Could not confirm the trace via API within the timeout. " +
        "Ingestion can lag a few minutes — check the Langfuse UI directly:\n" +
        `   ${host}  →  Tracing`,
    );
    process.exit(1);
  }

  console.log("\n✅ PASS — spans exported and confirmed in Langfuse.");
  console.log(
    "   Open the trace above and sanity-check: it should show an `agent:*` " +
      "span with `llm:*` children carrying model/provider/token attributes.",
  );
}

await main();
