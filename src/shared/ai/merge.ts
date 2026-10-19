/**
 * Pure helpers of AI Extract.
 *
 * - `mergeItems`: list items read chunk by chunk become one list (thenos `extract/schema.py`
 *   `merge_entities`): exact repeats are dropped (an item cut by a chunk boundary is read twice), and two
 *   items that agree on every field both have filled are folded together (one chunk saw the title,
 *   the next the price).
 * - `selectBlocks`: when the page doesn't fit one call, the blocks most about the requested fields
 *   (Okapi BM25 over the page's own blocks, thenos `variants/relevance.py`), kept in page order with
 *   the heading above each, within the budget.
 */
import { markdownBlocks } from '../markdown/chunks';

export interface MergeItem {
    values: Record<string, string>;
    /** The item's first block ref and the chunk it came from. */
    ref: string;
    chunk: number;
}

const norm = (v: string) => v.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function compatible(a: Record<string, string>, b: Record<string, string>): boolean {
    let shared = 0;
    for (const k of Object.keys(a)) {
        if (!a[k] || !b[k]) continue;
        if (norm(a[k]) !== norm(b[k])) return false;
        shared++;
    }
    return shared > 0;
}

export function mergeItems(items: MergeItem[]): MergeItem[] {
    const out: MergeItem[] = [];
    for (const item of items) {
        const same = out.find(o => compatible(o.values, item.values));
        if (!same) { out.push({ ...item, values: { ...item.values } }); continue; }
        for (const [k, v] of Object.entries(item.values)) if (v && !same.values[k]) same.values[k] = v;
    }
    return out;
}

const K1 = 1.2;
const B = 0.75;
const tokens = (text: string) => text.toLowerCase().replace(/\[b\d+\]/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];

export function selectBlocks(chunks: string[], terms: string, maxChars: number): string {
    const blocks = chunks.flatMap(c => markdownBlocks(c));
    const query = new Set(tokens(terms.replace(/_/g, ' ')).filter(t => t.length > 1));
    const docs = blocks.map(b => tokens(b));
    const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set(d)) if (query.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    const scores = docs.map(d => {
        let score = 0;
        for (const t of query) {
            const f = d.filter(x => x === t).length;
            if (!f) continue;
            const n = df.get(t) ?? 0;
            const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
            score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / (avg || 1)));
        }
        return score;
    });
    // The best blocks first, each with the heading it sits under; then back into page order.
    const ranked = blocks.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const keep = new Set<number>();
    let size = 0;
    const add = (i: number) => {
        if (keep.has(i) || size + blocks[i].length + 2 > maxChars) return false;
        keep.add(i);
        size += blocks[i].length + 2;
        return true;
    };
    for (const i of ranked) {
        if (size >= maxChars) break;
        if (!add(i)) continue;
        for (let h = i - 1; h >= 0; h--) if (/^#{1,6} /.test(blocks[h])) { add(h); break; }
    }
    return [...keep].sort((a, b) => a - b).map(i => blocks[i]).join('\n\n');
}
