/**
 * Selector Lab (content side): evaluate a CSS/XPath selector on the live page, or pick an element and
 * get graded alternatives from each evidence family. Independent of the extraction picker so it can be
 * used on any page without starting a run.
 */
import { elementCandidates, elementChain } from '../../services/selectors/element';
import { listLocators } from '../../services/selectors/list';
import { looksLikeXPath, resolveContainer, resolveItems, resolveOne } from '../../../shared/selectors/resolve';
import { gradeSelector, GradedSelector } from '../../../shared/selectors/grade';
import { sanitizeCssSelector } from '../../../shared/selectors/sanitize';

export interface LabEval {
    selector: string;
    kind: 'css' | 'xpath';
    count: number;
    error?: string;
    samples: string[];
    grade: GradedSelector;
}

export interface LabCandidate extends LabEval {
    strategy: string;
    /** True when the selector targets every similar element, not just the picked one. */
    list: boolean;
}

/** One entry of a chain a recipe would store, and whether a run on this page would use it. */
export interface LabChainEntry {
    selector: string;
    family: string;
    count: number;
    grade: GradedSelector;
    /** The entry the run's resolver picks on this page (the first that answers; a later one means the earlier ones broke). */
    wins: boolean;
}

export interface LabPick {
    tag: string;
    text: string;
    candidates: LabCandidate[];
    /** The chain a Page Extractor pick of this element stores. */
    stored: LabChainEntry[];
    /** When the element is one of a list's items: the container and item chains a list pick stores. */
    storedList?: { container: LabChainEntry[]; items: LabChainEntry[] };
}

const OVERLAY_CLASS = 'crawlpilot-lab-overlay';
const HOVER_ID = 'crawlpilot-lab-hover';

function query(selector: string): { elements: Element[]; error?: string } {
    const s = selector.trim();
    try {
        if (looksLikeXPath(s)) {
            const r = document.evaluate(s, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const out: Element[] = [];
            for (let i = 0; i < r.snapshotLength; i++) {
                const n = r.snapshotItem(i);
                if (n instanceof Element) out.push(n);
            }
            return { elements: out };
        }
        return { elements: Array.from(document.querySelectorAll(sanitizeCssSelector(s))) };
    } catch (e: any) {
        return { elements: [], error: e?.message || 'Invalid selector' };
    }
}

function sampleText(el: Element): string {
    const t = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 140);
    const attr = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('content') || el.getAttribute('value') || '';
    return attr ? `[${el.tagName.toLowerCase()}] ${attr.slice(0, 120)}` : `<${el.tagName.toLowerCase()}>`;
}

export function evaluateSelector(selector: string, expected?: number): LabEval {
    const { elements, error } = query(selector);
    return {
        selector,
        kind: looksLikeXPath(selector.trim()) ? 'xpath' : 'css',
        count: elements.length,
        error,
        samples: elements.slice(0, 5).map(sampleText),
        grade: error ? { grade: 'broken', reason: error, family: 'structure' } : gradeSelector(selector, elements.length, expected),
    };
}

export function clearLabHighlights() {
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(n => n.remove());
}

