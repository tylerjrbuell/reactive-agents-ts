# Island Survival Simulation

A watchable, offline-first island-survival story. A deterministic engine owns the world, needs, actions, social trust, alliances, objectives, exile, and daily twists. Survivor portraits, the island map, camp dashboard, and event rail update incrementally as the simulation runs.

## Run

```bash
bun run apps/examples/src/demos/island-sim/index.ts
```

Open `http://localhost:3007` (or the port set with `PORT`). The demo uses scripted survivor decisions and tries Ollama for a compact world blueprint (`gemma4:e4b` by default) when available. Deterministic fallback islands are seeded 7x7 to 9x9 with lush, balanced, or rocky character, seeded resource spreads and starting weather, and a rotating secret set — every seed plays differently, while every island keeps an outer ocean ring, a freshwater camp with a grass spawn ring, nearby food plus water, and the poisoned-spring plus buried-cache secrets. World generation falls back to a deterministic island if provider setup or generation fails.

Set `ISLAND_SIM_MODEL` to choose a different Ollama model, and `OLLAMA_BASE_URL` (default `http://localhost:11434`) when Ollama lives elsewhere. Survivor decisions remain deterministic and engine-owned by default.

Two framework-native opt-ins (mutually exclusive; judgment wins when both are set):

- `ISLAND_SIM_LLM_DECISIONS=1` builds a structured-output survivor agent (higher latency/expense); any provider failure degrades that decision to the scripted maker, so the tick loop never stalls.
- `ISLAND_SIM_JUDGMENT=1` routes each survivor choice through a `.withJudgment()` agent and the `makeJudgmentDecisionMaker` adapter (model-chosen names resolve to engine ids, so realtime judgments land as legal moves). Backend is Jev when `TYPESAFE_API_KEY` is set, else explicit Ollama (`OLLAMA_BASE_URL`, default `http://localhost:11434`; a scoring-capable local model works best, and any backend failure degrades that tick to the scripted maker). One camp-batched judge call per tick (16 questions, ~2KB state; measured 7.7x faster than per-agent calls against a serial backend). Expect chaotic, divergent runs.
- A second ReactiveAgents agent writes the day-by-day "🎙️ Narrator's journal" (`GET /api/chronicle`): reality-TV day recaps plus one confessional quote per day. When Ollama is unreachable a deterministic template narrator fills the same shape, so the chronicle always renders.

## Simulation systems

- Castaways have distinct roles, personal objectives, and a shared rescue objective. Completed actions update objective progress and produce story milestones.
- Scarcity: berries, water, and fish regrow slowly (3/day), and wood/stone are finite (regrowth 0) — long games force longer treks. Storm days salt the land and suppress regrowth. Hunting in forest or grass (or from a crafted wood snare, which guarantees a double yield) adds meat to the menu.
- Idle hours are purposeful rather than padding: castaways work the shared rescue project (gathering wood, recouping stashed wood from the camp cache, raising the signal fire), then scout the island, and only inspect as a last resort. Wood stored at camp is usable again, so the signal fire (and therefore rescue) is reachable.
- The seeded hidden facts are playable discoveries: pushing to the island frontier or scanning in place uncovers the buried cache (supplies) or the poisoned spring (drinking from that tainted water sickens the drinker). Clean water is preferred when both are in sight.
- Injuries and illness are real states: working through a storm while exhausted can injure a castaway, and tainted water causes illness; both are healed by resting, and the roster shows the condition.
- Night matters: after dark, tired castaways sleep instead of wandering.
- Tribal council: while at least three castaways live, the camp convenes at dusk every third day. Everyone nominates (distrust, prior betrayals, and hoarding under scarcity drive blame; alliance members shield each other), alliance members vote as a bloc, the plurality winner is exiled for 12 hours with a survival kit, and the exiled resents the voters while their allies lose trust in them (which can split the pact).
- Deaths name the real cause: thirst, starvation, exhaustion, tainted water (ill from the poisoned spring), or untreated wounds (injured), never a generic need failure. Cards and the dossier keep the 💀 cause-of-death line via the typed `demise` record.
- Repeated reciprocal trust forms persistent alliances. Members share an exclusive private stash; the public camp cache and island resources remain open to outsiders. When death shrinks an alliance below two survivors it dissolves and its private stash spills into the public camp cache, with grief events for mourning.
- Under starvation pressure castaways can steal from neighbors; theft feeds the relationship-weighted exile-vote machinery. Exile lasts 12 in-world hours, reserves a survival kit, still lets hunger and thirst rise out on the cay, and ends with an automatic return.
- Roughly one seeded incident is scheduled each in-world day (24 ticks plus a small deterministic jitter): a washed-up cache, a distant rescue signal, or a storm front. Incidents are recoverable and replayable.
- Idols and advantages: inspecting a tile where whispers were left (✦ clue markers planted by twists) and washed-up twists feed one seeded pool (max 3 immunity idols + 4 advantages). Blind searching without a clue finds nothing. Immunity idols negate all council votes against the holder and exile the next-highest instead; softer edges help survival (healing herbs, supply cache, storm shelter), social play (extra vote, steal protection, trust charm), or the group (signal boost +1 rescue when the fire stands). Holders choose hold, play, or gift based on condition and camp trust; holdings burn at the start of Day 6 (tick 120) and are lost on exile or death. Finds stay sealed in the journal until played.
- Finale: once the rescue objective completes with a signal fire standing in non-storm weather, a boat arrives — the story ends with how many made it home. If everyone dies first, the run ends with an all-lost event, a memorial roll (name · day · cause) and an epilogue chapter in the journal.
- Narration accounts for the actual story: deaths are named with their cause, pacts, exiles, thefts, builds, twists, and rescues are all called out, and the confessional voice belongs to the day's most-affected survivor.
- Hunger, thirst, and fatigue create pressure with a warning track: needs at 9 raise a `needs-critical` alarm in the log, and death takes two consecutive ticks at 10, so one bad hour warns instead of kills. Activity increases fatigue, storms make exertion harder, and rest reduces fatigue.

