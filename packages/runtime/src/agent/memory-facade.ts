/**
 * Memory facade — `agent.memory()`: list, search, read, edit and delete what
 * the agent has persisted, with provenance (which task and run wrote each
 * entry).
 *
 * Effect-typed at the module boundary (D1): {@link makeMemoryFacade} returns
 * Effects whose `E` carries only deliberate failures ({@link MemoryNotEnabledError},
 * the memory package's `MemoryNotFoundError` / `DatabaseError`).
 * {@link makeMemoryHandle} runs them through the shared Promise bridge
 * `runFacadeEffect` (agent/run-facade-effect.ts), so a rejection is the raw
 * tagged error, never a `FiberFailure` wrapper.
 *
 * Services are read with `Effect.serviceOption`: without `.withMemory()` the
 * agent has no memory stores and every call fails with
 * {@link MemoryNotEnabledError} instead of pretending the memory is empty.
 *
 * Semantic memory is the searchable store (FTS5, LIKE fallback on Node
 * sqlite). Procedural memory holds learned workflows. Episodic memory is the
 * agent's event log: list-only here.
 */
import { Data, Effect, ManagedRuntime, Option } from 'effect'
import {
    EpisodicMemoryService,
    MemoryIdSchema,
    MemoryNotFoundError,
    ProceduralMemoryService,
    SemanticMemoryService,
    type DailyLogEntry,
    type DatabaseError,
    type ProceduralEntry,
    type SemanticEntry,
} from '@reactive-agents/memory'
import { runFacadeEffect } from './run-facade-effect.js'

/** `agent.memory()` was used on an agent built without `.withMemory()`. */
export class MemoryNotEnabledError extends Data.TaggedError('MemoryNotEnabledError')<{
    readonly message: string
}> {}

/** A semantic memory entry as `agent.memory()` returns it (no embedding vector). `taskId`/`runId` name the run that wrote it. */
export type SemanticMemoryItem = Omit<SemanticEntry, 'embedding'>
/** A procedural memory entry (learned workflow). `taskId`/`runId` name the run that wrote it. */
export type ProceduralMemoryItem = ProceduralEntry
/** An episodic log entry. `taskId` names the task it was logged during. */
export type EpisodicMemoryItem = DailyLogEntry

/** Editable fields of a semantic entry. */
export type SemanticMemoryPatch = Partial<Pick<SemanticEntry, 'content' | 'summary' | 'importance' | 'verified' | 'tags'>>
/** Editable fields of a procedural entry. */
export type ProceduralMemoryPatch = Partial<Pick<ProceduralEntry, 'name' | 'description' | 'pattern' | 'tags'>>

/** Options for `agent.memory().search()`. */
export interface MemorySearchOptions {
    /** Maximum results. Default 10. */
    readonly limit?: number
    /** Only entries written during this task. */
    readonly taskId?: string
    /** Only entries written during this run. */
    readonly runId?: string
}

/** Options for the `list()` calls. */
export interface MemoryListOptions {
    /** Maximum entries. Default 100 (semantic, procedural) or 50 (episodic). */
    readonly limit?: number
}

/**
 * Options for `semantic.list()` / `procedural.list()`: the list options plus
 * a provenance filter, applied in the store query (before `limit`).
 */
export interface MemoryProvenanceListOptions extends MemoryListOptions {
    /** Only entries written during this task. */
    readonly taskId?: string
    /** Only entries written during this run. */
    readonly runId?: string
}

/**
 * Options for `episodic.list()`: the list options plus a task filter, applied
 * in the store query (before `limit`). Episodic rows record only the task
 * they were logged during, so there is no `runId` filter here.
 */
export interface EpisodicListOptions extends MemoryListOptions {
    /** Only entries logged during this task. */
    readonly taskId?: string
}

/** The provenance filter of a list call, with unset fields left out. */
const provenanceOf = (options: MemoryProvenanceListOptions): { taskId?: string; runId?: string } => ({
    ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
})

/** Errors a memory call can reject with. */
export type MemoryFacadeError = MemoryNotEnabledError | MemoryNotFoundError | DatabaseError

