/**
 * HarnessPipeline — Wave A infrastructure.
 *
 * Registry + resolver for harness transforms and taps. The pipeline is built
 * at agent construction time from the accumulated `.withHarness()` registrations,
 * then attached to the agent for use by kernel chokepoints (Wave B).
 *
 * Pass-through semantics (performance-critical):
 *   - No transforms registered for a tag → `transform()` returns defaultValue immediately,
 *     zero allocation (frozen empty-array sentinel).
 *   - Average case (1–3 transforms) → chains through in registration order.
 */
import type {
  Tag,
  TagPattern,
  Registration,
  TransformFn,
  TapFn,
  Phase,
  PhaseHookFn,
  ErrorHookFn,
  PayloadFor,
  ContextFor,
  TransformFor,
  TapFor,
} from "./harness-types.js";

// ── Internal ──────────────────────────────────────────────────────────────────

const EMPTY: readonly Registration[] = Object.freeze([]);

/** Specificity of a pattern — higher wins in sort order. */
function specificity(pattern: TagPattern): number {
  if (typeof pattern === 'function') return 2; // predicate: same tier as exact
  if (pattern === '**') return 0;
  if (pattern.endsWith('.**')) return 1;
  if (pattern.endsWith('.*')) return 2;
  return 3; // exact
}

/** Returns true if `pattern` matches `tag`. */
function matches(pattern: TagPattern, tag: Tag): boolean {
  if (typeof pattern === 'function') return pattern(tag);
  if (pattern === '**') return true;
  if (pattern === tag) return true;
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3); // strip '.**'
    return tag.startsWith(prefix + '.');
  }
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2); // strip '.*'
    // Must match exactly one more segment
    const rest = tag.slice(prefix.length + 1);
    return tag.startsWith(prefix + '.') && !rest.includes('.');
  }
  return false;
}

// ── HarnessPipeline ───────────────────────────────────────────────────────────

/**
 * Compiled registry of all harness registrations for an agent instance.
 * Built once at `.build()` time; immutable thereafter.
 */
export class HarnessPipeline {
  private readonly _registrations: Registration[];

  constructor(registrations: readonly Registration[] = EMPTY) {
    this._registrations = flattenRegistrations(registrations);
  }

  /**
   * Add registrations to the pipeline. Returns a new pipeline.
   * Used by the builder to accumulate multiple `.withHarness()` calls.
   */
  withRegistrations(registrations: readonly Registration[]): HarnessPipeline {
    return new HarnessPipeline([...this._registrations, ...flattenRegistrations(registrations)]);
  }

  /**
   * Resolve a tag emission through the transform pipeline.
   *
   * Resolution order:
   *   1. Collect all transforms where pattern matches `tag`, sorted broadest → most-specific,
   *      registration order within tier.
   *   2. Thread `current` through each: undefined → keep current; null → suppress flag;
   *      other → replace current.
   *   3. Run taps after final value is computed.
   *   4. Return final value (null if suppressed).
   *
   * "Most-specific wins" semantics: by running broadest patterns first and most-specific
   * last, the most-specific transform has the final say. An exact-tag transform always
   * overrides a wildcard transform when both return a concrete value.
   */
  async transform<T extends Tag>(
    tag: T,
    defaultValue: PayloadFor<T>,
    ctx: ContextFor<T>,
  ): Promise<PayloadFor<T> | null> {
    const transforms = this._collectTransforms(tag);

    // Pass-through fast path — zero allocation.
    if (transforms.length === 0) {
      await this._runTaps(tag, defaultValue, ctx);
      return defaultValue;
    }

    let current: PayloadFor<T> | null = defaultValue;
    let suppressed = false;

    for (const fn of transforms) {
      // When suppressed, subsequent transforms still see null as the default
      // so they can re-introduce content if they want.
      const input = suppressed ? null : current;
      // The registry stores TransformFn<Tag> (union) but at runtime the tag narrows
      // to T. The double-cast through unknown is intentional — callers registered
      // against the specific tag T so the runtime type is correct.
      const result = await (fn as unknown as TransformFn<T>)(input as PayloadFor<T>, ctx);
      if (result === null) {
        suppressed = true;
        current = null;
      } else if (result !== undefined) {
        current = result;
        suppressed = false;
      }
      // undefined → keep current unchanged, suppressed state unchanged
    }

    await this._runTaps(tag, current, ctx);
    return current;
  }

  /** Collect phase hooks of a given kind, in registration order. */
  collectPhaseHooks(
    kind: 'before' | 'after',
    phase: Phase,
  ): readonly PhaseHookFn<Phase>[] {
    return this._registrations
      .filter((r): r is Extract<Registration, { kind: 'before' | 'after' }> =>
        r.kind === kind && r.phase === phase,
      )
      .map((r) => r.fn);
  }

