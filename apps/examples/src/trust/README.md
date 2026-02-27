# trust/

Cryptographic identity, behavioral guardrails, and hallucination verification.

| #   | File         | Shows                                                                    | Offline? |
| --- | ------------ | ------------------------------------------------------------------------ | -------- |
| 11  | identity     | Real Ed25519 certs, signature verification, RBAC, delegation, revocation | ✅       |
| 12  | guardrails   | Behavioral contracts (denied tools) + kill switch (pause/resume)         | ⚡       |
| 13  | verification | Semantic entropy + fact decomposition + multi-source fact-check          | ⚡       |

Example 11 is pure crypto — no LLM needed.

Run all: `ANTHROPIC_API_KEY=sk-ant-... bun run ../../index.ts --filter trust`
