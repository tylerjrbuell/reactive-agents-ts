---
"@reactive-agents/reasoning": patch
---

Three outcome fixes found by the deterministic shape zoo. (1) `actOrAnswer` (`true` and `"proactive"`) no longer forces another call of a required tool the model has honestly declined over after it only ever failed (2+ failed calls, no success): the abstention now stands instead of turning into repeated failing reads. (2) The always-on fabricated-measurement check no longer fails a run for a bare time projection ("100000 items takes 650 ms") when a tool printed timings and the answer makes no comparison claim; the answer ships with an advisory verification warning. Invented before/after or improvement claims, and runs with no timing evidence, still reject. This is default-path: runs ending `failed` on such a projection now end `done` with a warning. (3) `leanFinalTurn` (opt-in) waits until each prose-named read object ("read the first report and the second report") has a tool call, so a tool-less partial reply can no longer end the run.
