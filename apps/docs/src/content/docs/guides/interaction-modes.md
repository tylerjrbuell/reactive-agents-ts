---
title: Interaction Modes
description: How agents adjust their autonomy level.
---

Reactive Agents supports 5 interaction modes that control how much autonomy an agent has.

## The 5 Modes

| Mode | Autonomy | Description |
|------|----------|-------------|
| **Autonomous** | Full | Agent acts independently |
| **Supervised** | High | Periodic checkpoints for review |
| **Collaborative** | Medium | Back-and-forth with the user |
| **Consultative** | Low | Asks before taking actions |
| **Interrogative** | Minimal | Gathers information only |

## Adaptive Mode Transitions

Agents automatically escalate and de-escalate between modes based on:

- **Confidence** — Low confidence triggers escalation
- **Cost** — High-cost operations trigger supervision
- **User Activity** — Active users trigger collaboration
- **Consecutive Approvals** — Repeated approvals trigger de-escalation

### Escalation Example

```
Agent in Autonomous mode
  -> Confidence drops below 0.3
  -> Escalates to Supervised mode
  -> User reviews and approves
  -> After 3 consecutive approvals with confidence >= 0.9
  -> De-escalates back to Autonomous
```

## Checkpoints

In supervised and collaborative modes, agents create checkpoints at key milestones:

```typescript
// Checkpoints are created automatically during execution
// and can be resolved with user feedback
```

## Collaboration Sessions

In collaborative mode, agents maintain structured conversation sessions with the user, tracking messages and question styles.

## Preference Learning

The interaction layer learns user preferences over time:
- Tracks approval patterns
- Builds auto-approve rules for common actions
- Adjusts interruption tolerance

After sufficient confidence (>= 0.7) and occurrences (>= 3), certain actions can be auto-approved.

## Enabling Interaction

```typescript
const agent = await ReactiveAgents.create()
  .withInteraction()  // Enable all 5 modes
  .build();
```