  /** Collect onError hooks matching a phase or '*'. */
  collectErrorHooks(
    phase: Phase | '*',
  ): readonly ErrorHookFn<Phase | '*'>[] {
    return this._registrations
      .filter((r): r is Extract<Registration, { kind: 'onError' }> =>
        r.kind === 'onError' && (r.phase === phase || r.phase === '*'),
      )
      .map((r) => r.fn);
  }

  /** All unique tags that have at least one transform or tap registered. */
  registeredTags(): readonly Tag[] {
    const tags = new Set<Tag>();
    for (const r of this._registrations) {
      if (r.kind === 'transform' || r.kind === 'tap') {
        // Resolve which concrete tags this pattern covers
        for (const tag of ALL_TAGS) {
          if (matches(r.pattern, tag)) tags.add(tag);
        }
      }
    }
    return [...tags];
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _collectTransforms(tag: Tag): readonly TransformFn<Tag>[] {
    const matching: Array<{ spec: number; order: number; fn: TransformFn<Tag> }> = [];
    let order = 0;
    for (const r of this._registrations) {
      if (r.kind === 'transform' && matches(r.pattern, tag)) {
        matching.push({ spec: specificity(r.pattern), order: order++, fn: r.fn });
      } else if (r.kind !== 'transform') {
        order++;
      }
    }
    // Sort: broadest first → most-specific last.
    // Most-specific pattern runs last and has the final say ("most-specific wins").
    // Within the same specificity tier, preserve registration order.
    matching.sort((a, b) => a.spec - b.spec || a.order - b.order);
    return matching.map((m) => m.fn);
  }

  private async _runTaps<T extends Tag>(
    tag: T,
    value: PayloadFor<T> | null,
    ctx: ContextFor<T>,
  ): Promise<void> {
    if (value === null) return;
    for (const r of this._registrations) {
      if (r.kind === 'tap' && matches(r.pattern, tag)) {
        await (r.fn as TapFn<T>)(value, ctx);
      }
    }
  }
}

// ── RegistrationHarness ───────────────────────────────────────────────────────

/**
 * Implements the `Harness` interface during the `.withHarness()` registration
 * phase. Collects registrations into a flat list; the pipeline compiles them at
 * `.build()` time.
 *
 * Wave A subset — runtime control verbs (pause/resume/stop/terminate) are Wave C.
 */
export class RegistrationHarness implements Harness {
  readonly _collected: Registration[] = [];

  on<P extends TagPattern>(pattern: P | P[], fn: TransformFor<P>): this {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    for (const p of patterns) {
      this._collected.push({ kind: 'transform', pattern: p, fn: fn as TransformFn<Tag> });
    }
    return this;
  }

  tap<P extends TagPattern>(pattern: P | P[], fn: TapFor<P>): this {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    for (const p of patterns) {
      this._collected.push({ kind: 'tap', pattern: p, fn: fn as TapFn<Tag> });
    }
    return this;
  }

  emit<T extends Tag>(tag: T, payload: PayloadFor<T>): void {
    this._collected.push({ kind: 'inject', tag, payload });
  }

  before<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this {
    this._collected.push({ kind: 'before', phase, fn: fn as PhaseHookFn<Phase> });
    return this;
  }

  after<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this {
    this._collected.push({ kind: 'after', phase, fn: fn as PhaseHookFn<Phase> });
    return this;
  }

  onError<Ph extends Phase | '*'>(phase: Ph, fn: ErrorHookFn<Ph>): this {
    this._collected.push({ kind: 'onError', phase, fn: fn as ErrorHookFn<Phase | '*'> });
    return this;
  }

  tags(): readonly Tag[] {
    return ALL_TAGS;
  }

  use(fn: (harness: Harness) => void): this {
    const sub = new RegistrationHarness();
    fn(sub);
    this._collected.push({ kind: 'use', sub: sub._collected });
    return this;
  }
}

// ── Harness interface (Wave A subset) ─────────────────────────────────────────

export interface Harness {
  on<P extends TagPattern>(pattern: P | P[], fn: TransformFor<P>): this;
  tap<P extends TagPattern>(pattern: P | P[], fn: TapFor<P>): this;
  emit<T extends Tag>(tag: T, payload: PayloadFor<T>): void;
  before<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this;
  after<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this;
  onError<Ph extends Phase | '*'>(phase: Ph, fn: ErrorHookFn<Ph>): this;
  tags(): readonly Tag[];
  use(fn: (harness: Harness) => void): this;
}

// ── All known tags (static catalog) ──────────────────────────────────────────

export const ALL_TAGS: readonly Tag[] = Object.freeze([
  'prompt.system',
  'nudge.loop-detected',
  'nudge.healing-failure',
  'message.tool-result',
  'observation.tool-result',
  'lifecycle.failure',
  'control.strategy-evaluated',
] as const);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively flatten 'use' registrations into a flat list. */
function flattenRegistrations(registrations: readonly Registration[]): Registration[] {
  const result: Registration[] = [];
  for (const r of registrations) {
    if (r.kind === 'use') {
      result.push(...flattenRegistrations(r.sub));
    } else {
      result.push(r);
    }
  }
  return result;
}
