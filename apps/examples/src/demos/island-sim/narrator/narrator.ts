import type { SimEvent } from "../engine/events.js";
import type { WorldState } from "../world/schema.js";
import { Schema } from "effect";

/** Structured output contract the LLM narrator must return each day. */
export const NarrationLogSchema = Schema.Struct({
  headline: Schema.String,
  recap: Schema.String,
  mood: Schema.optional(Schema.String),
  confessional: Schema.Struct({
    name: Schema.String,
    quote: Schema.String,
  }),
});
export type NarrationLog = typeof NarrationLogSchema.Type;

/** Shorthand for one narrated day: headline, recap paragraph, and one confessional voice. */
export type NarrationEntry = {
  day: number;
  headline: string;
  recap: string;
  confessional: { name: string; quote: string; mood: string };
  source: "template" | "llm";
};

export type NarrationInput = {
  world: WorldState;
  day: number;
  dayStartTick: number;
  dayEndTick: number;
  events: Array<{ sequence: number; event: SimEvent }>;
};

/** A narrator produces one entry per in-world day and retains the full chronicle. */
export type Narrator = {
  narrate(input: NarrationInput): Promise<NarrationEntry> | NarrationEntry;
  chronicle(): NarrationEntry[];
};

function tally(events: readonly SimEvent[]) {
  const counts = { moved: 0, gathered: 0, talked: 0, helped: 0, stolen: 0, died: 0, built: 0, twists: 0 };
  for (const event of events) {
    if (event.kind === "agent-moved") counts.moved += 1;
    else if (event.kind === "resource-gathered") counts.gathered += 1;
    else if (event.kind === "talked") counts.talked += 1;
    else if (event.kind === "shared" || event.kind === "helped") counts.helped += 1;
    else if (event.kind === "stolen" || event.kind === "sabotaged") counts.stolen += 1;
    else if (event.kind === "agent-died") counts.died += 1;
    else if (event.kind === "built") counts.built += 1;
    else if (event.kind === "island-twist") counts.twists += 1;
  }
  return counts;
}


function pickNarrators(world: WorldState, events: readonly SimEvent[]): string | undefined {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const id of [(event as { agentId?: string }).agentId, (event as { from?: string }).from]) {
      if (typeof id !== "string") continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const mostActive = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (mostActive) return world.agents.find((agent) => agent.id === mostActive)?.name ?? mostActive;
  return world.agents.find((agent) => agent.status !== "dead")?.name;
}

function headlineFor(counts: ReturnType<typeof tally>, alliances: number): string {
  if (counts.died > 0) return "The island takes one of us";
  if (counts.stolen > 0) return "Hands wander when the packs are light";
  if (alliances > 0) return "Shoreline pacts hold for another day";
  if (counts.gathered > 6) return "A provident day of gathering";
  return "Another drift of tides and hours";
}

function recapFor(counts: ReturnType<typeof tally>, alliances: number, weather: string, rescued: boolean): string {
  const bits = [
    `${counts.moved} treks across the ${weather} island, ${counts.gathered} bundles bound for camp, ${counts.talked} voices around the fire.`,
    counts.died > 0 ? `${counts.died} castaway${counts.died > 1 ? "s" : ""} did not last the day.` : "No one was lost today.",
    alliances > 0 ? `${alliances} pact${alliances > 1 ? "s" : ""} hold${alliances > 1 ? "" : "s"} sway.` : "No loyalty holds sway yet.",
    counts.twists > 0 ? "The island shifted under their feet." : "",
    rescued ? "Somewhere out there, a boat has seen the smoke." : "",
  ];
  return bits.filter(Boolean).join(" ");
}

/** Stand-in narrator with deterministic humane prose when no LLM provider is reachable. */
export function makeTemplateNarrator(): Narrator {  const chronicleEntries: NarrationEntry[] = [];
  return {
    narrate(input: NarrationInput): NarrationEntry {
      const events = input.events.filter((item) => item.event.tick >= input.dayStartTick && item.event.tick <= input.dayEndTick).map((item) => item.event);
      const counts = tally(events);
      const alliances = input.world.gameplay?.alliances.length ?? 0;
      const speaker = pickNarrators(input.world, events) ?? "the camp";
      const mood = counts.died > 0 ? "grieving" : counts.stolen > 0 ? "wary" : counts.built > 0 ? "hopeful" : "steady";
      const entry: NarrationEntry = {
        day: input.day,
        headline: headlineFor(counts, alliances),
        recap: recapFor(counts, alliances, input.world.weather.condition, input.world.gameplay?.rescueAtTick !== undefined),
        confessional: {
          name: speaker,
          mood,
          quote: mood === "grieving"
            ? "We buried another one today. The tide keeps taking more than it gives."
            : mood === "wary"
              ? "I keep my supplies closer than my friends these days."
              : mood === "hopeful"
                ? "That signal fire better be tall enough to be seen from the moon."
                : "One more day. That's all we do out here. One more day.",        },
        source: "template",
      };
      chronicleEntries.push(entry);
      return entry;
    },
    chronicle() {
      return [...chronicleEntries];
    },
  };
}

/**
 * Narrator backed by a ReactiveAgents structured-output agent. On any provider failure the
 * template narrator answers for that day, so the chronicle never stalls.
 */
export function makeLlmNarrator(agent: { run(input: string): Promise<{ object?: unknown; objectError?: string }> } | undefined, fallback: Narrator = makeTemplateNarrator()): Narrator {
  const chronicleEntries: NarrationEntry[] = [];
  if (!agent) {
    return { ...fallback, chronicle: () => [...(fallback.chronicle()), ...[]] };
  }
  return {
    async narrate(input: NarrationInput): Promise<NarrationEntry> {
      const events = input.events.filter((item) => item.event.tick >= input.dayStartTick && item.event.tick <= input.dayEndTick).map((item) => item.event);
      const counts = tally(events);
      const names = input.world.agents.map((agent) => agent.name).join(", ");
      try {
        const result = await agent.run(
          `Day ${input.day} on the island. Castaways: ${names}. Weather: ${input.world.weather.condition}. ` +
          `Activity: ${counts.moved} moves, ${counts.gathered} gathers, ${counts.talked} conversations, ${counts.helped} kindnesses, ` +
          `${counts.stolen} thefts, ${counts.built} builds, ${counts.died} deaths, ${counts.twists} surprises. ` +
          `Write a reality-TV style day log.`,
        );
        const object = result.objectError ? undefined : (result.object as Record<string, unknown> | undefined);
        if (object && typeof object.headline === "string" && typeof object.recap === "string") {
          const entry: NarrationEntry = {
            day: input.day,
            headline: object.headline,
            recap: object.recap,
            confessional: {
              name: typeof object.confessional === "object" && object.confessional !== null && typeof (object.confessional as Record<string, unknown>).name === "string" ? String((object.confessional as Record<string, unknown>).name) : pickNarrators(input.world, events) ?? "the camp",
              quote: typeof object.confessional === "object" && object.confessional !== null && typeof (object.confessional as Record<string, unknown>).quote === "string" ? String((object.confessional as Record<string, unknown>).quote) : "One more day out here.",
              mood: typeof (object as { mood?: unknown }).mood === "string" ? String((object as { mood?: unknown }).mood) : "steady",
            },
            source: "llm",
          };
          chronicleEntries.push(entry);
          return entry;
        }
      } catch {
        // fall through to the template narrator
      }
      return Promise.resolve(fallback.narrate(input));
    },
    chronicle() {
      return [...chronicleEntries, ...fallback.chronicle()];
    },
  };
}
