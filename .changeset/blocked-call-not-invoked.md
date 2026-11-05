---
"@reactive-agents/reasoning": patch
---

A tool call the harness blocked (for example a repeated identical call) no longer counts as "called" or "succeeded". Before, it could satisfy a required-tool check, count as a landed file write, or clear tool-call protocol strikes, even though the tool never ran. Every ledger reader that decides "was this tool called" now reads only results from calls that actually executed.
