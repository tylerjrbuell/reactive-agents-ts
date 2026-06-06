// apps/advocate/src/grounding/types.ts
export type DraftGrade = {
  readonly pass: boolean;
  readonly issues: readonly string[];
  readonly deadLinks: readonly string[];
};
export type GradeDeps = { readonly fetchImpl: typeof fetch };
