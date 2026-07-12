import { truncateAtBoundary } from './chunking';

export const SYSTEM_PROMPT = 'You are an intelligent reading assistant. Answer concisely and strictly based on the Reference Document provided at the start of this conversation.';

// Rough chars-per-token for Gemini Nano; used to keep the doc + ongoing
// conversation inside the session's context window without a hard, blind cut.
export const CHARS_PER_TOKEN = 4;
export const DEFAULT_DOC_CHAR_BUDGET = 12000;

// Forces the model to return exactly 3 strings as real JSON, regardless of
// the session's "answer strictly from the document" system prompt — without
// this, the model often refuses/answers in prose and regex-based parsing
// silently fails, leaving suggestions stuck on the static defaults.
export const SUGGESTIONS_SCHEMA = {
    type: 'array',
    items: { type: 'string' },
    minItems: 3,
    maxItems: 3
};

export function getLanguageModel(): any {
    const aiAPI = (chrome as any).aiOriginTrial || (window as any).ai;
    return aiAPI?.languageModel || (window as any).LanguageModel;
}

export function isPromptApiSupported(): boolean {
    return Boolean(getLanguageModel());
}

export type EngineAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

// Chrome has shipped several spellings of these states across versions
// ('readily'/'available', 'after-download'/'downloadable') — normalize them.
export function normalizeAvailability(value: string): EngineAvailability {
    switch (value) {
        case 'readily':
        case 'available':
            return 'available';
        case 'after-download':
        case 'downloadable':
            return 'downloadable';
        case 'downloading':
            return 'downloading';
        default:
            return 'unavailable';
    }
}

export async function getPromptAvailability(): Promise<EngineAvailability> {
    const LanguageModel = getLanguageModel();
    if (!LanguageModel) return 'unavailable';
    try {
        return normalizeAvailability(await LanguageModel.availability());
    } catch {
        return 'unavailable';
    }
}

// Download progress arrives as e.loaded in 0..1 (current API) or as
// {loaded, total} bytes (older builds) — normalize to a 0..1 fraction.
export function progressFraction(e: any): number {
    if (typeof e?.total === 'number' && e.total > 1) {
        return e.loaded / e.total;
    }
    return typeof e?.loaded === 'number' ? e.loaded : 0;
}

// Leaves headroom for the doc + ongoing conversation inside the session's
// actual context window, instead of a blind fixed-length cut.
export function docCharBudget(session: any): number {
    const quota = session?.inputQuota;
    if (typeof quota === 'number' && quota > 0) {
        return Math.max(4000, Math.floor(quota * CHARS_PER_TOKEN * 0.6));
    }
    return DEFAULT_DOC_CHAR_BUDGET;
}

export interface CreateChatSessionOptions {
    seedDocument: string;
    onDownloadProgress?: (fraction: number) => void;
    signal?: AbortSignal;
}

// One long-lived session holds the Reference Document + the entire
// conversation. Chrome's Prompt API tracks this state internally, so callers
// never re-send the document or replay history by hand.
export async function createChatSession({ seedDocument, onDownloadProgress, signal }: CreateChatSessionOptions): Promise<any> {
    const LanguageModel = getLanguageModel();
    if (!LanguageModel) {
        throw new Error('Chrome AI Prompt API is not available.');
    }

    // The doc is seeded as an already-acknowledged conversation turn via
    // initialPrompts — the session ingests it without generating a response,
    // so seeding costs no model round trip.
    const doc = truncateAtBoundary(seedDocument, DEFAULT_DOC_CHAR_BUDGET);
    return LanguageModel.create({
        initialPrompts: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Reference Document:\n---\n${doc}\n---\n\nAnswer all following questions strictly from this document.` },
            { role: 'assistant', content: 'Understood. I will answer based on the Reference Document.' }
        ],
        ...(signal ? { signal } : {}),
        monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => onDownloadProgress?.(progressFraction(e)));
        }
    });
}
