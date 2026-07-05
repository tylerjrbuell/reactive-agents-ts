# North-Star Live Probe Validation — 2026-07-05

**Purpose:** validate the Agentic OS north star (`08-AGENTIC-OS-NORTH-STAR.md`) with live end-to-end runs before building. 7 probes, all local Ollama (qwen3:4b, cogito:8b), run from repo root against src (bun workspace resolution). Probe scripts: `.probes-live/` (git-excluded).

## Probe results

| # | Probe | Result | North-star impact |
|---|---|---|---|
| P1 | First-touch DX + result surface (qwen3:4b + calculator) | ✅ 6.0s, correct answer, clean DX. Result carries `agentId, format, goalAchieved, metadata, output, success, taskId, terminatedBy` — **zero trust/grounding/debrief fields; `toolsUsed` undefined**. Telemetry first-run notice already ships with opt-out hint. | Receipt gap live-proven and visceral: developer cannot tell whether the answer used the tool or was guessed. Transparency clause (a) already half-shipped. |
| P2 | RunHandle process control (runStream + timers) | ✅ `pause()/resume()/stop()` all work live (`"paused"→"running"→"stopped"`, graceful). `inspect/fork/grant/revoke/state` = undefined; `status()` = bare string. Stream emitted only `TextDelta`(264)+`StreamCompleted`(1). | Process-control rail solid; introspection/fork gap confirmed. Event poverty on inline path. |
| P3 | Durable rail via `run()` (bogus `{dbPath}` option) | ⚠️ Run succeeded; **unknown builder option silently swallowed** (no warn). DB created at default dir. **run row present, 0 checkpoints, 0 events.** | **NEW FINDING — silent no-op configs.** `run()` + `.withDurableRuns()` = no crash-resume substrate at all. |
| P3b | Durable rail via `runStream()`, then + `.withReasoning()` | ⚠️→✅ Without `.withReasoning()`: 0 checkpoints. With: **2 checkpoints, versioned codec (`codecVersion`+`state`)** — fork substrate real. `run_events` 0 on ALL sdk paths (journal = server-endpoints only). Kernel path emits `IterationProgress`, inline path emits `TextDelta` — different event vocab for same task. | Durability is real but **only on the kernel path**, and nothing tells the user. Event-log 4-way split confirmed live as per-path vocabulary divergence. |
| P4 | Replay/diagnose + LLM I/O capture | ✅ `rax diagnose replay latest` renders full timeline (llm/tool/entropy/verifier). **`llm-exchange` events DO fire on the live path** (contradicts stale `analyze.ts:322` comment): request side complete (systemPrompt + full message history), **response side gutted — `content:""`, toolCalls names-only, no arguments**. Emitter schema (`diagnostics.ts:306`) already supports `arguments?: unknown` + truncation flags — the caller drops them. | **Arc 1 keystone SHRINKS**: not "build LLM I/O capture" — "populate response payload at the call sites + persist". Materially cheaper than spec assumed. |
| P5 | Calibration flywheel (cogito:8b, `withCalibration("auto")`) | ✅ Community profile fetched live from api.reactiveagents.dev during build (sampleCount 73, 30-day window), cached to `~/.reactive-agents/community-profiles/`. install-id present since May. Run correct. | Flywheel pull LIVE end-to-end in production. Commons = running infrastructure. |
| P6 | Structured output on 4B local (`withOutputSchema`) | ✅ Fully-typed nested object (arrays, booleans), 7.4s, 913 tokens. | Cross-tier claim re-verified. Launch asset intact. |
| P7 | A2A exposure (`.withA2A({port})` + `start()`) | ❌ `start()` throws "Gateway not configured" (start is gateway-only); port never opens; `/.well-known/agent.json` unreachable. | Audit finding confirmed exactly. Cross-machine mesh dead end-to-end. Arc 3 item 1 validated. |

## Verdict: north star CONFIRMED and sharpened

The live evidence **strengthens** the wiring-program thesis on every axis tested:

1. **The receipt gap is worse in practice than on paper** — P1 shows a developer can't even see `toolsUsed` on the result. Arc 1's `result.receipt` is the single highest-leverage DX change validated.
2. **The keystone got cheaper** — LLM I/O capture already fires live; the work is completing the response payload (fields already in the emitter schema) and persisting exchanges for replay. Arc 1 timeline improves.
3. **A NEW workstream is mandatory: config truthfulness.** Two live silent no-ops found in one session: (a) unknown builder options swallowed (`{dbPath}` accepted, defaulted elsewhere); (b) `.withDurableRuns()` inert on the default execution path (and on `run()`), no warning. For a framework whose brand is honesty, the builder itself must not lie. Add to Arc 2 (boundary/honesty): unknown-option rejection + inert-combination warnings (e.g. "durable checkpoints require .withReasoning(); this run will not checkpoint").
4. **The flywheel is a live asset, not a plan** — community pull + telemetry notice already production; Arc 4 builds on running rails.
5. **Process rail is half-strong** — pause/resume/stop work today (good demo material NOW); inspect/fork remain the differentiating build.
6. **A2A dormancy exact** — Arc 3's "last mile first" ordering validated.

## Amendments applied to the north star spec

- §4.1 keystone re-scoped (capture exists; complete + persist response payloads).
- Arc 2 gains **config truthfulness** (unknown-option rejection, inert-combo warnings, durable-on-run() fix or explicit error).
- Evidence provenance: this report.

## Repro

```bash
# probes live in .probes-live/ (git-excluded); Ollama required
bun .probes-live/p1-first-touch.ts
bun .probes-live/p2-runhandle.ts
bun .probes-live/p3b-durable.ts   # with/without .withReasoning() line
bun apps/cli/src/index.ts diagnose replay latest
bun .probes-live/p5-flywheel.ts
bun .probes-live/p6-structured.ts
bun .probes-live/p7-a2a.ts
```
