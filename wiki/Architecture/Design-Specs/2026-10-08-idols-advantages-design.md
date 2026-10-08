---
type: design-spec
status: approved
created: 2026-10-08
tags: [island-sim, idols, advantages, tribal-council]
---

# Idols + Advantages Design (island-sim)

## Intent

Castaways search and find immunity idols (vote protection) and advantages
(survival/social/rescue edges). Holders choose hold, play, or gift based on
condition plus camp relationships. Full engine approach.

## 1. Data model

- New `IdolSchema`: `id, kind, scope (self | ally | group), holderId,
  foundAtTick, expiresAtTick, played`.
- Kinds: `immunity-idol` (full negate), `extra-vote`, `steal-protection`,
  `healing-herbs`, `supply-cache`, `storm-shelter`, `signal-boost`,
  `trust-charm`.
- Stored on `IslandGameplay.idols[]`. Cap per run: 3 idols + 4 advantages.
- Expiry Day 5 deterministic from seed. Lost on exile/death, drops as
  re-findable clue. Gift transfers `holderId`. Play marks `played`.

## 2. Discovery

- Two feeds, one seeded pool: active `inspect`/search at frontier or clue
  tiles (weight by seed + survival skill) plus seeded twists (`cache-found`,
  new `idol-whispers`) planting clue tiles.
- Emits `idol-found` with holder + kind. Kind hidden from others until
  played; holder sees full detail. Deterministic via seed + twistCount.

## 3. Council + strategy

- Before exile applies, engine honors played idols: full immunity negates
  all votes vs holder, next-highest exiled instead. Emits `idol-played` +
  `vote-negated`. `extra-vote` adds a ballot. `steal-protection` blocks next
  theft vs holder.
- Scripted brain per tick: play idol when nominationScore top-2 plus low
  trust or strained condition (hunger/thirst >= 7, injured/ill); else hold.
  Gift healing/social edges to lowest-trust ally when own condition safe.
  Group rescue/shelter auto-offered at camp. LLM maker receives same block.

## 4. Effects

- Self: `healing-herbs` cures ill/injured + 2 hunger; `supply-cache` +2
  food/water to holder or gifted ally; `storm-shelter` halves next storm
  energy hit.
- Social: `trust-charm` +0.3 trust both ways on next help/share;
  `steal-protection` blocks one theft.
- Group/rescue: `signal-boost` +1 rescue progress when fire lit;
  group cache feeds campCache.
- All deterministic, event-logged. Expired/unplayed idols burn at deadline.

## 5. UI + narration

- Cards: idol dot + count, kind hidden until played, holder tooltip full.
- Advantages panel: held/played/expired with gift/play buttons.
- Map: clue tiles ✦, finds flash.
- Journal: finds by name with kind hidden (`Sun found something glinting`),
  reveal on play (`Jack played the immunity idol, 4 votes negated`).

## 6. Testing

- Schema round-trip, seeded find determinism, council negate to next-highest,
  gift transfer, expiry burn, loss on exile, LLM prompt contains idol block.
- Full `bun test apps/examples/src/demos/island-sim`, strict tsc, script
  parse, reference seed 20261006 balance run.

## Files touched

- `world/schema.ts`, `engine/gameplay.ts`, `engine/events.ts`,
  `engine/tick.ts`, `decision/types.ts`, `decision/llm.ts`,
  `narrator/narrator.ts`, `ui/page.ts`, `index.ts`, `README.md`.
