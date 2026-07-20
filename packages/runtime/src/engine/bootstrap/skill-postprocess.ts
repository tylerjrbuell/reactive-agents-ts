/**
 * Bootstrap skill post-processing — runs after the BOOTSTRAP phase to:
 *   1. Apply a learned skill from procedural memory (matched by task category
 *      + model tag) — sets `appliedSkill*` keys on ctx.metadata for downstream
 *      record-outcome wiring.
 *   2. Apply skills from SkillResolver (Living Intelligence System) — populates
 *      ctx.metadata.resolvedSkills, autoActivateSkills, skillCatalogXml so the
 *      strategy can surface them via memoryContext / telemetry.
 *   3. Log bootstrap summary (semantic line count + episodic count + duration).
 *   4. Inject experience tips into ctx.metadata when enableExperienceLearning.
 *   5. Publish MemorySnapshot event for the Cortex UI.
 *
 * Lifted from execution-engine.ts post-W24-D-1 (~2253-LOC checkpoint).
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import { classifyTaskCategory as classifyTaskCategoryFn } from "@reactive-agents/reactive-intelligence";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { EbLike, ObsLike } from "../runtime-context.js";
import { extractTaskText } from "../util.js";

export interface SkillPostprocessArgs {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
  readonly bootstrapStartedAt: Date;
}

export const runBootstrapSkillPostprocess = (
  args: SkillPostprocessArgs,
): Effect.Effect<ExecutionContext, never> => {
  const { task, config, eb, obs, isNormal, bootstrapStartedAt } = args;
  return Effect.gen(function* () {
    let ctx = args.ctx;

    // ── Apply learned skills from procedural memory ──
    {
      const mc = ctx.memoryContext as {
        activeWorkflows?: readonly {
          tags?: readonly string[];
          pattern?: string;
          name?: string;
          id?: string;
          successRate?: number;
          useCount?: number;
        }[];
      } | undefined;
      if (mc?.activeWorkflows && mc.activeWorkflows.length > 0) {
        const taskCat = classifyTaskCategoryFn(String(task.input));
        const modelIdForSkill = String((config as { model?: string }).model ?? config.provider ?? "unknown");
        const matchingSkill = mc.activeWorkflows.find(
          (w) => w.tags?.includes(taskCat) && w.tags?.includes(modelIdForSkill),
        );

        if (matchingSkill?.pattern) {
          try {
            const fragment = JSON.parse(matchingSkill.pattern);
            if (obs) {
              yield* obs.info(`Applying learned skill: ${matchingSkill.name}`, {
                convergenceIteration: fragment.convergenceIteration,
                meanEntropy: fragment.meanComposite,
                strategy: fragment.reasoningConfig?.strategy,
                successRate: matchingSkill.successRate,
                useCount: matchingSkill.useCount,
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/bootstrap/skill-postprocess.ts:apply-learned-skill", tag: errorTag(err) })));
            }
            // Store skill reference on context metadata for downstream use
            ctx = { ...ctx, metadata: { ...ctx.metadata, appliedSkill: matchingSkill.name, appliedSkillId: matchingSkill.id, appliedSkillMeanEntropy: fragment.meanComposite } };
          } catch {
            // Invalid pattern — ignore
          }
        }
      }
    }

    // ── Apply skills from SkillResolver (Living Intelligence System) ──
    {
      const skillResolverOpt = yield* Effect.serviceOption(
        Context.GenericTag<{
          resolve: (params: { taskDescription: string; modelId: string; agentId: string }) => Effect.Effect<{ all: readonly any[]; autoActivate: readonly any[]; catalog: readonly any[] }, unknown>;
          generateCatalogXml: (skills: readonly any[], options?: { catalogOnlyHint?: boolean }) => string;
        }>("SkillResolverService"),
      ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

      if (skillResolverOpt._tag === "Some") {
        const resolver = skillResolverOpt.value;
        const resolved = yield* resolver.resolve({
          taskDescription: extractTaskText(task.input),
          modelId: String(ctx.selectedModel ?? config.defaultModel ?? "unknown"),
          agentId: config.agentId,
        }).pipe(Effect.catchAll(() => Effect.succeed({ all: [], autoActivate: [], catalog: [] })));

        if (resolved.all.length > 0) {
          const catalogXml = resolver.generateCatalogXml(resolved.catalog, {
            catalogOnlyHint: true,
          });
          // Store resolved skills + catalog XML for strategy (memoryContext) and telemetry
          ctx = {
            ...ctx,
            metadata: {
              ...ctx.metadata,
              resolvedSkills: resolved.all,
              autoActivateSkills: resolved.autoActivate,
              skillCatalogXml: catalogXml,
            },
          };

          if (obs) {
            yield* obs.info(`Skills resolved: ${resolved.all.length} total, ${resolved.autoActivate.length} auto-activate`).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/bootstrap/skill-postprocess.ts:log-skills-resolved", tag: errorTag(err) })));
          }
        }
      }
    }

    // ── Log bootstrap summary ──
    if (obs && isNormal) {
      const bootstrapMs = Date.now() - bootstrapStartedAt.getTime();
      const mc = ctx.memoryContext as { semanticContext?: string; recentEpisodes?: readonly unknown[] } | undefined;
      // MemoryBootstrapResult fields: semanticContext (string) + recentEpisodes (array)
      const semanticLines = mc?.semanticContext
        ?.split("\n").filter((l: string) => l.trim()).length ?? 0;
      const episodicCount = (mc?.recentEpisodes as unknown[] | undefined)?.length ?? 0;
      const memInfo = `${semanticLines} semantic lines, ${episodicCount} episodic`;
      yield* obs.info(`◉ [bootstrap]  ${memInfo} | ${bootstrapMs}ms`)
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/bootstrap/skill-postprocess.ts:log-bootstrap-summary", tag: errorTag(err) })));
    }

    // ── Experience tip injection (optional) ──
    if (config.enableExperienceLearning) {
      const expOpt = yield* Effect.serviceOption(
        Context.GenericTag<{
          query: (desc: string, type: string, tier: string) => Effect.Effect<{ tips: readonly string[] }>;
        }>("ExperienceStore"),
      ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

      if (expOpt._tag === "Some") {
        const taskText = extractTaskText(task.input);
        const tips = yield* expOpt.value
          .query(taskText, task.type ?? "general", config.contextProfile?.tier ?? "mid")
          .pipe(Effect.catchAll(() => Effect.succeed({ tips: [] as readonly string[] })));

        if (tips.tips.length > 0) {
          ctx = { ...ctx, metadata: { ...ctx.metadata, experienceTips: tips.tips } };
          if (obs && isNormal) {
            yield* obs.info(`◉ [experience]  ${tips.tips.length} tip(s) from prior runs`)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/bootstrap/skill-postprocess.ts:log-experience-tips", tag: errorTag(err) })));
          }
        }
      }
    }

    // ── Publish MemorySnapshot so Cortex UI can display memory state ──
    if (eb) {
      const mc = ctx.memoryContext as {
        workingMemory?: Array<{ id?: string; content?: string }>;
        recentEpisodes?: unknown[];
        semanticContext?: string;
      } | undefined;
      const resolvedSkills = (ctx.metadata?.resolvedSkills as Array<{ name?: string; id?: string }> | undefined) ?? [];
      const working = (mc?.workingMemory ?? []).map((item) => ({
        key: item.id ?? "item",
        preview: typeof item.content === "string"
          ? item.content.slice(0, 120)
          : String(item.content ?? ""),
      }));
      const semanticLines = (mc?.semanticContext ?? "")
        .split("\n").filter((l: string) => l.trim()).length;
      yield* eb.publish({
        _tag: "MemorySnapshot" as const,
        taskId: task.id,
        iteration: 0,
        working,
        episodicCount: (mc?.recentEpisodes ?? []).length,
        semanticCount: semanticLines,
        skillsActive: resolvedSkills
          .map((s) => s?.name ?? s?.id ?? "")
          .filter(Boolean),
      } as Parameters<typeof eb.publish>[0]).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/bootstrap/skill-postprocess.ts:emit-memory-snapshot", tag: errorTag(err) })));
    }

    return ctx;
  });
};
