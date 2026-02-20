import { Context, Effect, Layer, Ref } from "effect";
import type { PromptTemplate, CompiledPrompt } from "../types/template.js";
import { TemplateNotFoundError, VariableError } from "../errors/errors.js";
import { interpolate, estimateTokens } from "./template-engine.js";

export class PromptService extends Context.Tag("PromptService")<
  PromptService,
  {
    readonly register: (template: PromptTemplate) => Effect.Effect<void>;

    readonly compile: (
      templateId: string,
      variables: Record<string, unknown>,
      options?: { maxTokens?: number },
    ) => Effect.Effect<CompiledPrompt, TemplateNotFoundError | VariableError>;

    readonly compose: (
      prompts: readonly CompiledPrompt[],
      options?: { separator?: string; maxTokens?: number },
    ) => Effect.Effect<CompiledPrompt>;

    readonly getVersion: (
      templateId: string,
      version: number,
    ) => Effect.Effect<PromptTemplate, TemplateNotFoundError>;

    readonly getVersionHistory: (
      templateId: string,
    ) => Effect.Effect<readonly PromptTemplate[]>;
  }
>() {}

export const PromptServiceLive = Layer.effect(
  PromptService,
  Effect.gen(function* () {
    const templatesRef = yield* Ref.make<Map<string, PromptTemplate>>(new Map());
    const latestRef = yield* Ref.make<Map<string, number>>(new Map());

    return {
      register: (template) =>
        Effect.gen(function* () {
          const key = `${template.id}:${template.version}`;
          yield* Ref.update(templatesRef, (m) => {
            const n = new Map(m);
            n.set(key, template);
            return n;
          });
          yield* Ref.update(latestRef, (m) => {
            const n = new Map(m);
            const current = n.get(template.id) ?? 0;
            if (template.version > current) n.set(template.id, template.version);
            return n;
          });
        }),

      compile: (templateId, variables, options) =>
        Effect.gen(function* () {
          const latest = yield* Ref.get(latestRef);
          const version = latest.get(templateId);
          if (version == null) {
            return yield* Effect.fail(new TemplateNotFoundError({ templateId }));
          }

          const templates = yield* Ref.get(templatesRef);
          const template = templates.get(`${templateId}:${version}`)!;

          const content = yield* interpolate(template, variables);
          const tokenEst = estimateTokens(content);

          return {
            templateId,
            version,
            content:
              options?.maxTokens && tokenEst > options.maxTokens
                ? content.slice(0, options.maxTokens * 4)
                : content,
            tokenEstimate: Math.min(tokenEst, options?.maxTokens ?? tokenEst),
            variables,
          };
        }),

      compose: (prompts, options) =>
        Effect.succeed({
          templateId: "composed",
          version: 1,
          content: prompts.map((p) => p.content).join(options?.separator ?? "\n\n"),
          tokenEstimate: prompts.reduce((s, p) => s + p.tokenEstimate, 0),
          variables: {},
        }),

      getVersion: (templateId, version) =>
        Effect.gen(function* () {
          const templates = yield* Ref.get(templatesRef);
          const template = templates.get(`${templateId}:${version}`);
          if (!template) {
            return yield* Effect.fail(new TemplateNotFoundError({ templateId, version }));
          }
          return template;
        }),

      getVersionHistory: (templateId) =>
        Ref.get(templatesRef).pipe(
          Effect.map((m) =>
            Array.from(m.values())
              .filter((t) => t.id === templateId)
              .sort((a, b) => a.version - b.version),
          ),
        ),
    };
  }),
);
