import { useState, useEffect, useRef, useCallback } from 'react';
import type { ExtractedContent, SummaryType, SummaryLength } from '@/shared/types/summarizer';
import {
    isSummarizerSupported,
    getSummarizerAvailability,
    createSummarizer,
    NeedsUserActivationError,
    type SummarizerInstance
} from '../services/ai/summarizer';
import { modelHost, modelSupported, CALL_ERROR_MESSAGES } from '../services/ai/modelHost';
import { splitIntoChunks, truncateAtBoundary } from '../services/ai/chunking';

export type SummaryPhase =
    | 'idle' | 'checking' | 'downloading' | 'needs-activation'
    | 'mapping' | 'streaming' | 'ready' | 'error' | 'unavailable';

export interface SummaryEngineApi {
    phase: SummaryPhase;
    engine: 'summarizer' | 'prompt' | null;
    summary: string;
    chunkProgress: { current: number; total: number } | null;
    downloadProgress: number | null;
    type: SummaryType;
    length: SummaryLength;
    setOptions(type: SummaryType, length: SummaryLength): void;
    chunkDigest: string | null;
    error: string | null;
    retryDownload(): void;
}

const UNAVAILABLE_MESSAGE = 'Chrome built-in AI is not available. Please ensure flags #summarization-api-for-gemini-nano (or #prompt-api-for-extension) and #optimization-guide-on-device-model are enabled, and you are using Chrome 138+.';

// Maps type/length onto prompt wording for the Prompt API fallback path
// (Chrome without the dedicated Summarizer API).
function promptInstructionFor(type: SummaryType, length: SummaryLength): string {
    const lengthWord = { short: 'very brief', medium: 'concise', long: 'detailed' }[length];
    switch (type) {
        case 'key-points': {
            const bullets = { short: '3-5', medium: '5-7', long: '8-12' }[length];
            return `Provide the ${bullets} most important key points of the document as a ${lengthWord} markdown bullet list.`;
        }
        case 'tldr':
            return `Provide a ${lengthWord} TL;DR summary of the document.`;
        case 'teaser':
            return `Write a ${lengthWord}, enticing teaser for the document that makes the reader curious without giving everything away.`;
        case 'headline':
            return `Write a single ${lengthWord} headline sentence that captures the essence of the document.`;
    }
}

const PROMPT_SYSTEM = 'You are an expert summarizer. Follow the summary instructions exactly. Respond in markdown.';
/** Tokens kept free for the summary itself. */
const SUMMARY_RESERVE = 1024;

/** A model-host failure as an error the summary screen shows (`code` kept for the activation case). */
function callError(r: { code: keyof typeof CALL_ERROR_MESSAGES; detail?: string }): Error & { code: string } {
    return Object.assign(new Error(r.code === 'model_unavailable' && r.detail ? r.detail : CALL_ERROR_MESSAGES[r.code]), { code: r.code });
}

