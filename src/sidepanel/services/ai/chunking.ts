// Caps the map pass of long-document summarization: each chunk costs a full
// model round trip (~5-10s on-device), so 6 keeps worst-case latency ~1 min.
export const MAX_CHUNKS = 6;

export interface ChunkResult {
    chunks: string[];
    truncated: boolean;
}

// Truncate on a sentence/paragraph boundary rather than mid-word, so the
// model doesn't receive a fact cut off halfway through.
export function truncateAtBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastBoundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
    return lastBoundary > maxChars * 0.5 ? slice.slice(0, lastBoundary + 1) : slice;
}

// Splits text into chunks of at most maxCharsPerChunk, preferring paragraph
// breaks, then line breaks, then sentence ends, so no chunk starts or ends
// mid-thought. Anything past MAX_CHUNKS is dropped and flagged.
export function splitIntoChunks(text: string, maxCharsPerChunk: number): ChunkResult {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { chunks: [], truncated: false };
    if (trimmed.length <= maxCharsPerChunk) return { chunks: [trimmed], truncated: false };

    const chunks: string[] = [];
    let rest = trimmed;

    while (rest.length > 0) {
        if (chunks.length === MAX_CHUNKS) {
            return { chunks, truncated: true };
        }
        if (rest.length <= maxCharsPerChunk) {
            chunks.push(rest);
            break;
        }

        const window = rest.slice(0, maxCharsPerChunk);
        let cut = window.lastIndexOf('\n\n');
        if (cut < maxCharsPerChunk * 0.5) cut = window.lastIndexOf('\n');
        if (cut < maxCharsPerChunk * 0.5) cut = window.lastIndexOf('. ');
        if (cut < maxCharsPerChunk * 0.5) cut = maxCharsPerChunk;

        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
    }

    return { chunks, truncated: false };
}
