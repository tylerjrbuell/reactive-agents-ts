# Harness Baseline — April 7, 2026

Captured before implementing `docs/superpowers/plans/2026-04-07-harness-context-pipeline.md`.

## Results

| Model              | Pass          | Iters/task | Tok/task | Duration | Explosions | Tools | Subagent | Convergence |
| ------------------ | ------------- | ---------- | -------- | -------- | ---------- | ----- | -------- | ----------- |
| gemma4:e4b (local) | 33/35 **94%** | 1.4        | 1,049    | 150.7s   | 1          | D 0/1 | C 1/2    | A+          |
| gemini-2.5-flash   | 33/35 **94%** | 1.4        | 1,049    | 150.7s   | 0          | D 0/1 | C 1/2    | A+          |
| cogito:14b (local) | 32/35 **91%** | 1.8        | 1,223    | 547.3s   | 1          | D 0/1 | C 1/2    | B           |
| gpt-4o-mini        | 32/35 **91%** | 2.5        | 1,173    | 251.8s   | 1          | D 0/1 | C 1/2    | A+          |

## Known bugs this baseline captures

1. **Tools D (0/1) — universal**: `recall` documented in system prompt but absent from FC schemas → all models fail "Recall tool usage"
2. **Subagents C (1/2) — Gemini+OpenAI**: Dynamic sub-agent = 0 iters/0 tok silent failure
3. **Iteration explosion — cogito:14b**: "no-tool task with tools enabled" = 10 iters, 9,069 tok
4. **Iteration explosion — gpt-4o-mini**: "Recall tool usage" = 38 iters, 17,695 tok; `readyToAnswer=true` ignored
5. **ICS context replacement**: After first tool call, `produce` phase drops all conversation history → local models loop

## Target after plan implementation

| Metric                  | Baseline  | Target                  |
| ----------------------- | --------- | ----------------------- |
| Tools pass rate         | 0/1 (0%)  | 1/1 (100%)              |
| Subagent pass rate      | 1/2 (50%) | 2/2 (100%)              |
| Max iteration explosion | 38 iters  | 0                       |
| cogito:14b pass rate    | 91%       | ≥94%                    |
| cogito:14b tok/task     | 1,223     | <900 (tier compression) |
| Convergence (cogito)    | B         | A+                      |
