/**
 * The one owner of Chrome's on-device model (Prompt API, the global `LanguageModel`). Nothing else in
 * the extension touches it. Rules come from the Prompt API documentation (the list and the reasoning
 * are in docs/plans/ai-extract-markdown-plan.md §3.9):
 *
 * - `availability()` gets the same options as `create()` (`MODEL_OPTIONS`), and is asked again before
 *   every new base session: Chrome removes the model when disk space runs low.
 * - A model download (`downloadable`/`downloading`) needs user activation; when `available` it doesn't.
 * - One base session per system prompt stays warm; every call runs in a `clone()` of it, so calls
 *   never share history and an overflow can never evict instructions or an earlier chunk. Clones are
 *   destroyed after the call, bases after `IDLE_MS` without calls.
 * - Calls run one at a time (one model, one device). A call never throws: it returns a `CallError`.
 * - Every prompt is measured (`measureContextUsage`, response constraint included) against
 *   `contextWindow − contextUsage` before it is sent; a prompt that doesn't fit is `too_large`, and
 *   the caller splits it.
 * - `responseConstraint` failures are their own codes (`schema_unsupported`, `unsatisfiable`); there
 *   is never an unconstrained retry.
 */

export type EngineAvailability = Availability;

export const MODEL_OPTIONS = {
    expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
    expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

export type CallError =
    | 'aborted' | 'timeout' | 'too_large' | 'schema_unsupported' | 'unsatisfiable' | 'invalid_output'
    | 'unsupported_language' | 'model_unavailable' | 'needs_activation' | 'session_lost' | 'failed';

export const CALL_ERROR_MESSAGES: Record<CallError, string> = {
    aborted: 'Stopped.',
    timeout: 'The on-device model took too long to answer.',
    too_large: 'The text is too long for the on-device model.',
    schema_unsupported: 'The on-device model cannot produce this output shape.',
    unsatisfiable: 'The on-device model could not produce an answer in the required shape.',
    invalid_output: 'The on-device model returned an answer that could not be read.',
    unsupported_language: 'This language is not supported by the on-device model (English, Japanese, Spanish, German and French are).',
    model_unavailable: "Chrome's on-device model is not available.",
    needs_activation: 'The on-device model needs to be downloaded first: click to start the download.',
    session_lost: 'The on-device model stopped responding.',
    failed: 'The on-device model failed.',
};

/** `exact`: deterministic, for extraction and mapping (copy, don't create). `default`: Chrome's own. */
export type Sampling = 'exact' | 'default';

export interface ModelCall<T = string> {
    /** The session's system prompt. Calls with the same system prompt share a warm base session. */
    system: string;
    sampling?: Sampling;
    prompt: string;
    /** A compiled `responseConstraint` (shared/ai/constraint.ts). */
    schema?: Record<string, unknown>;
    /** Keep the schema out of the context; the prompt must then describe the format itself. */
    omitSchemaInput?: boolean;
    /** Turns the raw answer into a value; throwing makes the call `invalid_output`. */
    parse?: (raw: string) => T;
    timeoutMs?: number;
    /** Tokens kept free for the answer. */
    reserve?: number;
    /** Streams the answer as it is written (the full text so far). */
    onText?: (text: string) => void;
}

export type CallResult<T> =
    | { ok: true; value: T; raw: string; usage: number }
    | { ok: false; code: CallError; detail?: string; need?: number; available?: number };

export interface ModelStatus {
    availability: EngineAvailability;
    /** Why it is unavailable, for the user. */
    reason?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RESERVE = 512;
const IDLE_MS = 2 * 60_000;

const UNAVAILABLE_REASON =
    "Chrome's on-device model needs Chrome 138 or later on Windows 10/11, macOS 13+, Linux or a Chromebook Plus, " +
    'a GPU with more than 4 GB of memory (or 16 GB of RAM and 4 CPU cores), and 22 GB of free disk space. ' +
    'chrome://on-device-internals shows the model state.';

function api(): typeof LanguageModel | undefined {
    return (globalThis as any).LanguageModel;
}

/** Whether this Chrome has the Prompt API with the current context-window API. */
export function modelSupported(): boolean {
    const LM = api();
    return Boolean(LM && typeof LM.prototype?.measureContextUsage === 'function');
}

/** Download progress as 0..1 (`loaded`; `total` is always 1). */
export function progressFraction(e: ProgressEvent): number {
    return typeof e?.loaded === 'number' ? e.loaded : 0;
}

export async function modelStatus(): Promise<ModelStatus> {
    const LM = api();
    if (!LM) return { availability: 'unavailable', reason: UNAVAILABLE_REASON };
    if (!modelSupported()) return { availability: 'unavailable', reason: 'Update Chrome to use the on-device model with CrawlPilot.' };
    try {
        const availability = await LM.availability(MODEL_OPTIONS);
        return availability === 'unavailable' ? { availability, reason: UNAVAILABLE_REASON } : { availability };
    } catch (e) {
        return { availability: 'unavailable', reason: `${UNAVAILABLE_REASON} (${(e as Error)?.message ?? e})` };
    }
}

/** The documented exception names, as call errors. `null`: undocumented (maybe a lost session). */
export function codeFor(e: unknown): CallError | null {
    const name = (e as any)?.name;
    switch (name) {
        case 'AbortError': return 'aborted';
        case 'QuotaExceededError': return 'too_large';
        case 'NotSupportedError': return /language/i.test((e as any)?.message ?? '') ? 'unsupported_language' : 'schema_unsupported';
        case 'SyntaxError': return 'unsatisfiable';
        case 'NetworkError': return 'model_unavailable';
        case 'NotAllowedError': return 'needs_activation';
        // Our bug (a bad option or message order): never retried.
        case 'TypeError': case 'RangeError': return 'failed';
        default: return null;
    }
}

class HostError extends Error {
    constructor(readonly code: CallError, detail?: string) {
        super(detail ?? CALL_ERROR_MESSAGES[code]);
    }
}

function samplingOptions(sampling: Sampling): Record<string, unknown> {
    if (sampling === 'default') return {};
    // `samplingMode` replaces the extension-only temperature/topK pair where Chrome has it.
    if ('samplingMode' in (api()!.prototype as object)) return { samplingMode: 'most-predictable' };
    // Extensions: both or neither, topK ≥ 1, temperature ≥ 0.
    return { temperature: 0, topK: 1 };
}

class ModelHost {
    private bases = new Map<string, Promise<LanguageModel>>();
    private queue: Promise<unknown> = Promise.resolve();
    private idle: ReturnType<typeof setTimeout> | null = null;

    private key(system: string, sampling: Sampling) {
        return `${sampling}\u0000${system}`;
    }

    /** The warm base session for this system prompt, created (and the model downloaded) if needed. */
    private base(system: string, sampling: Sampling, onProgress?: (fraction: number) => void): Promise<LanguageModel> {
        const key = this.key(system, sampling);
        let base = this.bases.get(key);
        if (!base) {
            base = (async () => {
                const status = await modelStatus();
                if (status.availability === 'unavailable') throw new HostError('model_unavailable', status.reason);
                if (status.availability !== 'available' && !navigator.userActivation?.isActive) throw new HostError('needs_activation');
                return api()!.create({
                    ...MODEL_OPTIONS,
                    ...samplingOptions(sampling),
                    initialPrompts: [{ role: 'system', content: system }],
                    monitor(m) { m.addEventListener('downloadprogress', e => onProgress?.(progressFraction(e))); },
                } as LanguageModelCreateOptions);
            })();
            base.catch(() => { if (this.bases.get(key) === base) this.bases.delete(key); });
            this.bases.set(key, base);
        }
        this.touch();
        return base;
    }

    private touch() {
        if (this.idle) clearTimeout(this.idle);
        this.idle = setTimeout(() => this.reset(), IDLE_MS);
    }

    /** Destroys every base session (the model may unload). */
    reset() {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
        const bases = [...this.bases.values()];
        this.bases.clear();
        bases.forEach(b => b.then(s => s.destroy(), () => undefined));
    }

    /** Creates the base session for `system` now: call from a click when the model must download. */
    async prepare(system: string, sampling: Sampling = 'default', onProgress?: (fraction: number) => void): Promise<CallResult<void>> {
        try {
            await this.base(system, sampling, onProgress);
            return { ok: true, value: undefined, raw: '', usage: 0 };
        } catch (e) {
            return this.failure(e);
        }
    }

    /**
     * Room for a prompt in a fresh call: `tokens` free after the system prompt and `reserve`, and the
     * characters per token measured on `sample` (for sizing chunks before measuring them exactly).
     */
    async room(system: string, sampling: Sampling, sample: string, reserve = DEFAULT_RESERVE): Promise<{ tokens: number; charsPerToken: number } | { code: CallError }> {
        try {
            const base = await this.base(system, sampling);
            const tokens = base.contextWindow - base.contextUsage - reserve;
            const text = sample.slice(0, 4000) || 'x';
            const used = await base.measureContextUsage(text);
            return { tokens, charsPerToken: used > 0 ? text.length / used : 4 };
        } catch (e) {
            return { code: this.failure(e).code };
        }
    }

    /** Measures `prompt` (with its constraint) against the room left in a fresh call. */
    async fits(call: ModelCall<unknown>): Promise<{ need: number; available: number } | { code: CallError }> {
        try {
            const base = await this.base(call.system, call.sampling ?? 'default');
            const need = await base.measureContextUsage(call.prompt, this.promptOptions(call));
            return { need, available: base.contextWindow - base.contextUsage - (call.reserve ?? DEFAULT_RESERVE) };
        } catch (e) {
            return { code: this.failure(e).code };
        }
    }

    /** Runs one call in a clone of its base session, after the calls before it. */
    run<T = string>(call: ModelCall<T>, signal?: AbortSignal): Promise<CallResult<T>> {
        const result = this.queue.then(() => this.runNow(call, signal, () => this.base(call.system, call.sampling ?? 'default'), true));
        this.queue = result.catch(() => undefined);
        return result;
    }

    /** Runs one call in a clone of `session` (a conversation): it sees the conversation, and doesn't change it. */
    runOn<T = string>(session: LanguageModel, call: Omit<ModelCall<T>, 'system' | 'sampling'>, signal?: AbortSignal): Promise<CallResult<T>> {
        const full = { ...call, system: '' } as ModelCall<T>;
        const result = this.queue.then(() => this.runNow(full, signal, async () => session, false));
        this.queue = result.catch(() => undefined);
        return result;
    }

    /**
     * A conversation with its own history (Chat): `seed` is appended without a model turn. Overflow
     * evicts the oldest turns (the system prompt stays) and calls `onOverflow`. The caller destroys it.
     */
    async conversation(system: string, seed: string, opts: { onOverflow?: () => void; signal?: AbortSignal } = {}): Promise<{ session: LanguageModel } | { code: CallError; detail?: string }> {
        try {
            const status = await modelStatus();
            if (status.availability === 'unavailable') return { code: 'model_unavailable', detail: status.reason };
            if (status.availability !== 'available' && !navigator.userActivation?.isActive) return { code: 'needs_activation' };
            const session = await api()!.create({ ...MODEL_OPTIONS, initialPrompts: [{ role: 'system', content: system }], ...(opts.signal ? { signal: opts.signal } : {}) });
            session.addEventListener('contextoverflow', () => opts.onOverflow?.());
            await session.append([{ role: 'user', content: seed }], opts.signal ? { signal: opts.signal } : undefined);
            return { session };
        } catch (e) {
            const f = this.failure(e);
            return { code: f.code, detail: f.detail };
        }
    }

    private promptOptions(call: ModelCall<unknown>): LanguageModelPromptOptions {
        if (!call.schema) return {};
        return { responseConstraint: call.schema, ...(call.omitSchemaInput ? { omitResponseConstraintInput: true } : {}) };
    }

    private async runNow<T>(call: ModelCall<T>, signal: AbortSignal | undefined, getBase: () => Promise<LanguageModel>, canRecover: boolean): Promise<CallResult<T>> {
        if (signal?.aborted) return { ok: false, code: 'aborted' };
        let clone: LanguageModel | null = null;
        const timeout = AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        try {
            const base = await getBase();
            clone = await base.clone({ signal: combined });
            const options = this.promptOptions(call);
            const need = await clone.measureContextUsage(call.prompt, { ...options, signal: combined });
            const available = clone.contextWindow - clone.contextUsage - (call.reserve ?? DEFAULT_RESERVE);
            if (need > available) return { ok: false, code: 'too_large', need, available };

            let raw = '';
            if (call.onText) {
                const reader = clone.promptStreaming(call.prompt, { ...options, signal: combined }).getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    raw += value;
                    call.onText(raw);
                }
            } else {
                raw = await clone.prompt(call.prompt, { ...options, signal: combined });
            }
            const usage = clone.contextUsage;
            try {
                const value = call.parse ? call.parse(raw) : (raw as unknown as T);
                return { ok: true, value, raw, usage };
            } catch (e) {
                return { ok: false, code: 'invalid_output', detail: (e as Error)?.message };
            }
        } catch (e) {
            if (timeout.aborted && !signal?.aborted) return { ok: false, code: 'timeout' };
            if (e instanceof HostError) return { ok: false, code: e.code, detail: e.message };
            const code = codeFor(e);
            if (code) return { ok: false, code, detail: (e as Error)?.message };
            // Undocumented: the session may be gone (model unloaded or removed). Recreate it once.
            if (canRecover && (await modelStatus()).availability === 'available') {
                this.bases.delete(this.key(call.system, call.sampling ?? 'default'));
                const again = await this.runNow(call, signal, getBase, false);
                return again.ok ? again : { ...again, code: again.code === 'failed' ? 'session_lost' : again.code };
            }
            return { ok: false, code: canRecover ? 'model_unavailable' : 'session_lost', detail: (e as Error)?.message };
        } finally {
            clone?.destroy();
            if (canRecover) this.touch();
        }
    }

    private failure(e: unknown): { ok: false; code: CallError; detail?: string } {
        if (e instanceof HostError) return { ok: false, code: e.code, detail: e.message };
        return { ok: false, code: codeFor(e) ?? 'failed', detail: (e as Error)?.message };
    }
}

export const modelHost = new ModelHost();
