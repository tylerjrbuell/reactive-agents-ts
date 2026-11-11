---
"@reactive-agents/llm-provider": patch
---

Billing and quota failures now classify as their own fatal `quota` error class. Anthropic "Your credit balance is too low" (a 400), Gemini "Your prepayment credits are depleted" (a 402), OpenAI `insufficient_quota` (a 429) and OpenAI billing hard limits previously read as `invalid_param`, `unknown` or a non-retryable `rate_limit`. `recoveryFor("quota")` is `fatal`. A new exported guard, `isLLMErrorClass(s)`, narrows a string read off an error value to the closed `LLMErrorClass` set.

Calibration probes (probe version 3) can now tell models apart. Steering asks which channel wins when the system prompt and the user message conflict. Before, it returned "hybrid" whether every channel passed or none did. System-prompt attention scores every turn of a 10-turn conversation, so "moderate" can occur. The tool-result size probe sums two records among distractors on a ladder up to 8000 chars. Before, it stopped at 2000.
