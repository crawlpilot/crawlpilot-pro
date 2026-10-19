/**
 * Structure-aware chunks of markdown, for a model with a context budget (thenos `variants/chunks.py`):
 *
 * 1. **Atomic blocks:** a heading, a fenced code block, a table, a list or a paragraph (blank lines
 *    separate them). A block is never split, except a table longer than the budget, which is split
 *    between rows with its header repeated in each part.
 * 2. **Greedy packing:** blocks join a chunk until the next would pass `maxChars`; a single block over
 *    the budget gets a chunk of its own (a soft limit).
 * 3. **Heading trail** (`trail`): a chunk starts with the headings above it
 *    (`(Section: Acme X-200 › Specifications)`, refs dropped), so a chunk that starts mid-section still
 *    knows what it is about (docs/plans/ai-extract-v2-plan.md §3.3).
 * 4. **Overlap** (`overlap`, lists): each chunk starts with the previous chunk's last block, so an item
 *    cut at a chunk edge is seen whole once; the list merge drops the duplicate.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** The markdown's blocks, in order. */
export function markdownBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    let current: string[] = [];
    let fence: string | null = null;
    const flush = () => { if (current.length) { blocks.push(current.join('\n')); current = []; } };
    for (const line of markdown.split('\n')) {
        const m = FENCE.exec(line);
        if (m) {
            const marker = m[1][0];
            if (fence === null) { flush(); fence = marker; } else if (marker === fence) fence = null;
            current.push(line);
            if (fence === null) flush();
            continue;
        }
        if (fence !== null) { current.push(line); continue; }
        if (!line.trim()) { flush(); continue; }
        current.push(line);
    }
    flush();
    return blocks;
}

function splitTable(table: string, maxChars: number): string[] {
    const lines = table.split('\n');
    const separator = lines.findIndex(l => /^\|( --- \|)+/.test(l));
    if (separator < 0) return [table];
    const head = lines.slice(0, separator + 1);
    const rows = lines.slice(separator + 1);
    const parts: string[] = [];
    let part: string[] = [];
    let size = head.join('\n').length;
    for (const row of rows) {
        if (part.length && size + row.length + 1 > maxChars) {
            parts.push([...head, ...part].join('\n'));
            part = [];
            size = head.join('\n').length;
        }
        part.push(row);
        size += row.length + 1;
    }
    if (part.length) parts.push([...head, ...part].join('\n'));
    return parts;
}

export interface ChunkOptions {
    trail?: boolean;
    /** Blocks repeated from the end of the previous chunk (0 or 1). */
    overlap?: number;
}

const HEADING = /^(#{1,6}) (.*)$/;
const plainHeading = (text: string) => text.replace(/\s*\[b\d+\]/g, '').replace(/[*_`]/g, '').trim();

/** The trail line for the headings `stack` (outermost first), or '' when there are none. */
export function trailLine(stack: string[]): string {
    return stack.length ? `(Section: ${stack.join(' › ')})` : '';
}

export function chunkMarkdown(markdown: string, maxChars: number, options: ChunkOptions = {}): string[] {
    const blocks = markdownBlocks(markdown).flatMap(b => (b.length > maxChars && b.startsWith('|') ? splitTable(b, maxChars) : [b]));
    const chunks: string[] = [];
    // The headings above the block being placed, by level.
    const stack: (string | undefined)[] = [];
    let current = '';
    let last = '';
    for (const block of blocks) {
        if (current && current.length + 2 + block.length > maxChars) {
            chunks.push(current);
            // A chunk starting with a heading keeps the headings above its level ("## Setup" under "# Intro").
            const starts = HEADING.exec(block.split('\n')[0]);
            const above = starts ? stack.slice(0, starts[1].length - 1) : stack;
            const trail = options.trail ? trailLine(above.filter((h): h is string => !!h)) : '';
            const carry = options.overlap && last && !HEADING.test(last) && trail.length + last.length + block.length + 4 <= maxChars ? last : '';
            current = [trail, carry].filter(Boolean).join('\n\n');
        }
        current = current ? `${current}\n\n${block}` : block;
        last = block;
        const h = HEADING.exec(block.split('\n')[0]);
        if (h) { stack.length = h[1].length - 1; stack[h[1].length - 1] = plainHeading(h[2]); }
    }
    if (current) chunks.push(current);
    return chunks;
}
