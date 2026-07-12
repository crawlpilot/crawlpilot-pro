import { useState, useEffect, useRef, useCallback } from 'react';
import type { ExtractedContent, SummaryType, SummaryLength } from '@/shared/types/summarizer';
import {
    isSummarizerSupported,
    getSummarizerAvailability,
    createSummarizer,
    NeedsUserActivationError,
    type SummarizerInstance
} from '../services/ai/summarizer';
import {
    getLanguageModel,
    getPromptAvailability,
    docCharBudget,
    progressFraction
} from '../services/ai/promptSession';
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
            const LanguageModel = getLanguageModel();
            const availability = await getPromptAvailability();
            if (availability === 'unavailable') return false;
            if (availability !== 'available' && alive()) setPhase('downloading');

            const instruction = promptInstructionFor(type, length);
            const session = await LanguageModel.create({
                initialPrompts: [{ role: 'system', content: 'You are an expert summarizer. Follow the summary instructions exactly. Respond in markdown.' }],
                signal,
                monitor(m: any) {
                    m.addEventListener('downloadprogress', (e: any) => onDownloadProgress(progressFraction(e)));
                }
            });

            try {
                if (!alive()) return true;
                setDownloadProgress(null);

                const budget = docCharBudget(session);
                let inputText = doc.text;
                let notes = '';

                if (doc.text.length > budget) {
                    const { chunks, truncated } = splitIntoChunks(doc.text, budget);
                    setPhase('mapping');

                    const partSummaries: string[] = [];
                    for (let i = 0; i < chunks.length; i++) {
                        if (!alive()) return true;
                        setChunkProgress({ current: i + 1, total: chunks.length });
                        // Fresh short-lived session per chunk so context never
                        // accumulates across the map pass.
                        const chunkSession = await LanguageModel.create({ signal });
                        try {
                            partSummaries.push(await chunkSession.prompt(
                                `Summarize the key points of this section (part ${i + 1} of ${chunks.length} of "${doc.title}") as concise markdown bullets:\n\n${chunks[i]}`,
                                { signal }
                            ));
                        } catch (chunkErr: any) {
                            if (chunkErr?.name === 'AbortError') throw chunkErr;
                            console.error(`Chunk ${i + 1}/${chunks.length} failed:`, chunkErr);
                            notes = '\n\n*Note: some sections of this very long page could not be included in the summary.*';
                        } finally {
                            chunkSession.destroy?.();
                        }
                    }
                    setChunkProgress(null);
                    if (partSummaries.length === 0) throw new Error('Failed to summarize any section of the document.');
                    if (truncated) notes = '\n\n*Note: this page was too long to summarize completely; the summary covers the first sections.*';

                    inputText = partSummaries.join('\n\n');
                    if (alive()) setChunkDigest(inputText);
                } else {
                    inputText = truncateAtBoundary(doc.text, budget);
                }

                if (!alive()) return true;
                setPhase('streaming');
                setSummary('');

                const contextLine = doc.text.length > budget
                    ? 'The following are key points from consecutive parts of one long document.'
                    : 'The following is the main content of a web page.';
                const stream = session.promptStreaming(
                    `${contextLine}\n---\n${inputText}\n---\n\n${instruction}`,
                    { signal }
                );

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
                session.destroy?.();
            }
        };

        const generate = async () => {
            setPhase('checking');
            setError(null);
            setSummary('');
            setChunkProgress(null);
            setDownloadProgress(null);

            try {
                if (isSummarizerSupported() && await runSummarizerEngine()) return;
                if (getLanguageModel() && await runPromptEngine()) return;
                if (alive()) {
                    setEngine(null);
                    setPhase('unavailable');
                    setError(UNAVAILABLE_MESSAGE);
                }
            } catch (err: any) {
                if (!alive() || err?.name === 'AbortError') return;
                console.error('Summary generation failed:', err);
                if (err instanceof NeedsUserActivationError) {
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
