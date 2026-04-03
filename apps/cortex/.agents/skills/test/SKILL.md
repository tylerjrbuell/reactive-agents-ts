---
name: cortex-lab-test
description: Smoke-test skill for the Cortex desk. Use to verify Living skills paths (e.g. apps/cortex/.agents/skills) load via withSkills. No side effects.
---

# Cortex Lab test skill

Minimal **Living Intelligence** skill for validating that `withSkills({ paths })` resolves SKILL.md under this directory.

## Purpose

- Confirm the agent can **see** and **activate** this skill when `apps/cortex/.agents/skills` (or a parent path you configured) is listed under **Living skills**.
- Do **not** use for production behavior; content is intentionally trivial.

## When this skill applies

- User or harness is **debugging skill discovery** or **Cortex Lab → Skills → Add to Builder** wiring.

## Behavior

1. If asked whether skills loaded, answer **yes** and cite this skill’s name (`cortex-lab-test`).
2. Prefer **read-only** checks; do not delete data or call destructive tools as part of this skill.
3. Keep responses short unless the user asks for detail.