## Controls and viewing

- **🔄 New island** generates a fresh world; **▶ Resume story**, **⏸ Pause**, and **⏭ Advance hour** control time. Pace selects ticks per second.
- The dashboard is a three-column grid (map, castaways + camp, story log) that stacks to two columns and then one on narrow screens.
- Survival bars show a visual fill plus the exact percentage; needs turn amber at 40% pressure and red at 70%. Survivor cards show their current objective and an alliance-colored dot.
- Resource and structure markers use unambiguous emoji glyphs (🫐 🐟 💧 🪵 🪨 🍖 ⛺ 🔥 🏕️ 🆘 🪤) with a labeled legend and tooltips naming kind, quantity, and tile.
- Alliances are visualized: colored dashed lines connect member markers on the map, member rings adopt the alliance color, and hovering an alliance row highlights only that alliance's link.
- Select or hover a castaway to preview their needs and follow their movement. Map stacks mark co-located survivors; activate `+N` to cycle selection.
- Movement and actions are animated between ticks: markers glide to new tiles, action glyphs (⛏️ 💧 💬 🤝 🏗️ 🆘 🌟 🌀) briefly pop above the acting castaway, and recent movement trails stay faintly visible; the focused survivor's trail is highlighted.
- The camp dashboard shows objectives, public supplies, alliances/private stash totals, exile countdowns, and the tribal council panel (countdown, last tally, exile watch). Search and filter the story rail by castaway and event type.
- The "🎙️ Narrator's journal" sits above the story log as a day timeline: a scrollable strip of mood-tinted day chips over a single comfortable reading pane (headline, recap, confessional). Click a day to read its chapter; the journal resets when you start a new island. The confessional voice is the day's most-affected living castaway (the island itself speaks when none live).
- Endings show a banner plus a modal that appears once: a rescue card listing who made it home, or an all-lost card with the memorial roll (name · day · cause), each offering "🔄 Start a new island" and "🔍 Review the island" (Esc also dismisses). The map itself reacts: a ⛵ sails in for a rescue, or the map dims with 💀 markers on every final resting tile. The finale text is computed server-side (`finaleView`) and shipped in `/api/state`, so the card can never disagree with the run's outcome.
- The map key documents every marker it draws: survivors, selection, alliance rings and links, exile and fallen marks, trails, groups, idol clues, all six resources, all five structures, weather, the rescue boat, resting places, and the full action-ping glyph set (gather, eat, drink, rest, talk, help, cache, build, discovery, hurt, illness, recovery, twist, goal, exile, idol find/play, trade, search, hunt, craft, theft, sabotage, gift, expiry, homecoming), plus the six terrain colours.
- The dashboard is built to fit one screen and to use the full width (a 10px gutter, no max-width cap): full-height shell with internal scrolling in the map, roster, journal, and story log. Below 640px of viewport height it falls back to ordinary page scrolling.

## Verification

```bash
bun test apps/examples/src/demos/island-sim --timeout 15000
bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types bun-types $(find apps/examples/src/demos/island-sim -name '*.ts' -print)
```
