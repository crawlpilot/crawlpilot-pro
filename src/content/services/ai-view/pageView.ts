/**
 * The page as AI Extract's model reads it, and the check of what the model answered.
 *
 * - **View:** the page as markdown (`services/markdown`, whole main content: listings need every item)
 *   with a ` [bN]` ref after each leaf block, cut into structure-aware chunks; plus the page's
 *   structured data for tier 0. The refs map back to live elements until the next view.
 * - **Grounding:** each answer is looked up in the block it cites (verified), in its list item's blocks
 *   (verified), or anywhere on the page (relocated); a value the page doesn't contain is `not_on_page`
 *   and is never shown as verified. Single fields can be compiled to selector chains, so the Page
 *   Extractor reruns them with no model.
 */
import { toMarkdown, type MarkdownOptions } from '../markdown';
import { chunkMarkdown } from '../../../shared/markdown/chunks';
import { elementChain } from '../selectors/element';
import { collectStructured } from '../../../shared/ai/structured';
import { isGrounded } from '../../../shared/ai/extractPrompt';
import { gradeSelector } from '../../../shared/selectors/grade';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import type { GroundRequest, Grounded, PageView } from '../../../shared/ai/page';

let refs = new Map<string, Element>();
let order: string[] = [];

export function buildPageView(chunkChars: number, maxChunks: number, options: { live?: boolean; markdown?: Pick<MarkdownOptions, 'reveal' | 'extra'> } = {}): PageView {
    const result = toMarkdown(document, { mode: 'markdown', refs: true, live: options.live ?? true, ...options.markdown });
    refs = result.refs ?? new Map();
    order = [...refs.keys()];
    const chunks = chunkMarkdown(result.markdown, Math.max(500, chunkChars));
    return {
        url: location.href,
        title: result.title,
        chunks: chunks.slice(0, maxChunks),
        truncated: chunks.length > maxChunks,
        structured: collectStructured(document),
    };
}

/** The blocks of the last view, `ref → element`, in page order (the Page assistant's citations). */
export function viewBlocks(): Map<string, Element> {
    return new Map(order.filter(r => refs.has(r)).map(r => [r, refs.get(r)!]));
}

function textOf(el: Element): string {
    if (el.tagName === 'IMG') return `${el.getAttribute('alt') || ''} ${(el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src}`;
    return (el as HTMLElement).innerText || el.textContent || '';
}

function urlMatches(value: string, url: string): boolean {
    if (!value || !url) return false;
    const strip = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    return strip(value) === strip(url) || url.includes(value);
}

/** Whether `el` holds `value`: its text, or for links and images their URL (or an image's alt). */
function holds(el: Element, req: GroundRequest): boolean {
    if (req.type === 'image') {
        const imgs = el.tagName === 'IMG' ? [el as HTMLImageElement] : Array.from(el.querySelectorAll('img'));
        return imgs.some(img => urlMatches(req.value, img.currentSrc || img.src) || isGrounded(req.value, img.alt));
    }
    if (req.type === 'url') {
        const links = el.tagName === 'A' ? [el as HTMLAnchorElement] : Array.from(el.querySelectorAll('a'));
        if (links.some(a => urlMatches(req.value, a.href))) return true;
    }
    return isGrounded(req.value, textOf(el));
}

function count(selector: string): number {
    try {
        if (looksLikeXPath(selector)) return document.evaluate(`count(${selector})`, document, null, XPathResult.NUMBER_TYPE, null).numberValue;
        return document.querySelectorAll(selector).length;
    } catch { return 0; }
}

/** Blocks an item spans when the next item is unknown. */
const ITEM_BLOCKS = 12;

function locate(req: GroundRequest): { el: Element; status: 'verified' | 'relocated' } | null {
    const cited = req.ref ? refs.get(req.ref) : undefined;
    if (cited && holds(cited, req)) return { el: cited, status: 'verified' };
    if (req.within) {
        const from = order.indexOf(req.within[0]);
        const to = req.within[1] ? order.indexOf(req.within[1]) : -1;
        if (from >= 0) {
            for (const key of order.slice(from, to > from ? to : from + ITEM_BLOCKS)) {
                const el = refs.get(key)!;
                if (holds(el, req)) return { el, status: 'verified' };
            }
        }
    }
    // Anywhere on the page: the most specific block that holds it.
    const hits = [...refs.values()].filter(el => holds(el, req)).sort((a, b) => textOf(a).length - textOf(b).length);
    return hits[0] ? { el: hits[0], status: 'relocated' } : null;
}

export function ground(requests: GroundRequest[]): Grounded[] {
    return requests.map(req => {
        const base: Grounded = { key: req.key, status: 'empty', type: 'text', selectors: [], matchCount: 0 };
        if (!req.value.trim()) return base;
        const found = locate(req);
        if (!found) return { ...base, status: 'not_on_page' };

        let target = found.el as HTMLElement;
        let type: Grounded['type'] = 'text';
        if (req.type === 'image') {
            const img = (target.tagName === 'IMG' ? target : target.querySelector('img')) as HTMLImageElement | null;
            if (img) { target = img; type = 'image'; }
        } else if (req.type === 'url') {
            const link = (target.closest('a') || target.querySelector('a')) as HTMLAnchorElement | null;
            if (link) { target = link; type = 'link'; }
        } else {
            // The smallest element under the block that still holds the value (a price inside a row).
            const inner = Array.from(target.querySelectorAll('*'))
                .filter(e => isGrounded(req.value, textOf(e)))
                .sort((a, b) => textOf(a).length - textOf(b).length)[0];
            if (inner) target = inner as HTMLElement;
        }
        const pageValue = type === 'image' ? ((target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src)
            : type === 'link' ? (target as HTMLAnchorElement).href
                : (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
        if (!req.compile) return { ...base, status: found.status, type, pageValue };
        const selectors = elementChain(target).map(c => c.selector);
        const matchCount = selectors[0] ? count(selectors[0]) : 0;
        return { ...base, status: found.status, type, pageValue, selectors, matchCount, grade: selectors[0] ? gradeSelector(selectors[0], matchCount, 1) : undefined };
    });
}
