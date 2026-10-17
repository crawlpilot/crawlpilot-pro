/**
 * Selector Lab (content side): evaluate a CSS/XPath selector on the live page, or pick an element and
 * get graded alternatives from each evidence family. Independent of the extraction picker so it can be
 * used on any page without starting a run.
 */
import { generateRobustSelectors } from '../../services/selectors/generate';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
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

export interface LabPick {
    tag: string;
    text: string;
    candidates: LabCandidate[];
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
    for (const r of generateRobustSelectors(el)) add(r.selector, r.strategy, false);
    for (const r of generateRobustSelectors(el, { isList: true })) add(r.selector, r.strategy, true);
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
        cb({ tag: el.tagName.toLowerCase(), text: sampleText(el), candidates: candidatesFor(el) });
    };

    private handleKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        const cb = this.onPick;
        this.stop();
        cb?.(null);
    };
}
