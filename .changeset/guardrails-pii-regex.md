---
"@reactive-agents/guardrails": patch
---

PII detector precision and recall fixes:

- An undashed 9-digit number is flagged as an SSN only when SSN wording ("SSN", "social security number") is nearby. Order ids and counts no longer trip it. Dashed SSNs are still always flagged.
- A credit-card match must now pass the Luhn check, so arbitrary 16-digit ids are not flagged. Amex numbers (34/37, 4-6-5 grouping) are now detected.
- International phone numbers (`+44 20 7946 0958`) are now detected.
- UK postcodes whose outward code ends in a letter (`SW1A 1AA`, `EC1A 1BB`, `W1A 0AX`) are now detected.
