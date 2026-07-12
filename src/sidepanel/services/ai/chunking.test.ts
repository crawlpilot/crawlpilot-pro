import { describe, it, expect } from 'vitest';
import { splitIntoChunks, truncateAtBoundary, MAX_CHUNKS } from './chunking';

describe('truncateAtBoundary', () => {
    it('returns text unchanged when under the limit', () => {
        expect(truncateAtBoundary('short text', 100)).toBe('short text');
    });

    it('cuts at a sentence boundary', () => {
        const text = 'First sentence. Second sentence. Third sentence that is long.';
        const result = truncateAtBoundary(text, 40);
        expect(result).toBe('First sentence. Second sentence.');
    });

    it('falls back to a hard cut when no boundary exists in the back half', () => {
        const text = 'x'.repeat(200);
        expect(truncateAtBoundary(text, 50)).toHaveLength(50);
    });
});

describe('splitIntoChunks', () => {
    it('returns a single chunk when text fits', () => {
        const { chunks, truncated } = splitIntoChunks('hello world', 100);
        expect(chunks).toEqual(['hello world']);
        expect(truncated).toBe(false);
    });

    it('returns empty for blank input', () => {
        const { chunks, truncated } = splitIntoChunks('   ', 100);
        expect(chunks).toEqual([]);
        expect(truncated).toBe(false);
    });

    it('splits at paragraph boundaries when possible', () => {
        const para = 'word '.repeat(15).trim(); // ~74 chars
        const text = `${para}\n\n${para}\n\n${para}`;
        const { chunks, truncated } = splitIntoChunks(text, 100);
        expect(truncated).toBe(false);
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((c) => {
            expect(c.length).toBeLessThanOrEqual(100);
            expect(c.startsWith('word')).toBe(true);
        });
        expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
    });

    it('splits at sentence boundaries when no paragraph break exists', () => {
        const text = 'A sentence here. '.repeat(20).trim();
        const { chunks } = splitIntoChunks(text, 80);
        chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(80));
        expect(chunks.every((c) => c.endsWith('.'))).toBe(true);
    });

    it('hard-cuts unbreakable text without infinite looping', () => {
        const text = 'x'.repeat(250);
        const { chunks, truncated } = splitIntoChunks(text, 100);
        expect(truncated).toBe(false);
        expect(chunks.join('')).toHaveLength(250);
        chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(101));
    });

    it(`caps at ${MAX_CHUNKS} chunks and flags truncation`, () => {
        const text = ('paragraph text here.\n\n').repeat(50);
        const { chunks, truncated } = splitIntoChunks(text, 50);
        expect(chunks).toHaveLength(MAX_CHUNKS);
        expect(truncated).toBe(true);
    });
});