/**
 * The Promise API returned by `agent.memory()`. Every entry carries its
 * provenance (`taskId` / `runId`) when the writing run recorded it; rows
 * written before provenance existed have neither.
 */
export interface AgentMemoryHandle {
    /** Full-text search over semantic memory, newest-ranked first. */
    search(query: string, options?: MemorySearchOptions): Promise<SemanticMemoryItem[]>
    /** Semantic memory: facts and observations the agent stored. */
    readonly semantic: {
        /** Entries, most important first. `taskId` / `runId` narrow to what that task or run wrote. */
        list(options?: MemoryProvenanceListOptions): Promise<SemanticMemoryItem[]>
        /** One entry, or `undefined` when the id is unknown. */
        get(id: string): Promise<SemanticMemoryItem | undefined>
        /** Edit an entry; rejects with `MemoryNotFoundError` for an unknown id. Returns the updated entry. */
        update(id: string, patch: SemanticMemoryPatch): Promise<SemanticMemoryItem>
        /** Delete an entry. Unknown ids are a no-op. */
        delete(id: string): Promise<void>
    }
    /** Procedural memory: learned workflows. */
    readonly procedural: {
        /** Workflows, highest success rate first. `taskId` / `runId` narrow to what that task or run wrote. */
        list(options?: MemoryProvenanceListOptions): Promise<ProceduralMemoryItem[]>
        /** One workflow, or `undefined` when the id is unknown. */
        get(id: string): Promise<ProceduralMemoryItem | undefined>
        /** Edit a workflow; rejects with `MemoryNotFoundError` for an unknown id. Returns the updated workflow. */
        update(id: string, patch: ProceduralMemoryPatch): Promise<ProceduralMemoryItem>
        /** Delete a workflow. Unknown ids are a no-op. */
        delete(id: string): Promise<void>
    }
    /** Episodic memory: the agent's event log (read-only). */
    readonly episodic: {
        /** Recent log entries, newest first. `taskId` narrows to what was logged during that task. */
        list(options?: EpisodicListOptions): Promise<EpisodicMemoryItem[]>
    }
}

const notEnabled = (): MemoryNotEnabledError =>
    new MemoryNotEnabledError({ message: 'agent.memory() needs memory: build the agent with .withMemory()' })

const stripEmbedding = ({ embedding: _embedding, ...rest }: SemanticEntry): SemanticMemoryItem => rest

/** `MemoryNotFoundError` becomes `undefined`; other failures pass through. */
const orUndefined = <A>(
    effect: Effect.Effect<A, MemoryFacadeError>,
): Effect.Effect<A | undefined, MemoryNotEnabledError | DatabaseError> =>
    effect.pipe(Effect.catchTag('MemoryNotFoundError', () => Effect.succeed(undefined)))

