---
"@reactive-agents/trace": patch
---

New trace event `eval-graded` carries a deterministic grader's verdict (score, passed, checks). `rax-diagnose cause` labels a run that ended cleanly but failed its grade as `wrong-answer`, naming the failed checks.
