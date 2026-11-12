---
type: design-spec
status: proposed
created: 2026-11-12
tags: [cortex, workflows, gateway, compose, durable]
---

# Cortex Workflows: an n8n-style automation tool where every agent node keeps its full loop

Status: proposed, for owner ratification. Nothing here is built. Companion to [[2026-11-10-cortex-ui-modernization]] (UI) and the audit [[../../Research/Audit-Reports-2026-11-12/gateway-channels-deploy-audit]] (triggers depend on its fixes #8 `ScheduleRegistry` and #6 canonical `ChannelAdapter`). Authority: this spec amends nothing in 08/09; it is a product slice on top of them and obeys the honest-claims law (08).

## 1. Goals and non-goals

### Goals
1. A visual workflow editor in Cortex: trigger -> nodes -> delivery, saved, versioned, runnable, exportable as one JSON file.
2. **Agent nodes are full agents.** A node runs a saved Cortex agent (its tools, memory, strategy, guardrails) with the full loop. Workflows add *structure around* agents; they never flatten an agent into a prompt step.
3. The differentiator, in this order: (a) **judgment-based branching with calibrated confidence** (JudgmentService Choice/Noul/Score, `calibrated` flag and `confidence` gate the edge); (b) **approvals and questions as first-class nodes**; (c) **typed data**: every agent node declares an output schema, every edge is checked against it; (d) **full trace per node**: click a node in a finished run, see the agent's whole run view.
4. Hermes-style automation: scheduled and event-triggered runs that **deliver to chat platforms** (Signal, Telegram, webhook) with real delivery receipts.
5. Composition both ways: a workflow can call a workflow (sub-workflow node) and an agent can call a workflow (`run_workflow` tool). Cortex chat gets `/workflows`.
6. Local-first and free: one SQLite file, no external service, runs on the user's machine.
7. A clean, *unbuilt* path to a hosted or self-hosted multi-user platform (section 8).

### Non-goals (v1)
- No second execution engine, scheduler, retry framework, or agent loop.
- No arbitrary code in expressions or code nodes (section 5). No marketplace, no 400-integration catalogue; integrations come from MCP and the tool registry.
- No multi-user, workspaces, RBAC, billing, metering UI. Seams only.
- No distributed or multi-node execution. One process runs a workflow run; others may resume it after a crash.
- No visual "any-to-any" data mapping UI. Mapping is JSON Pointer picking.
- No natural-language workflow generation in v1 (a later Lab-style helper; the JSON schema makes it easy, do not build it first).

## 2. Core principle: workflows COMPILE TO existing pieces

A workflow is **data**. Running it is a thin, deterministic graph walker that calls things the framework already has. If a node type cannot be expressed as a call to an existing service, it does not ship in v1.

### What exists and what each node reuses (read from code, 2026-11-12)

| Need | Existing piece | Evidence |
|---|---|---|
| Run an agent with a typed result | `ReactiveAgentBuilder` + `.withOutputSchema()` (`_outputSchemaConfig`, `engine/finalize/extract-object.ts`), saved Cortex agents built by `buildCortexAgent` from `cortex_agents.config` | `packages/runtime/src/builder/withers/_state.ts`, `apps/cortex/server/services/build-cortex-agent.ts` |
| Crash-safe agent run | `.withDurableRuns()`: `RunStore` in `runs.db`, kernel checkpoint every N iterations, `resumeRun`, durable tool-effect ledger (`reconcileToolEffects`) so a resumed run does not repeat a side effect | `agent/durable-facade.ts`, `horizon-contract.ts` |
| Human approval and questions | `HumanGate` (live, in-process waits) and durable `awaiting-approval` / `awaiting-interaction` pauses answered from any process (`approveRun`, `respondToInteraction`); Cortex already persists these (`chat_pending_approvals`, `chat_pending_interactions`, `durable-approvals.ts`) | `engine/human-gate.ts`, `withers/horizon-contract.ts` |
| Calibrated branching | `JudgmentService.ask({state, questions})` returns `Choice/Noul/Score` answers; Choice and Score carry `confidence` and `calibrated`; `passes()` gates on probability + confidence; `capabilitiesOf` | `packages/judgment/src/types.ts`, `services/judgment-service.ts`; rubric grading precedent with a default `minConfidence` of 0.6 calibrated and 0.8 uncalibrated in `packages/eval/src/graders/rubric.ts` |
| Budgets, timeouts, stops | compose killswitches `budgetLimit`, `timeoutAfter`, `maxIterations`, `requireApprovalFor`, `watchdog`; `RunHandle` (`inspect()`, stop) over the run controller | `packages/compose/src/killswitches/*`, `core/src/streaming.ts` |
| Cron and heartbeat | `parseCron` / `shouldFireAt` (gateway `cron-parser.ts`, already imported by Cortex `chat-schedule-service.ts`), `SchedulerService.checkCrons` | `packages/gateway/src/services/` |
| Inbound events and policy | `GatewayEvent`, `PolicyEngine.evaluatePolicies` (rate, budget, access), `WebhookService` adapters, channel `InboundEnvelope` (target contract in the audit) | `packages/gateway`, `packages/channels` |
| Outbound delivery | `ChannelAdapter.send -> DeliveryReceipt` (audit contract, not yet built); today the LLM calls an MCP tool, which is not deterministic delivery | audit "Key finding" |
| Tool/MCP call | `ToolService` execute path, `defineTool`, MCP client | `packages/tools` |
| Agent calls an agent | `withAgentTool(name, { parameters })` with JSON-Schema-validated parameters (`compileSubAgentInputCheck`) | `builder/withers/identity-surface.ts` |
| Run view and traces | `cortex_runs`, `cortex_events`, Cortex run view, `rax-diagnose` | `apps/cortex/server/db/schema.ts` |
| Per-schedule cost caps and TTL precedent | `chat-schedule-service.ts` (`maxCostUsd`, expiry, `skipped:busy`, fire log) | `apps/cortex/server/services/chat-schedule-service.ts` |

### What compose does NOT give us (stating it precisely)
`packages/compose` today is **only the six-name killswitch registry** (`budgetLimit`, `timeoutAfter`, `maxIterations`, `requireApprovalFor`, `watchdog`, plus the registry listing) and its tests. It is *harness* composition: wrap **one run** with limits. It has no notion of a graph, of one run's output feeding another, of branching, or of a multi-step durable unit. Durable runs are likewise **per agent run**: `RunStore` knows one run's kernel state, not "this run is step 4 of workflow W run R".

### What is genuinely missing (the only new framework surface)
1. **A durable workflow-run record** (`workflow_runs`, `node_runs`): which node finished, with what output, which is waiting on what. Kernel checkpoints cannot hold this.
2. **A graph walker** (~400-600 LOC): topological scheduling, branch/join, loop bound, expression evaluation, per-node retry, calling the existing services above, writing node records. It is a *reducer over node state*, not an agent loop.
3. **A schema-checked edge**: validating a node's output against the next node's declared input (Effect Schema / JSON Schema both already exist in the repo; this is wiring).
4. **Trigger registration with durable state**: this is the audit's `ScheduleRegistry` (fix #8), plus webhook ingress (fix #9, G6) and the canonical `ChannelAdapter` (fix #6). Workflows are the *first consumer*; they must not grow a private scheduler.
5. **Deterministic delivery** (`ChannelAdapter.send` with typed receipt/failure): audit fix #5/#6. Until it ships, the deliver node supports only the webhook adapter and an honest `unsupported`.
6. **A `run_workflow` tool and a `RunWorkflow` service interface** that runtime can inject (so the tool does not depend on Cortex).

Everything else is reuse. Placement decision (open question Q1): the data model, validator and walker live in a **new package `@reactive-agents/workflow`** (deps: core, runtime, judgment, compose; no Cortex, no UI), so CLI and self-hosted users can run an exported file headlessly (`rax workflow run file.json`) and Cortex is only store + editor + API. This needs owner approval per the new-package rule; the fallback is a `workflow/` module inside `packages/runtime`.

## 3. Data model

Effect Schema (`Schema.Struct`, tagged unions), one file `packages/workflow/src/schema.ts`. Sketch, not final names. Everything is plain JSON so it round-trips as a file.

```ts
/** Portable file envelope. `format` + `version` gate import; unknown versions are refused, never guessed. */
export const WorkflowFile = Schema.Struct({
  format: Schema.Literal("reactive-agents/workflow"),
  version: Schema.Literal(1),
  workflow: Workflow,
  /** Saved agents the workflow references, embedded by value so a file runs elsewhere (secrets excluded). */
  agents: Schema.optional(Schema.Record({ key: Schema.String, value: AgentConfigRef })),
});

export const Workflow = Schema.Struct({
  id: WorkflowId,                       // stable slug, unique per store; also the /workflows name
  name: Schema.String,
  description: Schema.optional(Schema.String),
  revision: Schema.Number,              // bumped on every save; a Run pins the revision it started on
  inputs: JsonSchemaObject,             // manual / sub-workflow / run_workflow inputs (JSON Schema)
  triggers: Schema.Array(Trigger),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
  limits: Schema.optional(WorkflowLimits), // { maxCostUsd, timeoutMs, maxNodeRuns }
  ui: Schema.optional(Schema.Unknown),     // node positions; ignored by the walker
});

export const Edge = Schema.Struct({
  id: Schema.String,
  from: Schema.Struct({ node: NodeId, port: Schema.String }), // "out", "true", "false", a choice label, "error"
  to: Schema.Struct({ node: NodeId, port: Schema.String }),   // "in"
  /** Optional field mapping: target input key -> JSON Pointer into the source node's output. Absent = pass whole output. */
  map: Schema.optional(Schema.Record({ key: Schema.String, value: JsonPointer })),
});

export const Trigger = Schema.Union(
  Schema.TaggedStruct("Cron",     { schedule: Schema.String, timezone: Schema.optional(Schema.String), inputs: Schema.optional(Schema.Unknown) }),
  Schema.TaggedStruct("Webhook",  { path: Schema.String, secretRef: SecretRef, inputsFrom: Schema.optional(JsonPointer) }),
  Schema.TaggedStruct("Channel",  { adapterId: Schema.String, match: ChannelMatch }), // sender allow-list, mention, text regex
  Schema.TaggedStruct("Manual",   {}),
);
// A Trigger has `enabled` and an `id`; registration state (nextFireAt, lastFireAt, paused) lives in ScheduleRegistry, not here.

export const Node = Schema.Struct({
  id: NodeId,
  label: Schema.optional(Schema.String),
  spec: NodeSpec,                       // tagged union, section 4
  retry: Schema.optional(RetryPolicy),  // { maxAttempts, backoff: "none"|"exp", baseMs }, default none
  timeoutMs: Schema.optional(Schema.Number),
  onError: Schema.optional(Schema.Literal("fail", "continue", "route")), // "route" emits on the node's "error" port
});

export const WorkflowRun = Schema.Struct({
  runId: RunId,                         // also the idempotency anchor
  workflowId: WorkflowId, revision: Schema.Number,
  trigger: Schema.Struct({ kind: Schema.String, firedAt: Schema.Number, idempotencyKey: Schema.optional(Schema.String), payload: Schema.Unknown }),
  status: Schema.Literal("running", "waiting", "succeeded", "failed", "cancelled", "budget-stopped"),
  startedAt: Schema.Number, endedAt: Schema.optional(Schema.Number),
  costUsd: Schema.Number, tokens: Schema.Number,
  ownerId: Schema.String,               // "local" in v1 (seam, section 8)
});

export const NodeRun = Schema.Struct({
  runId: RunId, nodeId: NodeId, attempt: Schema.Number, iteration: Schema.optional(Schema.Number), // loop index
  status: Schema.Literal("pending", "running", "waiting", "succeeded", "failed", "skipped"),
  input: Schema.optional(Schema.Unknown), output: Schema.optional(Schema.Unknown),
  agentRunId: Schema.optional(Schema.String),  // -> cortex_runs.run_id and the durable RunStore row: THE trace link
  waitingOn: Schema.optional(Schema.Struct({ kind: Schema.Literal("approval", "interaction", "timer"), gateId: Schema.String })),
  judgment: Schema.optional(Schema.Struct({ backend: Schema.String, calibrated: Schema.Boolean, answer: Schema.Unknown })),
  error: Schema.optional(Schema.Struct({ kind: Schema.String, message: Schema.String, retryable: Schema.Boolean })),
  startedAt: Schema.optional(Schema.Number), endedAt: Schema.optional(Schema.Number),
});
```

Rules:
- **Versioned and portable.** `format`+`version` on the file; `revision` on the workflow. A `WorkflowRun` pins `revision`; editing a workflow never mutates an in-flight run. Import validates with the same schema as the editor; unknown node `_tag` is a typed import error.
- **Secrets are references** (`SecretRef = { name }`), never values, in the file. Export strips them and lists required names.
- **Agents by reference, optionally embedded.** A node names a saved agent id. Export embeds the agent's `AgentConfig` (Cortex Plan 10 P2 makes this one schema) so the file is self-contained; import maps them onto local saved agents (create or pick).
- **Storage.** Cortex SQLite tables `workflows`, `workflow_revisions`, `workflow_runs`, `workflow_node_runs`, `workflow_triggers` (registration state is delegated to `ScheduleRegistry` once it exists; v1 may keep a table behind the same interface). The `WorkflowStore` is an Effect `Context.Tag` with one SQLite implementation, so hosted can swap it.
- Edge `from.port` set per node type; the validator rejects dangling ports, cycles outside a Loop node, unreachable nodes, and two edges into a non-join input.

## 4. Node catalogue for v1

Common to all: inputs arrive on port `in` (a JSON value shaped by the edge `map`), output leaves on named ports, every node writes a `NodeRun`, failure becomes `error.kind` + `retryable`, `onError` decides fail / continue / route.

| Node | Config | Output | Failure modes | Maps to |
|---|---|---|---|---|
| **Trigger: Cron** | schedule, timezone, fixed inputs | trigger payload `{firedAt}` | missed fire after downtime (catch-up policy `skip` or `fire-once`), overlapping fire (policy `skip` or `queue`) | `ScheduleRegistry` (audit #8) using gateway `parseCron`; **not** `SchedulerService.checkCrons` (in-memory, G4) |
| **Trigger: Webhook** | path, secretRef, optional inputs pointer | request body + headers (allow-listed) | bad signature, replay (nonce/timestamp window), body too large | audit #9 webhook ingress + `WebhookService` adapters; HMAC required, never fail-open |
| **Trigger: Channel message** | adapterId, sender allow-list, mention/regex | `InboundEnvelope` fields (`text`, `sender`, `conversation`, `attachments`) | unknown sender, echo, duplicate platform message id | canonical `ChannelAdapter.inbound` + gateway `PolicyEngine`; dedupe by platform message id (fixes G11) |
| **Trigger: Manual** | none | validated workflow `inputs` | invalid inputs (typed error at start, never mid-run) | Cortex API, `/workflows run`, `run_workflow` tool |
| **Agent** | `agentId`; `task` template; `inputSchema`; `outputSchema` (JSON Schema, default from the saved agent's `outputSchema`); `memory` (`inherit`/`off`); `maxCostUsd`; `maxIterations` | the agent's structured output (validated), plus `meta {agentRunId, costUsd, status}` | schema extraction failed after the framework's own repair (`extract-object`), agent budget stop, agent paused for tool approval (node goes `waiting`), provider error | build with `buildCortexAgent(config)`, `.withOutputSchema(...)`, `.withDurableRuns()`, killswitches via compose; run through the same desk runner so `cortex_runs` / run view see it. `agentRunId` stored on `NodeRun` |
| **Judge (branch)** | `question`: `choice{labels,criteria}` / `noul` / `score`; `state` (the pointer or template giving the judged value); `minConfidence`; `onLowConfidence`: `route:<label>` (default port `uncertain`) | `{answer, confidence?, calibrated, backend}`; emitted on the port named by the label, or `uncertain` | `JudgmentUnsupported` / timeout / unauthorized (typed errors from the judgment package); **uncalibrated backend** (see below) | `JudgmentService.ask` + `passes()`; `capabilitiesOf` to know up front |
| **If (field branch)** | one predicate over the input: `{path, op, value}` with `op` in `eq ne gt gte lt lte exists in contains`; combinable with `all`/`any`/`not` | passes input through on `true` or `false` | pointer missing (treated as `exists=false`, never an exception); type mismatch is a validation error at edit time | pure function, zero tokens |
| **Parallel / Join** | Parallel: fans out on all outgoing edges. Join: `mode: all\|any\|n-of`, `timeoutMs`, `onTimeout` | Join: `{[sourceNodeId]: output}` | one branch fails (`all` fails join unless branch `onError: continue`), `any` + late arrivals (cancelled via `RunHandle`) | walker concurrency (bounded, section 6) |
| **Loop** | `over: JsonPointer` (array) or `until: predicate`; `maxIterations` (required, default 10, hard cap 100); body = a sub-graph or a sub-workflow | array of body outputs, or last output | cap reached (`exit` port `capped`, never silent), body fails | walker; body iterations are separate `NodeRun`s keyed by `iteration` |
| **Approval** | `message` template, `showFields` (pointers to display), `timeoutMs`, `onTimeout`: `deny\|approve\|fail`, `approvers` (v1: "local user") | ports `approved`, `denied`; payload carries `decidedBy`, `reason` | timeout, nobody reachable (delivery of the request failed) | durable `awaiting-approval` pause model; the walker owns its own gate record (see below). Surfaces in Cortex approvals UI and as a channel message |
| **Ask user** | `prompt`, `kind: form\|choice\|confirmation`, `schema` for the answer | the validated answer | timeout, schema-invalid answer (re-asked once, then fail) | `request_user_input` / `InteractionRequested` / `respondToInteraction` shapes (`HumanGateRequest.kind="interaction"`) |
| **Tool / MCP call** | `tool` (registry or MCP name), `args` template with pointers, `inputSchema` | tool result (validated against `outputSchema` if declared) | tool error, timeout, guardrail denial, side-effect repeated on resume (see idempotency) | `ToolService` execute path with the standard guardrails; effect recorded in the durable tool-effect ledger; MCP only through already-configured servers |
| **Deliver to channel** | `adapterId`, `to` (conversation id or `trigger.sender`), `message` template, `attachments` pointers, `onFailure` | `DeliveryReceipt {messageId, status}` | typed `ChannelError` kinds from the audit: `auth`, `rate_limited` (+`retryAfterMs`), `not_found`, `forbidden`, `too_large`, `unsupported`, `network` | canonical `ChannelAdapter.send`. **Hard dependency** on audit #5/#6. Until then only the webhook adapter is selectable |
| **Sub-workflow** | `workflowId`, input mapping, `mode: wait\|detach` | child's final output (wait) or `{runId}` (detach) | child failed, recursion depth > 5 (validator refuses cycles at save, walker enforces depth) | starts a `WorkflowRun` with `parent {runId,nodeId}`; same walker |

Notes on the three non-obvious nodes:

- **Judge node and honesty.** Branching on a number the model made up is the thing to avoid. The node records `calibrated` on every `NodeRun.judgment`. Rules: (1) a Choice/Score branch is taken only if `confidence >= minConfidence`; (2) the default `minConfidence` follows the rubric grader precedent: 0.6 when `calibrated`, 0.8 when not; (3) the editor shows a visible "uncalibrated" badge on the node when the configured backend reports `calibrated: false` (e.g. the `llm` fallback), and the run view shows the confidence next to the taken edge; (4) below threshold, the answer goes to the `uncertain` port, which the author can wire to an Approval or Ask-user node. That "low confidence -> ask a human" wiring is the headline template. Noul has probability only, so for Noul the gate is the probability margin (`p >= t` or `p <= 1-t`), not a fabricated confidence.
- **Approval is not the agent's tool approval.** A tool approval *inside* an agent node (the agent's own gated tool) uses the existing durable pause for that agent run and shows as the Agent node `waiting`. An Approval *node* is workflow-level: a gate the author placed. They share the UI and the Cortex approvals list, not the mechanism. The walker stores the gate (`waitingOn`) in `NodeRun`, which is trivially durable; it does not need a kernel run to be paused.
- **Tool/MCP node vs Agent node.** Use a Tool node when the call is deterministic (fetch, post, write). Use an Agent node when the *how* needs judgment. The editor says so in one line. This keeps cheap steps cheap and is the "deterministic over LLM-driven" rule applied to workflows.

Deliberately not in v1: Code node, Set/Transform node (use edge `map`), HTTP node (use Tool/MCP or a `defineTool`), Wait/Delay node (add as `timer` in phase 3 if asked), Merge-by-key, Switch (Judge `choice` and chained Ifs cover it).

## 5. Typed edges and the expression language

**Typing.** Every node declares `inputSchema` and `outputSchema` (JSON Schema; Agent defaults from the saved agent, Tool from the tool definition, Judge/Approval/Ask/Deliver are fixed by type). On save the validator checks each edge: the source output schema, projected through the edge `map`, must be assignable to the target input schema. Failures are editor errors with the offending pointer, not runtime surprises. At runtime the output of every node is validated once more before it is handed on (a node cannot poison downstream). Assignability is deliberately simple: required keys present, primitive types equal, enums subset. Anything the checker cannot decide is a *warning*, and the runtime check is the authority.

**Expression language: nothing but JSON Pointer plus templates.**
- Reads: RFC 6901 JSON Pointer rooted at a fixed context: `/input`, `/trigger`, `/nodes/<id>/output`, `/run/id`, `/loop/index`. Example: `/nodes/triage/output/priority`.
- Templates (task text, messages): `{{ /nodes/triage/output/summary }}` substitution only. No filters, no conditionals, no functions. Missing pointer renders as an editor error at save when statically knowable, else a typed `ExpressionError` at runtime (never an empty string).
- Predicates (If, Loop `until`): the fixed `{path, op, value}` form with `all`/`any`/`not`. No string-eval anywhere.
- Escape hatch for anything else: put it in an **Agent node** (reasoning) or a **Tool node** over a `defineTool` (code, owned, sandboxed, versioned in the repo). Explicitly *not* a code node: the cheapest place to start permissive is the most expensive place to retreat from.

## 6. Execution semantics

**Single rule: the store is the truth, the walker is a pure reducer over it.** A step is: read ready nodes (all in-edges satisfied) -> mark `running` -> execute -> write `NodeRun` + output in one transaction -> recompute. No in-memory state is load-bearing. This gives durability, resume, and test determinism (a scripted test provider drives agent nodes; a fake clock drives time).

- **Durability and resume after restart.** On boot, the walker scans `workflow_runs` where `status in (running, waiting)`. A `NodeRun` found `running` is re-executed per its node type: Agent -> `resumeRun(agentRunId)` from the kernel checkpoint (existing durable path, tool-effect ledger prevents repeating a completed side effect); Judge/If/Tool -> re-execute (idempotency below); Deliver -> re-send only if no receipt row (see idempotency); `waiting` nodes stay waiting (gate records are in the store).
- **Retries and backoff.** Per node, `RetryPolicy`, applied only when `error.retryable` (provider 429/5xx, `network`, `rate_limited` honoring `retryAfterMs`). Non-retryable (schema invalid, auth, guardrail deny, budget stop) never retries. Each attempt is a `NodeRun` row with `attempt`. Default: no retries (explicit over magic); templates set sensible ones.
- **Timeouts.** Node `timeoutMs` wraps execution (compose `timeoutAfter` for Agent nodes; Effect timeout for others). Workflow `limits.timeoutMs` cancels the run via `RunHandle` for in-flight agents, then marks `failed` with `reason: timeout`. Approval/Ask waits have their own `timeoutMs` and `onTimeout`.
- **Budgets and killswitches.** `limits.maxCostUsd` is enforced by the walker summing `NodeRun` costs (from the agent run's cost) *and* passed down as each Agent node's `budgetLimit` = remaining budget, so an agent cannot overshoot the workflow cap by itself. `maxNodeRuns` bounds loops and fan-out. `requireApprovalFor` and `watchdog` stay agent-level config. Budget stop yields `status: budget-stopped` and an honest reason; never a silent partial success.
- **Concurrency.** Per workflow `concurrency: { runs: 1..N, policy: skip | queue | parallel }` (default `skip` for Cron: matches the chat-schedule `skipped:busy` precedent, but *recorded* as a skipped fire, not dropped silently, fixing the audit's G3 class). Within a run, ready nodes execute in parallel up to `maxParallelNodes` (default 4); global agent concurrency is bounded by one Effect `Semaphore` so a local machine with one Ollama model does not melt. The Parallel node is a fan-out marker, not a thread.
- **Idempotency.** Three layers. (1) *Trigger*: runs are keyed `(workflowId, trigger.idempotencyKey)`: cron = `scheduleId@firedAtMinute`, webhook = delivery id or body hash, channel = platform message id. A duplicate key returns the existing run. (2) *Node*: `(runId, nodeId, iteration)` is unique; re-execution after crash overwrites, never duplicates. (3) *Side effects*: Deliver and Tool nodes get a deterministic `effectKey = runId:nodeId:iteration`; Deliver writes a `delivery_receipts` row keyed by it and checks first; Tool nodes marked `sideEffect: true` go through the durable tool-effect ledger. If a crash happened between "sent" and "recorded", the honest outcome is **at-least-once with a flag**: the receipt is re-sent only if the adapter reports it supports idempotency keys or the user set `onReplay: resend`; otherwise the node goes `waiting` as "delivery unknown, confirm" (an Approval-style gate). We state this limit rather than claim exactly-once.
- **Approvals while a workflow waits.** The Approval/Ask node sets `NodeRun.status = waiting` + `waitingOn`, the run goes `waiting`, nothing holds a process, fiber, or lease. The walker releases the run. When the answer arrives (Cortex UI, API, a channel reply routed to the gate id), the answer is written to the gate record and the walker is nudged to continue; if the process restarted in between, boot scan picks it up. The request is *delivered* too: shown in Cortex Approvals, and optionally sent to the author's channel with the gate id so a "yes" reply resolves the right gate (not "the oldest", cf. the `gateId` targeting in `HumanGateAnswer`).
- **Cancellation.** `cancel(runId)`: mark `cancelled`, `RunHandle` stop on in-flight agent nodes, abandon open gates (`abandoned: stop`), no further nodes start.
- **Error propagation.** A failed node with `onError: fail` fails the run and cancels siblings; `continue` marks the node failed and routes nothing (downstream sees "skipped"); `route` emits on `error`. A run is `succeeded` only if every terminal node reached `succeeded` or `skipped` by design; never because "nothing threw".
- **Events.** New additive core events (core-warden): `WorkflowRunStarted`, `WorkflowNodeStarted`, `WorkflowNodeFinished` (status, attempt, agentRunId, judgment summary), `WorkflowRunFinished`, `WorkflowGateOpened/Resolved`. Cortex ingests them the same way it ingests agent events; the walker emits nothing else. Decisions must replay: the Judge node's raw answer and the chosen port are in `NodeRun`.

## 7. Cortex UX

**Editor (canvas).** New top-level "Workflows" route next to Lab. Left: node palette (the v1 catalogue). Centre: canvas (pannable/zoomable, edges are typed ports; invalid edges refuse to connect and say why). Right: inspector for the selected node: config form, input/output schema, and for Agent nodes a compact "this saved agent" card linking to its Lab page (the agent is edited in Lab, not inline; one home per concern). Bottom drawer: validation problems, then test results. Auto-save drafts; "Publish" bumps `revision` and (re)registers triggers. A Judge node shows its backend, `calibrated` badge and `minConfidence`. Library choice (Svelte Flow vs hand-rolled SVG) is for the cortex-warden; the data model does not care.

**Run view.** A run page reusing the existing run view shell: the workflow graph on top with node states (pending/running/waiting/succeeded/failed/skipped), the taken edges highlighted with the judgment confidence label; selecting a node opens its `NodeRun` (input, output, attempts, error). For Agent nodes the panel embeds the **existing agent run view** by `agentRunId` (full trace, tools, tokens, context): this is the "full trace of what each agent did" promise and costs almost nothing because it is a link, not a new viewer. Totals: cost, tokens, duration. Waiting runs show the open gate inline with approve/deny/answer controls.

**Templates.** Shipped as `WorkflowFile` JSON in the Cortex package (same format as export, so templates are tested by import). Five, chosen to exercise the differentiators: (1) Morning brief (cron -> researcher agent -> summarize -> deliver); (2) Triage inbox (channel message -> classify Judge(choice) -> route to agents; uncertain -> Ask user); (3) Guarded action (agent drafts -> Judge(noul) "safe to send?" -> uncertain/false -> Approval -> deliver); (4) Fan-out research (parallel agents -> join -> synthesize); (5) Monitor with change detection (cron -> Tool fetch -> If changed -> agent -> deliver).

**Test a node in isolation.** Every node has "Test": pick or paste sample input (validated against its `inputSchema`; "use last run's input" pulls from history), run only that node through the same executor, show output, cost, and (Agent) a link to the run. A tested Agent node runs the real agent (real cost, labelled); Deliver nodes in test mode go to a `dry-run` adapter that returns a fake receipt unless the user ticks "really send". Pinning sample data to a node is stored in the draft (n8n's most-loved feature, cheap here).

**`/workflows` slash command (Cortex chat).** Extends `ChatSlashMenu.svelte` / the chat store; handled **server-side** by a deterministic route (no LLM) so it works with any model:
- `/workflows` or `/workflows list`: inline card listing saved workflows (name, triggers, last run status, next fire).
- `/workflows run <name> key=value ...`: values parsed against the workflow's `inputs` schema (strings coerced by declared type; a missing required input answers with a small inline form, not an error). Starts a Manual run and renders a **live status card** in the transcript (node chips updating over the existing WS, waiting gates actionable in-card). Returns the `runId`.
- `/workflows status [name|runId]`: running and waiting runs (the same card).
- `/workflows open <name|runId>`: navigates to the editor or run view.
- Name resolution is by unique prefix; ambiguity lists candidates. Start requires the same permission as the UI (single-user v1).

**`run_workflow` agent tool.** A built-in tool registered for agents that opt in (Lab toggle "Can run workflows" with an allow-list of workflow ids; default none). Signature: `run_workflow({ workflow: string, inputs: object, wait?: boolean = true, timeoutMs? })`. Behaviour: validates `inputs` against the workflow's schema (the tool's own JSON Schema is generated per allowed workflow, like `withAgentTool` parameters), starts a run, and with `wait` returns the final output or a typed `{status: "waiting", gate}`; without it returns `{runId}`. Guards: depth limit (agent -> workflow -> agent chain counted via run context, max 3), the caller's remaining budget is the child's cap, triggers recursion check (a workflow whose agent can run the same workflow is refused at save), and an event ties the child run to the caller's `runId` for the trace. The tool depends on a `RunWorkflow` service tag in runtime/core (implemented by `@reactive-agents/workflow`), absent = tool not registered. That is the entire coupling.

**Notifications.** Reuse Cortex's existing toasts/inbox for: run failed, budget-stopped, waiting for approval/answer, schedule paused due to repeated failures. Plus optional per-workflow "notify channel" delivering via the Deliver path. No new notification system.

## 8. Local-first storage and seams for hosted multi-user

v1: one local SQLite (the Cortex DB), `WorkflowStore` Effect service, files exportable. The following are **seams, not features**, each costing a field or an interface now and nothing else:

| Later need | Seam built now | Not built |
|---|---|---|
| Identity | every row carries `ownerId` (always `"local"`); the walker and API take an `Actor { id, workspaceId }` from a `CurrentActor` Context.Tag, default `LocalActor` | users, login, sessions |
| Workspaces | `workspaceId` column on workflows/runs/triggers (default `"default"`); all `WorkflowStore` queries are parameterized by it | workspace admin, sharing, RBAC |
| Secrets | `SecretRef {name}` resolved only through a `SecretResolver` service (v1: Cortex's provider key store + env); secrets never enter `WorkflowFile`, `NodeRun`, events or logs (`Redacted`) | encrypted vault, per-workspace KMS |
| Metering | `WorkflowRun` and `NodeRun` already carry `costUsd`, `tokens`, `durationMs`; the `Workflow*` events carry them; a `UsageSink` Context.Tag with a no-op default | billing, quotas, plans |
| Audit log | all state changes are events (`WorkflowRunStarted`, gate resolved with `decidedBy`, publish with `actor`); the event stream is append-only | tamper-evident store, export UI |
| Store swap | `WorkflowStore` and `ScheduleRegistry` are interfaces; SQLite is one layer | Postgres layer |
| Stateless workers | the walker is a reducer over the store, holds no lease today; a `claim(runId, workerId, ttl)` method exists on the store interface (single-process implementation always succeeds) | distributed workers, queue |
| Tenant isolation of execution | all agent nodes already run through `buildCortexAgent` from saved config, so sandbox/shell policy (section 9) is configuration | per-tenant sandboxes |

Rule: if a later feature needs a column we did not add, adding it is an additive migration. We refuse to add UI, tables, or tests for any row of the right-hand column in v1.

## 9. Security

- **Untrusted inbound triggers are the main risk.** Webhook: HMAC signature mandatory (a secretless config is a save-time error, never fail-open; audit WebhookChannelAdapter finding), timestamp/nonce replay window, body size cap, rate limit via `PolicyEngine`, and the payload reaches the workflow only as *data* in `/trigger`; it is never concatenated into a system prompt. Channel: sender allow-list required (empty = trigger cannot be enabled; audit G8 fail-open on empty sender must be fixed first), namespaced sender keys `platform:userId`, echo suppression by platform ids.
- **Prompt injection from payloads.** Agent node `task` templates place trigger/tool text inside a clearly delimited "untrusted input" block; nodes that consume untrusted input default to a **reduced tool set** (the editor flags "this agent reads untrusted input and has shell/write tools" as a warning on publish). We do not claim to prevent injection; we bound the blast radius (budget, tool allow-list, approval node before side effects) and say so in docs.
- **Per-node permissions.** An Agent node can *narrow* the saved agent's tools (allow-list) but never widen them. Tool nodes carry an explicit tool name; the walker runs them through `GuardrailService` like any other call. A workflow-level `permissions` block (`network`, `shell`, `fileWrite`, `adapters[]`) is checked at publish against what the nodes need and shown for confirmation; importing a file never grants anything silently (imported files start `disabled` with triggers off and the permission diff shown).
- **Secrets.** References only (section 8). Redacted in traces, events, exports. Webhook secrets and channel credentials come from the same resolver. Export lists "needs secrets: X, Y".
- **Sandboxed code/shell.** v1 has no code node. Shell exists only through an agent whose config has `terminal: true` (the existing opt-in `shell-execute` sandbox); a workflow neither enables nor bypasses it. A workflow that can run shell triggered by an internet-facing webhook requires an Approval node on that path or an explicit `acknowledgedRisk` flag, enforced by the publish validator.
- **Local binding.** The Cortex server stays bound to localhost by default (`listen-host.ts` already controls this); webhook ingress is a separate, opt-in listener with its own port and auth, never the Cortex API port. Self-host exposure is the deploy audit's D3 (authenticated by default).
- **Loops and fan-out as DoS.** `maxNodeRuns`, loop hard cap, depth limits, cost caps, the Cron `skip` default.
- **Audit trail.** Each run stores trigger payload (size-capped, redactable) and decisions, so an incident is replayable via events + `rax-diagnose` on the agent runs.

## 10. Phased delivery, warden ownership, and the first slice

Principles: framework prerequisites first (they fix real bugs regardless of workflows), one concern per commit, each phase has a measurable acceptance. New warden roles are not created; the walker and schema are owned by the runtime-warden unless the owner approves the new `@reactive-agents/workflow` package, in which case `tools/repo/ownership.json` assigns it to runtime-warden (prefer widening an existing warden, per the AGENTS.md anti-pattern).

### Phase 0: prerequisites (already on the audit's ranked list; workflows consume them)
| Slice | Owner | Done when |
|---|---|---|
| `ScheduleRegistry`: durable ids, `lastRun`, `lastResult`, pause, `runNow`, missed-fire catch-up policy (audit #8, G4) | gateway-warden (+ runtime-warden for run dispatch) | restart test: a schedule due during downtime fires once per policy; a clock-advancing test covers windows (G1) |
| Canonical `ChannelAdapter` + conformance suite; typed `DeliveryReceipt` / `ChannelError` (audit #5, #6) | gateway-warden (+ core-warden for `ChannelDeliveryFailed` / adapter fields) | webhook adapter passes the suite; send failure is typed, never swallowed |
| Bounded inbound queue instead of drop (G2/G3) | runtime-warden | overlapping cron + message both run, in order |
| Webhook ingress mounted with HMAC + replay window (audit #9, G6) | gateway-warden | unsigned request is rejected in a test over a real socket |

### Phase 1: the first slice, proves the idea end to end
**Pipeline:** Cron trigger -> Agent node (saved agent, output schema) -> Judge node (Choice or Noul, confidence-gated) -> Approval node (on `uncertain` or `false`) -> Deliver to channel (webhook adapter first; Signal/Telegram when their adapters pass conformance). Headless first, one UI page last.

| Step | Owner | Content |
|---|---|---|
| 1.1 Schema + validator + file import/export | runtime-warden (core-warden for any shared id/contract type, additive) | section 3 types; edge type-check; golden JSON fixtures; unknown version refused |
| 1.2 `WorkflowStore` (SQLite) + walker for Cron/Manual, Agent, Judge, If, Approval, Deliver | runtime-warden | reducer over the store; scripted test provider; fake clock |
| 1.3 Events `Workflow*` | core-warden | additive union members, modality-neutral, documented |
| 1.4 Cortex server: CRUD, publish, run, cancel, gate answer, WS events; reuse `buildCortexAgent` and the desk runner | cortex-warden | agent runs appear in `cortex_runs`, linked by `agentRunId` |
| 1.5 Minimal UI: list page, form-based node list editor (canvas can wait one step), run view with graph + per-node panel + inline gate | cortex-warden | click an Agent node, see its full run view |
| 1.6 Judge consumer details: calibrated badge, thresholds, `uncertain` port | eval-warden (judgment consumers, review of defaults against rubric precedent) | table of threshold behaviour pinned in tests |
| 1.7 Measurement | harness-warden | see below |

**Acceptance tests for Phase 1 (all zero-token via scripted providers unless marked):**
1. *Happy path.* Scripted cron fires at T; Agent node returns `{category:"urgent", summary:"..."}` validated against its schema; Judge (scripted backend, `calibrated:true`, confidence 0.93 >= 0.6) takes port `urgent`; Deliver sends and a `DeliveryReceipt` row exists; run `succeeded`; `NodeRun.agentRunId` resolves to a `cortex_runs` row.
2. *Schema violation.* Agent returns invalid output after repair -> node `failed` with `error.kind = "output-schema"`, downstream nodes `skipped`, run `failed`; no Deliver call.
3. *Low confidence routes to a human.* Judge confidence 0.4 -> `uncertain` port -> Approval node `waiting`; run status `waiting`; no process state held (test restarts the walker with a fresh layer on the same SQLite file).
4. *Resume after restart while waiting.* After the restart in (3), answering the gate (approve) continues the run and Deliver happens exactly once; deny ends the run `succeeded` with the denied port taken, nothing delivered.
5. *Crash mid-agent.* Kill the walker with an Agent node `running` (durable checkpoint present); on boot the node resumes via `resumeRun`, the side-effecting tool in the scripted agent ran once (tool-effect ledger), run completes.
6. *Crash between send and receipt.* Fake adapter without idempotency support -> node ends `waiting` "delivery unknown", never a silent duplicate send.
7. *Uncalibrated backend.* Judge backend reporting `calibrated:false` uses the 0.8 default threshold, and the `NodeRun.judgment.calibrated` field is false and rendered as a badge (UI test asserts the badge).
8. *Idempotent trigger.* Same cron minute delivered twice (duplicate tick) -> one run. Same webhook delivery id twice -> one run.
9. *Budget.* `limits.maxCostUsd` below the agent node's scripted cost -> `budget-stopped`, agent received the remaining budget as its cap, reason recorded.
10. *Round trip.* Export -> import into a fresh DB -> identical run behavior; secrets absent from the file.
11. *Events.* The full run is reconstructable from `Workflow*` events plus `NodeRun`s (replay-style assertion).
12. *(Live, one model, harness-warden, not CI.)* The same pipeline with a real local model: report success rate, cost, and judgment-vs-agent agreement over n>=10 per the Bernoulli rule (claims below ~26pp gaps are noise); this validates plumbing and the Judge default thresholds, not model quality.

### Phase 2: breadth
Parallel/Join, Loop, Tool/MCP, Ask-user, Sub-workflow nodes; Channel-message trigger (needs a native adapter passing conformance); canvas editor with typed ports and edge validation; node test with pinned sample data; templates; Cortex Approvals unified list. Owners: runtime-warden (nodes), gateway-warden (channel trigger), cortex-warden (canvas, templates, test-node).

### Phase 3: composition and chat
`/workflows` slash command and live status card (cortex-warden); `RunWorkflow` service + `run_workflow` tool with depth/budget guards (runtime-warden, core-warden for the context field; tools-warden reviews tool registration and guardrail placement); Lab toggle "Can run workflows"; notifications; `rax workflow run file.json` headless (runtime-warden / CLI).

### Phase 4: hardening and measurement
Webhook hardening review, permission diff on publish, import-disabled default, failure-injection suite, trace-completeness check by harness-warden (every node's run is reconstructable from stored data), docs (reference page + a recipe), changeset. ablation-warden only if a *default-on* harness mechanism is proposed (none is planned; workflows are opt-in features, not harness defaults).

### Cut line if capacity is short
Phase 1 steps 1.1-1.4 plus a read-only run view prove the idea. Cut in this order: canvas (use the form editor), templates, Loop, Sub-workflow, Channel trigger, `/workflows run` (keep `list`/`status`), notifications.

## 11. Open questions and risks (honest)

**Questions for the owner**
- Q1. New package `@reactive-agents/workflow` (headless-runnable, clean hosted path) versus a module inside `packages/runtime`? Recommendation: new package, owned by runtime-warden. It is a new-package decision, so it needs your approval.
- Q2. Is "workflows are saved in Cortex's SQLite and exported as files" enough for v1, or do you want workflows as files on disk (git-friendly, repo-style `workflows/*.json`) as the *primary* store? Files-first is more developer-friendly; DB-first is smoother for the UI and hosted path. Recommendation: DB primary, one-click export/import, revisit after use.
- Q3. Is Phase 0 (ScheduleRegistry, ChannelAdapter, webhook ingress) acceptable as a hard dependency of triggers and Deliver? Without it a workflow cron would sit on the audit's in-memory scheduler and the Deliver node would have no honest receipt. The alternative is a webhook-only Phase 1 (no cron, no channel delivery), which weakens the pitch.
- Q4. Judge backend default for Cortex: the calibrated TypeSafe `jev` backend needs a key; the `llm` fallback is uncalibrated. Do we ship the Judge node enabled on the fallback with the uncalibrated badge and a stricter default threshold (this spec), or require `jev`/`ollama` calibrated backends?
- Q5. Naming: "Workflows" vs "Flows" vs "Automations", and whether `/workflows` should also alias `/flows`.

**Risks**
- *Scope creep toward n8n.* n8n's value is 400 integrations; ours is agent depth plus judgment and trace. Resist integration breadth; MCP is the integration story. The cut line above is real.
- *The walker becomes a second engine.* Mitigation: it holds no agent loop, no retry framework beyond node-level policy, no scheduler; if a feature needs those, it goes into the owning framework piece (runtime/gateway/compose) first. Review the walker against this in the Phase 1 simplicity audit.
- *Exactly-once is not achievable* for side effects across crashes; we promise at-least-once with a visible "delivery unknown" state (test 6). Do not market stronger.
- *Judgment depends on an external calibrated model.* If Q4 lands on the fallback, "calibrated confidence branching" is only as good as an LLM's self-report; the badge and threshold are honesty mechanisms, not a fix. The claim in docs must say "calibrated when the backend is calibrated".
- *Schema-checked edges can over-promise.* The static checker is intentionally shallow; users will hit runtime schema failures. Mitigation: clear errors, and Agent-node repair is the existing `extract-object` path. Measure the schema-failure rate in the live run (test 12) before advertising typed workflows.
- *Triggers inherit the audit's bugs.* G1-G4, G6, G8 are open correctness issues; shipping triggers before they are fixed would put a flaky foundation under the headline feature. Phase 0 is not optional.
- *Resumed agent node cost.* `resumeRun` re-enters from a checkpoint; model state is not byte-identical, so a resumed node may produce a different (still schema-valid) output. Documented, and the Judge `NodeRun` stores its input so branch decisions are reviewable.
- *Cortex file-size/cast gates.* Cortex has frozen giants (see UI modernization spec); the editor must be new, small modules, not additions to `ChatPanel.svelte`. `repo place` before creating files.
- *Local resource contention.* Parallel agent nodes on a single local model serialize badly; the global agent semaphore default of 2 avoids melt but makes fan-out slower than users expect. Surface "queued" in node state.
- *Hermes parity trap.* Hermes bundles scheduler + gateway + skills + session search as one agent. Our `run_workflow`/`/workflows` and deliver-to-channel give the delivery half; session search is already a Cortex/memory concern and is intentionally not part of this spec.

**What to cut first if this proves too big:** the canvas (ship the form editor), sub-workflows, loops, the channel trigger, templates beyond two. Never cut: schema-validated outputs, durable node records, the calibrated/uncertain Judge routing, per-node trace links. Those are the product.