export function highlightSelector(selector: string): number {
    clearLabHighlights();
    const { elements } = query(selector);
    elements.slice(0, 300).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const box = document.createElement('div');
        box.className = OVERLAY_CLASS;
        box.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;` +
            'border:2px solid #f59e0b;background:rgba(245,158,11,0.12);border-radius:3px;pointer-events:none;z-index:2147483646;';
        if (i < 99) {
            const tag = document.createElement('span');
            tag.textContent = String(i + 1);
            tag.style.cssText = 'position:absolute;top:-9px;left:-9px;background:#f59e0b;color:#111;font:600 10px/16px system-ui;padding:0 4px;border-radius:8px;';
            box.appendChild(tag);
        }
        document.body.appendChild(box);
    });
    elements[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return elements.length;
}

/**
 * Document-wide selectors for the element and its look-alike siblings: the list's container chain
 * joined with its item chain.
 */
function listSelectors(el: HTMLElement): { selector: string; strategy: string }[] {
    const parent = el.parentElement;
    if (!parent) return [];
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName) as HTMLElement[];
    if (siblings.length < 2) return [];
    const { container, items } = listLocators(parent, siblings);
    const cssContainer = container.find(c => !looksLikeXPath(c.selector))?.selector;
    const xpathContainer = container.find(c => looksLikeXPath(c.selector))?.selector;
    return items.flatMap(item => {
        if (looksLikeXPath(item.selector)) return xpathContainer ? [{ selector: `${xpathContainer}${item.selector.slice(1)}`, strategy: item.strategy }] : [];
        if (!cssContainer) return [];
        const own = item.selector.replace(/^:scope\s*>\s*/, '');
        return [{ selector: `${cssContainer}${own === item.selector ? ' ' : ' > '}${own}`, strategy: item.strategy }];
    });
}

function chainEntries(chain: { selector: string; strategy: string }[], used: number, root: ParentNode, expected?: number): LabChainEntry[] {
    return chain.map((c, i) => {
        let count = 0;
        try {
            if (looksLikeXPath(c.selector)) {
                count = document.evaluate(c.selector, root as Node, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
            } else {
                count = root.querySelectorAll(sanitizeCssSelector(c.selector)).length;
            }
        } catch { /* invalid: count 0 */ }
        return { selector: c.selector, family: c.strategy, count, grade: gradeSelector(c.selector, count, expected), wins: i === used };
    });
}

/** What a recipe would store for the element, and which entry a run would use on this page. */
export function storedFor(el: HTMLElement): Pick<LabPick, 'stored' | 'storedList'> {
    const chain = elementChain(el);
    const stored = chainEntries(chain, resolveOne(chain.map(c => c.selector)).used, document, 1);
    const parent = el.parentElement;
    const siblings = parent ? Array.from(parent.children).filter(c => c.tagName === el.tagName) as HTMLElement[] : [];
    if (!parent || siblings.length < 2) return { stored };
    const { container, items } = listLocators(parent, siblings);
    const found = resolveContainer(container.map(c => c.selector), items.map(c => c.selector));
    const root = found.result ?? parent;
    return {
        stored,
        storedList: {
            container: chainEntries(container, found.used, document, 1),
            items: chainEntries(items, resolveItems(items.map(c => c.selector), root).used, root),
        },
    };
}

export function candidatesFor(el: HTMLElement): LabCandidate[] {
    const out: LabCandidate[] = [];
    const seen = new Set<string>();
    const add = (selector: string, strategy: string, list: boolean) => {
        if (!selector || seen.has(selector)) return;
        seen.add(selector);
        const ev = evaluateSelector(selector, list ? undefined : 1);
        if (ev.count === 0) return;
        if (list && ev.count < 2) return;
        out.push({ ...ev, strategy, list });
    };
    for (const r of elementCandidates(el)) add(r.selector, r.strategy, false);
    for (const r of listSelectors(el)) add(r.selector, r.strategy, true);
    const order = { strong: 0, fragile: 1, broken: 2 };
    return out.sort((a, b) => Number(a.list) - Number(b.list) || order[a.grade.grade] - order[b.grade.grade]);
}

/** One-shot element picker: hover outlines, click picks, Escape cancels. */
export class LabPicker {
    private active = false;
    private onPick: ((pick: LabPick | null) => void) | null = null;

    start(onPick: (pick: LabPick | null) => void) {
        this.stop();
        this.active = true;
        this.onPick = onPick;
        document.addEventListener('mousemove', this.handleMove, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('keydown', this.handleKey, true);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        document.removeEventListener('mousemove', this.handleMove, true);
        document.removeEventListener('click', this.handleClick, true);
        document.removeEventListener('keydown', this.handleKey, true);
        document.getElementById(HOVER_ID)?.remove();
    }

    private handleMove = (e: MouseEvent) => {
        const el = e.target as HTMLElement;
        if (!el || el.id === HOVER_ID) return;
        const r = el.getBoundingClientRect();
        let box = document.getElementById(HOVER_ID);
        if (!box) {
            box = document.createElement('div');
            box.id = HOVER_ID;
            document.body.appendChild(box);
        }
        box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
            'outline:2px dashed #f59e0b;background:rgba(245,158,11,0.08);pointer-events:none;z-index:2147483647;';
    };

    private handleClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.target as HTMLElement;
        const cb = this.onPick;
        this.stop();
        if (!el || !cb) return;
        cb({ tag: el.tagName.toLowerCase(), text: sampleText(el), candidates: candidatesFor(el), ...storedFor(el) });
    };

    private handleKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        const cb = this.onPick;
        this.stop();
        cb?.(null);
    };
}
