# 2026-10-25 — Signal consumption edge shipped (root-cause closure of the signal gap)

Plan: wiki/Planning/Implementation-Plans/2026-10-25-signal-consumption-edge.md (status: EXECUTED).
Commits: 1023730e3 (schema) -> e6bef250a (ledger) -> 354a82d20 (emit/render/effect) -> fb84f7294 (tally) -> e12817b6a (normalize/RI/diagnose) -> d49ae89e8 (ratchet) -> 26305801a (docs) -> bedeaf288 (persistence fix).

What shipped:
- Trace schema: signal-rendered, signal-effect kinds; harness-signal-injected gains signalId/targetTool/targetPolicy; run-completed gains optional signals tally. Historical traces still load.
- Kernel: pure signal-ledger.ts + signal-effect.ts classifier; render stamps in think.ts; tally in run-finalize. RI projection gains signalStats; diagnose gains signal-gap-detector; probe crossCheck gains signal-unrendered bucket.
- End-to-end verified (run 01M5TD7GRGNS1HT6C90XQ4A2K3): signal-rendered (2), signal-effect (1, ignored), run-completed.signals tally {opened:1, rendered:1, ignored:1}. New blind-spot bucket signal-unrendered fired.

Carried / pending (P0-P5 + missing signals list) recorded in Hot.md section 2026-10-25 and Recommended-Enhancements.md.

---

# 2026-10-23 — Introspective harness improvement loop (bonsai-2:27b)

New probe mode shipped to harness-improvement-loop: agents interviewed outside the harness, self-reports cross-checked vs trace events. Six friction tasks ran; one fix shipped (ollama thinking off-switch, provider-warden — llm-provider 511/0); 11 scored items queued in Recommended-Enhancements.md §2026-10-23 (top: maxIterations tier-clamp theft, recovery-nudge wrong-tool advice, denials traced ok=true, terminal-gate blind spot, sandbox split-brain go/no-go). Evidence: wiki/Research/Harness-Reports/introspective-2026-10-24-02-*.
