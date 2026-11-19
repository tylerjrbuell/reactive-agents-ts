---
"@reactive-agents/reasoning": patch
---

An honest decline is no longer rejected as "tool-viable" when the required tool already failed permanently (it was dropped from the effective missing list, so the exit gate saw nothing missing and lost the decline). The `exit_gate` decline check also reports a new `no-missing-required` value when no required tool is missing at all. A task that lists inputs as a range ("notes-1.txt through notes-6.txt") now yields every member, so the duplicate-call refusal names the first unread file instead of the range's last end.
