import type { SummaryType, SummaryLength } from '@/shared/types/summarizer';
import { progressFraction, type EngineAvailability } from './modelHost';

// Thrown when model download needs a user gesture (create() rejects with
// NotAllowedError) — the UI shows a "Download AI model" button and retries
// from its click handler.
export class NeedsUserActivationError extends Error {
    constructor() {
        super('AI model download requires a user gesture.');
        this.name = 'NeedsUserActivationError';
    }
}

function getSummarizerClass(): any {
    return (self as any).Summarizer;
}

export function isSummarizerSupported(): boolean {
    return typeof getSummarizerClass() !== 'undefined';
}

export async function getSummarizerAvailability(): Promise<EngineAvailability> {
    const Summarizer = getSummarizerClass();
    if (!Summarizer) return 'unavailable';
    try {
        return await Summarizer.availability();
    } catch {
        return 'unavailable';
    }
}

export interface CreateSummarizerOptions {
    type: SummaryType;
    length: SummaryLength;
    sharedContext?: string;
    onDownloadProgress?: (fraction: number) => void;
    signal?: AbortSignal;
}

export interface SummarizerInstance {
    summarize(text: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
    summarizeStreaming(text: string, options?: { context?: string; signal?: AbortSignal }): AsyncIterable<string>;
    measureInputUsage?(text: string): Promise<number>;
    inputQuota?: number;
    destroy?(): void;
}

export async function createSummarizer({ type, length, sharedContext, onDownloadProgress, signal }: CreateSummarizerOptions): Promise<SummarizerInstance> {
    const Summarizer = getSummarizerClass();
    if (!Summarizer) {
        throw new Error('Chrome Summarizer API is not available.');
    }

    try {
        return await Summarizer.create({
            type,
            length,
            format: 'markdown',
            ...(sharedContext ? { sharedContext } : {}),
            ...(signal ? { signal } : {}),
            monitor(m: any) {
                m.addEventListener('downloadprogress', (e: any) => onDownloadProgress?.(progressFraction(e)));
            }
        });
    } catch (err: any) {
        if (err?.name === 'NotAllowedError') {
            throw new NeedsUserActivationError();
        }
        throw err;
    }
}