export function useSummaryEngine(doc: ExtractedContent | null): SummaryEngineApi {
    const [phase, setPhase] = useState<SummaryPhase>('idle');
    const [engine, setEngine] = useState<'summarizer' | 'prompt' | null>(null);
    const [summary, setSummary] = useState('');
    const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [type, setType] = useState<SummaryType>('key-points');
    const [length, setLength] = useState<SummaryLength>('medium');
    const [chunkDigest, setChunkDigest] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [runId, setRunId] = useState(0);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            abortControllerRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        if (!doc || !doc.text.trim()) {
            setPhase('idle');
            return;
        }

        // One controller per run; an options change or unmount aborts the
        // in-flight generation before the next one starts.
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;
        const alive = () => isMountedRef.current && !signal.aborted;

        const onDownloadProgress = (fraction: number) => {
            if (alive()) setDownloadProgress(fraction);
        };

        const runSummarizerEngine = async () => {
            setEngine('summarizer');
            const availability = await getSummarizerAvailability();
            if (availability === 'unavailable') return false;
            if (availability !== 'available' && alive()) setPhase('downloading');

            const sharedContext = doc.title ? `Web page: "${doc.title}"${doc.siteName ? ` from ${doc.siteName}` : ''}` : undefined;
            let mapSummarizer: SummarizerInstance | null = null;
            let finalSummarizer: SummarizerInstance | null = null;

            try {
                finalSummarizer = await createSummarizer({ type, length, sharedContext, onDownloadProgress, signal });
                if (!alive()) return true;
                setDownloadProgress(null);

                const quota = finalSummarizer.inputQuota;
                let usage: number | null = null;
                if (typeof finalSummarizer.measureInputUsage === 'function' && typeof quota === 'number') {
                    usage = await finalSummarizer.measureInputUsage(doc.text);
                }
                const fitsSinglePass = usage === null || quota === undefined || usage <= quota * 0.9;

                let inputText = doc.text;
                let notes = '';

                if (!fitsSinglePass) {
                    // Map-reduce: summarize each chunk to key points, then
                    // summarize the joined key points with the user's options.
                    const charsPerChunk = Math.max(2000, Math.floor(doc.text.length * ((quota as number) * 0.8 / (usage as number))));
                    const { chunks, truncated } = splitIntoChunks(doc.text, charsPerChunk);
                    setPhase('mapping');

                    mapSummarizer = await createSummarizer({
                        type: 'key-points', length: 'medium', sharedContext, signal
                    });

                    const partSummaries: string[] = [];
                    for (let i = 0; i < chunks.length; i++) {
                        if (!alive()) return true;
                        setChunkProgress({ current: i + 1, total: chunks.length });
                        try {
                            partSummaries.push(await summarizeChunkWithRetry(mapSummarizer, chunks[i], i, chunks.length, doc.title, signal));
                        } catch (chunkErr: any) {
                            if (chunkErr?.name === 'AbortError') throw chunkErr;
                            console.error(`Chunk ${i + 1}/${chunks.length} failed:`, chunkErr);
                            notes = '\n\n*Note: some sections of this very long page could not be included in the summary.*';
                        }
                    }
                    setChunkProgress(null);
                    if (partSummaries.length === 0) throw new Error('Failed to summarize any section of the document.');
                    if (truncated) notes = '\n\n*Note: this page was too long to summarize completely; the summary covers the first sections.*';

                    inputText = partSummaries.join('\n\n');
                    if (alive()) setChunkDigest(inputText);
                }

                if (!alive()) return true;
                setPhase('streaming');
                setSummary('');

                const stream = finalSummarizer.summarizeStreaming(inputText, {
                    context: fitsSinglePass
                        ? 'This is the main content of a web page.'
                        : 'These are key points extracted from consecutive parts of one long document. Produce one coherent summary of the whole document.',
                    signal
                });

                let full = '';
                for await (const chunk of stream) {
                    full += chunk;
                    if (!alive()) return true;
                    setSummary(full);
                }
                if (alive()) {
                    if (notes) setSummary(full + notes);
                    setPhase('ready');
                }
                return true;
            } finally {
                mapSummarizer?.destroy?.();
                finalSummarizer?.destroy?.();
            }
        };

        const runPromptEngine = async () => {
            setEngine('prompt');
            const ready = await modelHost.prepare(PROMPT_SYSTEM, 'default', onDownloadProgress);
            if (!ready.ok) {
                if (ready.code === 'model_unavailable') return false;
                throw callError(ready);
            }
            if (!alive()) return true;
            setDownloadProgress(null);

            const instruction = promptInstructionFor(type, length);
            const wrapWhole = (text: string) => `The following is the main content of a web page.\n---\n${text}\n---\n\n${instruction}`;
            const wrapPart = (text: string, i: number, n: number) =>
                `Summarize the key points of this section (part ${i + 1} of ${n} of "${doc.title}") as concise markdown bullets:\n\n${text}`;

            // Sized by measurement: the whole page when it fits, else chunks that each fit one call.
            const room = await modelHost.room(PROMPT_SYSTEM, 'default', doc.text, SUMMARY_RESERVE);
            if ('code' in room) throw callError(room);
            const maxChars = Math.max(2000, Math.floor(room.tokens * room.charsPerToken * 0.85) - 300);

            let inputText = doc.text;
            let notes = '';
            const whole = await modelHost.fits({ system: PROMPT_SYSTEM, prompt: wrapWhole(doc.text), reserve: SUMMARY_RESERVE });
            if ('code' in whole) throw callError(whole);

            if (whole.need > whole.available) {
                const { chunks, truncated } = splitIntoChunks(doc.text, maxChars);
                setPhase('mapping');
                const partSummaries: string[] = [];
                for (let i = 0; i < chunks.length; i++) {
                    if (!alive()) return true;
                    setChunkProgress({ current: i + 1, total: chunks.length });
                    // Each part in its own clone: context never accumulates across the map pass.
                    let res = await modelHost.run({ system: PROMPT_SYSTEM, prompt: wrapPart(chunks[i], i, chunks.length), reserve: SUMMARY_RESERVE }, signal);
                    if (!res.ok && res.code === 'too_large') {
                        res = await modelHost.run({ system: PROMPT_SYSTEM, prompt: wrapPart(truncateAtBoundary(chunks[i], Math.floor(chunks[i].length / 2)), i, chunks.length), reserve: SUMMARY_RESERVE }, signal);
                    }
                    if (!res.ok) {
                        if (res.code === 'aborted') return true;
                        if (res.code === 'model_unavailable' || res.code === 'session_lost') throw callError(res);
                        console.error(`Part ${i + 1}/${chunks.length} failed: ${res.code}`, res.detail);
                        notes = '\n\n*Note: some sections of this very long page could not be included in the summary.*';
                        continue;
                    }
                    partSummaries.push(res.value);
                }
                setChunkProgress(null);
                if (partSummaries.length === 0) throw new Error('Failed to summarize any section of the document.');
                if (truncated) notes = '\n\n*Note: this page was too long to summarize completely; the summary covers the first sections.*';
                inputText = partSummaries.join('\n\n');
                if (alive()) setChunkDigest(inputText);
            }

            if (!alive()) return true;
            setPhase('streaming');
            setSummary('');
            const prompt = inputText === doc.text
                ? wrapWhole(inputText)
                : `The following are key points from consecutive parts of one long document.\n---\n${truncateAtBoundary(inputText, maxChars)}\n---\n\n${instruction}`;
            const res = await modelHost.run({
                system: PROMPT_SYSTEM, prompt, reserve: SUMMARY_RESERVE, timeoutMs: 120_000,
                onText: text => { if (alive()) setSummary(text); },
            }, signal);
            if (!res.ok) {
                if (res.code === 'aborted') return true;
                throw callError(res);
            }
            if (alive()) {
                setSummary(res.value + notes);
                setPhase('ready');
            }
            return true;
        };

        const generate = async () => {
            setPhase('checking');
            setError(null);
            setSummary('');
            setChunkProgress(null);
            setDownloadProgress(null);

            try {
                if (isSummarizerSupported() && await runSummarizerEngine()) return;
                if (modelSupported() && await runPromptEngine()) return;
                if (alive()) {
                    setEngine(null);
                    setPhase('unavailable');
                    setError(UNAVAILABLE_MESSAGE);
                }
            } catch (err: any) {
                if (!alive() || err?.name === 'AbortError') return;
                console.error('Summary generation failed:', err);
                if (err instanceof NeedsUserActivationError || err?.code === 'needs_activation') {
                    setPhase('needs-activation');
                } else {
                    setPhase('error');
                    setError(err.message || 'Failed to generate summary.');
                }
            }
        };

        generate();

        return () => controller.abort();
    }, [doc, type, length, runId]);

    const setOptions = useCallback((nextType: SummaryType, nextLength: SummaryLength) => {
        setType(nextType);
        setLength(nextLength);
    }, []);

    // Re-runs generate() from a click handler, satisfying the user-gesture
    // requirement for starting the model download.
    const retryDownload = useCallback(() => setRunId(id => id + 1), []);

    return { phase, engine, summary, chunkProgress, downloadProgress, type, length, setOptions, chunkDigest, error, retryDownload };
}

// Quota overflow on a single chunk: halve it and retry each half once, then
// give up on that chunk (caller skips it).
async function summarizeChunkWithRetry(
    summarizer: SummarizerInstance,
    chunk: string,
    index: number,
    total: number,
    title: string,
    signal: AbortSignal
): Promise<string> {
    const context = `Part ${index + 1} of ${total} of: ${title}`;
    try {
        return await summarizer.summarize(chunk, { context, signal });
    } catch (err: any) {
        if (err?.name !== 'QuotaExceededError') throw err;
        const half = Math.ceil(chunk.length / 2);
        const first = await summarizer.summarize(truncateAtBoundary(chunk, half), { context, signal });
        const second = await summarizer.summarize(chunk.slice(half).trim(), { context, signal });
        return `${first}\n${second}`;
    }
}
