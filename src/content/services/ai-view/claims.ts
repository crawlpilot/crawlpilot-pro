/**
 * The Page assistant's citations on the page (docs/plans/summarize-ask-plan.md A2): checking what the
 * model said against the blocks of the last page view, and showing a cited block, its quote highlighted.
 */
import { checkClaims, type ClaimRequest, type ClaimResult } from '../../../shared/ai/cite';
import { viewBlocks } from './pageView';

const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

export function checkPageClaims(claims: ClaimRequest[]): ClaimResult[] {
    const blocks = new Map([...viewBlocks()].map(([ref, el]) => [ref, textOf(el)]));
    return checkClaims(claims, blocks);
}

const HIGHLIGHT = 'crawlpilot-cite';
const STYLE_ID = 'crawlpilot-cite-style';

/** The range of `quote` inside `el` (case, spacing and punctuation between words aside), or null. */
export function rangeOf(el: Element, quote: string): Range | null {
    const words = quote.match(/[\p{L}\p{N}$€£¥₹%.]+/gu)?.map(w => w.replace(/[.]+$/, '')).filter(Boolean) ?? [];
    if (words.length === 0) return null;
    // The text nodes and where each starts in the element's text.
    const nodes: { node: Text; from: number }[] = [];
    let whole = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ node: n as Text, from: whole.length });
        whole += n.textContent || '';
    }
    const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(words.map(escape).join('[^\\p{L}\\p{N}]*'), 'iu').exec(whole);
    if (!match) return null;
    const point = (pos: number): [Text, number] => {
        let i = nodes.length - 1;
        while (i > 0 && nodes[i].from > pos) i--;
        return [nodes[i].node, Math.min(pos - nodes[i].from, nodes[i].node.length)];
    };
    const range = document.createRange();
    range.setStart(...point(match.index));
    range.setEnd(...point(match.index + match[0].length));
    return range;
}

/** Scrolls to a cited block and highlights the quote (or the block) until the next citation is shown. */
export function showCitation(ref: string, quote?: string): boolean {
    const el = viewBlocks().get(ref);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const range = (quote && rangeOf(el, quote)) || (() => { const r = document.createRange(); r.selectNodeContents(el); return r; })();
    const css = (globalThis as any).CSS;
    if (css?.highlights && typeof (globalThis as any).Highlight === 'function') {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(250, 204, 21, 0.55); color: inherit; }`;
            document.head.appendChild(style);
        }
        css.highlights.set(HIGHLIGHT, new (globalThis as any).Highlight(range));
    }
    // A brief outline on the block too, so it is found when the quote is small.
    const box = el as HTMLElement;
    const before = box.style.outline;
    box.style.outline = '2px solid rgba(250, 204, 21, 0.9)';
    setTimeout(() => { box.style.outline = before; }, 2000);
    return true;
}

export function clearCitation() {
    (globalThis as any).CSS?.highlights?.delete(HIGHLIGHT);
}