/** Build the Effect-typed memory facade for one agent. */
export const makeMemoryFacade = (deps: { readonly agentId: string }) => {
    const { agentId } = deps
    // Each store resolves at call time or fails with MemoryNotEnabledError.
    const semantic = Effect.serviceOption(SemanticMemoryService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(notEnabled()), onSome: Effect.succeed })))
    const procedural = Effect.serviceOption(ProceduralMemoryService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(notEnabled()), onSome: Effect.succeed })))
    const episodic = Effect.serviceOption(EpisodicMemoryService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(notEnabled()), onSome: Effect.succeed })))
    const id = (raw: string) => MemoryIdSchema.make(raw)

    const getSemantic = (raw: string): Effect.Effect<SemanticMemoryItem, MemoryFacadeError> =>
        Effect.flatMap(semantic, (s) => s.get(id(raw))).pipe(Effect.map(stripEmbedding))
    const getProcedural = (raw: string): Effect.Effect<ProceduralMemoryItem, MemoryFacadeError> =>
        Effect.flatMap(procedural, (p) => p.get(id(raw)))

    return {
        search: (query: string, options: MemorySearchOptions = {}): Effect.Effect<SemanticMemoryItem[], MemoryFacadeError> =>
            Effect.flatMap(semantic, (s) =>
                s.search({
                    query,
                    agentId,
                    limit: options.limit ?? 10,
                    ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
                    ...(options.runId !== undefined ? { runId: options.runId } : {}),
                }),
            ).pipe(Effect.map((rows) => rows.map(stripEmbedding))),

        semantic: {
            list: (options: MemoryProvenanceListOptions = {}): Effect.Effect<SemanticMemoryItem[], MemoryFacadeError> =>
                Effect.flatMap(semantic, (s) => s.listByAgent(agentId, options.limit ?? 100, provenanceOf(options))).pipe(
                    Effect.map((rows) => rows.map(stripEmbedding)),
                ),
            get: (raw: string): Effect.Effect<SemanticMemoryItem | undefined, MemoryNotEnabledError | DatabaseError> =>
                orUndefined(getSemantic(raw)),
            update: (raw: string, patch: SemanticMemoryPatch): Effect.Effect<SemanticMemoryItem, MemoryFacadeError> =>
                Effect.gen(function* () {
                    const s = yield* semantic
                    yield* getSemantic(raw)
                    yield* s.update(id(raw), patch)
                    return yield* getSemantic(raw)
                }),
            delete: (raw: string): Effect.Effect<void, MemoryFacadeError> =>
                Effect.flatMap(semantic, (s) => s.delete(id(raw))),
        },

        procedural: {
            list: (options: MemoryProvenanceListOptions = {}): Effect.Effect<ProceduralMemoryItem[], MemoryFacadeError> =>
                Effect.flatMap(procedural, (p) => p.listActive(agentId, provenanceOf(options))).pipe(
                    Effect.map((rows) => rows.slice(0, options.limit ?? 100)),
                ),
            get: (raw: string): Effect.Effect<ProceduralMemoryItem | undefined, MemoryNotEnabledError | DatabaseError> =>
                orUndefined(getProcedural(raw)),
            update: (raw: string, patch: ProceduralMemoryPatch): Effect.Effect<ProceduralMemoryItem, MemoryFacadeError> =>
                Effect.gen(function* () {
                    const p = yield* procedural
                    const current = yield* getProcedural(raw)
                    // store is INSERT OR REPLACE: the original writer's provenance is kept.
                    const next: ProceduralEntry = { ...current, ...patch, updatedAt: new Date() }
                    yield* p.store(next)
                    return next
                }),
            delete: (raw: string): Effect.Effect<void, MemoryFacadeError> =>
                Effect.flatMap(procedural, (p) => p.delete(id(raw))),
        },

        episodic: {
            list: (options: EpisodicListOptions = {}): Effect.Effect<EpisodicMemoryItem[], MemoryFacadeError> => {
                const limit = options.limit ?? 50
                const { taskId } = options
                if (taskId === undefined) return Effect.flatMap(episodic, (e) => e.getRecent(agentId, limit))
                // getByTask filters by task_id in the query (oldest first, no limit):
                // keep this agent's rows, then newest first, then the limit.
                return Effect.flatMap(episodic, (e) => e.getByTask(taskId)).pipe(
                    Effect.map((rows) => rows.filter((r) => r.agentId === agentId).reverse().slice(0, limit)),
                )
            },
        },
    }
}

/**
 * The Promise handle behind `agent.memory()`: each facade Effect runs through
 * the shared `runFacadeEffect` bridge on the agent's runtime.
 */
export const makeMemoryHandle = <R>(
    runtime: ManagedRuntime.ManagedRuntime<R, never>,
    agentId: string,
): AgentMemoryHandle => {
    const f = makeMemoryFacade({ agentId })
    const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => runFacadeEffect(runtime, effect)
    return {
        search: (query, options) => run(f.search(query, options)),
        semantic: {
            list: (options) => run(f.semantic.list(options)),
            get: (raw) => run(f.semantic.get(raw)),
            update: (raw, patch) => run(f.semantic.update(raw, patch)),
            delete: (raw) => run(f.semantic.delete(raw)),
        },
        procedural: {
            list: (options) => run(f.procedural.list(options)),
            get: (raw) => run(f.procedural.get(raw)),
            update: (raw, patch) => run(f.procedural.update(raw, patch)),
            delete: (raw) => run(f.procedural.delete(raw)),
        },
        episodic: {
            list: (options) => run(f.episodic.list(options)),
        },
    }
}
