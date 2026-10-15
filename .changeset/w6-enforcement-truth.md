---
"@reactive-agents/runtime": minor
---

Wave 6 enforcement truth (6.1 + 6.2): gateway `policies.requireApprovalFor`
unions into the kernel approval policy at build time (order-independent; the
field previously had zero consumers), and `GuardrailService.checkOutput`
screens the final answer at the engine post-arm (fail closed on violations
with an event; fail open with an event on service errors — never silent).
Per-tool-result scanning stays structural (trust quarantine) by explicit
decision recorded at the observation choke point.

6.3 additions: e2e builder→kernel proof per killswitch (trace terminal
carries the reason); `requireApprovalFor` reads normalized pending calls
(text + native) instead of native-only; before-act hooks fire on the
single-call path (previously batch-only, silently approving the common
reactive path). No verify-phase call site added deliberately: no killswitch
registers verify hooks, so it would be a dead seam.

6.4 additions: config-field census test (gateway policies both mirrors,
plan-execute fields, RunLedger kinds each name a non-test consumer or a
justified allowlist); the documented-but-never-declared `patchStrategy`
option deleted from the reasoning guide.
6.5 (behavioral): capability registry memory row now agrees with the
stateless-default builder behavior (`defaultOn: false`; GH #122 history kept
in the rationale). Bare builds stay stateless; `.withMemory()` /
`HarnessProfile.balanced()` / `.intelligent()` opt in explicitly.
6.6: no new `.withAutonomy()` wither — only 2 of 5 modes could map onto
existing machinery and even those would invent policy, so the package is
doc-scoped as direct service use (a fictional `.withInteraction()` example
and phantom README rows removed; enforced gates live in
`.withApprovalPolicy()` / `.withUserInteraction()`).
6.7: new `.withOpenInference()` composes the OpenInference tracer layer
(destination stays process-global via `setupOpenInferenceExporter()` /
`OTEL_EXPORTER_OTLP_ENDPOINT`); identity flagged direct-use (full
`AuditLogger` wiring deferred). Note: the 6.2 output screen and the 6.5
memory posture are opt-in-gated (`enableGuardrails`, `.withMemory()`) —
ships dark unless enabled, same as their input-phase counterparts.
