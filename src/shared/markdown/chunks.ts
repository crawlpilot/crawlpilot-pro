/**
 * Structure-aware chunks of markdown, for a model with a context budget (thenos `variants/chunks.py`):
 *
 * 1. **Atomic blocks:** a heading, a fenced code block, a table, a list or a paragraph (blank lines
 *    separate them). A block is never split, except a table longer than the budget, which is split
 *    between rows with its header repeated in each part.
 * 2. **Greedy packing:** blocks join a chunk until the next would pass `maxChars`; a single block over
 *    the budget gets a chunk of its own (a soft limit).
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

export function chunkMarkdown(markdown: string, maxChars: number): string[] {
    const blocks = markdownBlocks(markdown).flatMap(b => (b.length > maxChars && b.startsWith('|') ? splitTable(b, maxChars) : [b]));
    const chunks: string[] = [];
    let current = '';
    for (const block of blocks) {
        if (current && current.length + 2 + block.length > maxChars) {
            chunks.push(current);
            current = '';
        }
        current = current ? `${current}\n\n${block}` : block;
    }
    if (current) chunks.push(current);
    return chunks;
}
