# p-island-decision - research log

- 2026-10-06: Spike opened to decide the per-tick agent decision primitive for
  the island-survival demo. `probe.ts` compares stateless structured vs
  persistent session vs memory-backed structured on a local Ollama model.
  Ran `qwen3:4b` (3 ticks × 3 variants) + `nimble:latest` smoke. Finding:
  stateless structured + engine-owned memory wins; six framework gaps logged in
  `FINDINGS-p-island-decision.md`.
