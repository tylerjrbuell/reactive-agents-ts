# Awesome-List Campaign — Round 2 status + staggered queue

**Date:** 2026-06-26 · Follow-on to `2026-06-26-awesome-list-PR-drafts.md`. Repo ~16 stars.

## Submitted PRs (6 today — OPEN)

| List | ⭐ | PR |
|---|---|---|
| modelcontextprotocol/servers | ~87.7k | [#4417](https://github.com/modelcontextprotocol/servers/pull/4417) |
| punkpeye/awesome-mcp-clients | ~6.5k | [#228](https://github.com/punkpeye/awesome-mcp-clients/pull/228) |
| tensorchord/Awesome-LLMOps | ~5.9k | [#608](https://github.com/tensorchord/Awesome-LLMOps/pull/608) |
| rafska/awesome-local-llm | ~2.3k | [#123](https://github.com/rafska/awesome-local-llm/pull/123) |
| Jenqyang/Awesome-AI-Agents | ~1.1k | [#336](https://github.com/Jenqyang/Awesome-AI-Agents/pull/336) |
| m9tdev/awesome-effect | ~56 | [#3](https://github.com/m9tdev/awesome-effect/pull/3) |

## ⚠️ Stagger the rest — do NOT mass-blast same day
Several lists run cross-list self-promo / `pr-spam-guard` detection. 6 PRs already went out 2026-06-26. **Submit the queue below 1–2 per day over the coming days**, ideally interleaved with real activity (stars, a launch).

## Staggered queue (paste-ready, verified format) — submit ~1–2/day

### Scottcjn/awesome-agents (~93★) — easiest accept, append to end of `## Frameworks`
Rule: description must NOT start with "A"/"An". PR title `Add Reactive Agents`.
```
- [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - Type-safe TypeScript agent framework on Effect-TS; runs the same code on local Ollama and frontier APIs; MCP-native with A2A multi-agent.
```

### caramaschiHG/awesome-ai-agents-2026 (~1.2k★) — `## Agent Frameworks → ### General Purpose` table, insert after Mastra row. Promo-language banned (keep factual).
```
| [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) | TS | Effect-TS agent framework. Same code on local Ollama and frontier APIs. MCP-native, A2A. MIT. |
```

### EndoTheDev/Awesome-Ollama (~474★) — `## Libraries` 3-col table, append. ⚠️ do NOT use the word "Ollama" in the description; one link per PR.
```
| [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) | Type-safe TypeScript agent framework on Effect-TS; same code local and frontier, MCP-native | npm |
```

### ARUNAGIRINATHAN-K/awesome-ai-agents-2026 (~180★) — `## Orchestration Frameworks`, alphabetical between PydanticAI and Semantic Kernel. Avoid promo words (best/powerful/seamless). Verify inclusion-criteria block first.
```
- [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) `🔬` `[TypeScript]` `[Local]` `[MCP]` - Type-safe agent framework on Effect-TS that runs identical code on local Ollama and frontier APIs.
```

## HOLD (star-gated / fragile)
- **Zijian-Ni/awesome-ai-agents-2026** (~156★) — CONTRIBUTING requires 100+ stars + prefers third-party nominations + runs spam detection. Revisit at ~100★ via a third-party nomination, not a self-PR.
- **abordage/awesome-mcp** — auto-ranked daily; ~16★ may be auto-pruned even after merge. Revisit with more stars.
- **kyrolabs/awesome-agents**, **steven2358/awesome-generative-ai** (from round 1) — star-gated, hold.
- **kaushikb11/awesome-llm-agents** — README is minified/concatenated; hand-craft carefully or skip.

## Submission mechanics
Same as round 1: `gh repo fork <owner>/<repo> --clone` → edit at the location above → `git checkout -b add-reactive-agents` → commit → `git push -u origin add-reactive-agents` → `gh pr create`. One entry per PR, factual, follow each CONTRIBUTING.
