/**
 * Checking what the Page assistant says against the page (docs/plans/summarize-ask-plan.md A2).
 *
 * - A **brief point** comes with a short quote copied from the block it cites: the quote must be in
 *   that block (or, failing that, somewhere on the page).
 * - A **chat sentence** cites blocks with `[b12]` markers: its numbers must all be in the cited block,
 *   and most of its key words.
 *
 * Pure text functions: the content script runs them over the page's blocks.
 */

export type CiteStatus = 'verified' | 'relocated' | 'not_on_page' | 'unchecked';

export interface ClaimRequest {
    key: string;
    /** The claim in the model's words. */
    text: string;
    /** Copied from the page (brief points). */
    quote?: string;
    /** Blocks it cites (`b12`). */
    refs: string[];
}

export interface ClaimResult {
    key: string;
    status: CiteStatus;
    /** The block that supports it: a cited one, or another one where it was found. */
    ref?: string;
}

export function normText(s: string): string {
    return s.normalize('NFKC').toLowerCase().replace(/[“”«»„]/g, '"').replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}$€£¥₹%.,'"/-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const words = (s: string) => normText(s).split(' ').filter(Boolean);

/** Whether `quote` is in `text`: verbatim (case and spacing aside), or nearly all its words in order of appearance. */
export function quoteIn(quote: string, text: string): boolean {
    const q = normText(quote).replace(/[.,]+$/, '');
    if (q.length < 3) return false;
    const t = normText(text);
    if (t.includes(q)) return true;
    const qw = words(quote);
    if (qw.length < 4) return false;
    const tw = new Set(words(text));
    return qw.filter(w => tw.has(w.replace(/[.,]+$/, '')) || tw.has(w)).length >= qw.length * 0.85;
}

const STOP = new Set(('the a an and or but of to in on at for with by from as is are was were be been it its this that these those ' +
    'has have had not no yes can will would should could may might do does did than then there their they them you your our we ' +
    'about into over under also more most less very just only such page says said which who what when where how why all any each').split(' '));

/** Numbers in a text, as written without separators ("1,299.00" → "1299.00", "3 mph" → "3"). */
function numbers(s: string): string[] {
    return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => n.replace(/,/g, '').replace(/\.0+$/, ''));
}

/**
 * How well `text` (a block) supports `claim`: 0–1. Every number of the claim must be in the block
 * (else 0); then the share of its key words (≥ 4 letters, not stop words) the block has.
 */
export function claimSupport(claim: string, text: string): number {
    const blockNumbers = new Set(numbers(text));
    const claimNumbers = numbers(claim);
    if (claimNumbers.some(n => !blockNumbers.has(n) && ![...blockNumbers].some(b => b.replace(/\.0+$/, '') === n))) return 0;
    const key = [...new Set(words(claim).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(w => w.length >= 4 && !STOP.has(w)))];
    if (key.length === 0) return claimNumbers.length > 0 ? 1 : 0;
    const have = new Set(words(text).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')));
    // A word counts with a shared stem ("reviewers" / "reviews").
    const found = key.filter(w => have.has(w) || [...have].some(h => h.length >= 4 && (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5)))));
    return found.length / key.length;
}

/** A claim is supported by a block at this share of its key words (with all its numbers). */
export const SUPPORT = 0.5;

/** Checks claims against blocks (`ref → text`, in page order). */
export function checkClaims(claims: ClaimRequest[], blocks: Map<string, string>): ClaimResult[] {
    return claims.map(c => {
        if (c.quote && c.quote.trim()) {
            const cited = c.refs.find(r => blocks.has(r) && quoteIn(c.quote!, blocks.get(r)!));
            if (cited) return { key: c.key, status: 'verified', ref: cited };
            // Elsewhere: the smallest block that has it (a block inside a bigger one points at the spot).
            let found: { ref: string; length: number } | null = null;
            for (const [ref, text] of blocks) if ((!found || text.length < found.length) && quoteIn(c.quote, text)) found = { ref, length: text.length };
            return found ? { key: c.key, status: 'relocated', ref: found.ref } : { key: c.key, status: 'not_on_page' };
        }
        if (c.refs.length === 0 && numbers(c.text).length === 0 && words(c.text).length < 4) return { key: c.key, status: 'unchecked' };
        const cited = c.refs.find(r => blocks.has(r) && claimSupport(c.text, blocks.get(r)!) >= SUPPORT);
        if (cited) return { key: c.key, status: 'verified', ref: cited };
        let best: { ref: string; score: number; length: number } | null = null;
        for (const [ref, text] of blocks) {
            const score = claimSupport(c.text, text);
            if (score >= Math.max(SUPPORT, 0.7) && (!best || score > best.score || (score === best.score && text.length < best.length))) best = { ref, score, length: text.length };
        }
        return best ? { key: c.key, status: 'relocated', ref: best.ref } : { key: c.key, status: 'not_on_page' };
    });
}

/** `[b12]` / `[b12, b14]` markers in an answer. */
const MARKER = /\s?\[(b\d+(?:\s*,\s*b\d+)*)\]/g;

/** An answer's sentences with the blocks each cites (the markers after it). */
export function citedSentences(answer: string): { text: string; refs: string[] }[] {
    const out: { text: string; refs: string[] }[] = [];
    // Split after sentence ends and line breaks, keeping markers with the sentence before them.
    const parts = answer.split(/(?<=[.!?](?:\s?\[b\d+(?:\s*,\s*b\d+)*\])*)\s+|\n+/);
    for (const part of parts) {
        const refs = [...part.matchAll(MARKER)].flatMap(m => m[1].split(/\s*,\s*/));
        const text = part.replace(MARKER, '').replace(/^[\s*>#-]+/, '').trim();
        if (text) out.push({ text, refs });
    }
    return out;
}

/** The answer without its markers (for copying). */
export function stripMarkers(answer: string): string {
    return answer.replace(MARKER, '');
}
