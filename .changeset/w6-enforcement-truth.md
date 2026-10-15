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
