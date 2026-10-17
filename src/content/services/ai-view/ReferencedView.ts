/**
 * A compact, referenced view of the page for the on-device model: one line per visible text-bearing
 * element, prefixed with [eN]. Each ref maps back to the live element, so a model answer can be
 * checked against the page (grounding) and turned into selectors for runs that need no model.
 */
import { elementChain } from '../selectors/element';
import { isGrounded } from '../../../shared/ai/extractPrompt';
import { gradeSelector, GradedSelector } from '../../../shared/selectors/grade';
import { looksLikeXPath } from '../../../shared/selectors/resolve';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'SELECT', 'OPTION', 'TEXTAREA']);
const BOILERPLATE = 'nav, footer, [role="navigation"], [role="contentinfo"], [aria-hidden="true"], [hidden], dialog:not([open])';
const MAX_LINE = 200;

let refMap = new Map<string, Element>();

function isVisible(el: Element): boolean {
    const h = el as HTMLElement;
    if (h.offsetParent === null && getComputedStyle(h).position !== 'fixed') return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function ownText(el: Element): string {
    let t = '';
    el.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) t += n.textContent; });
    return t.replace(/\s+/g, ' ').trim();
}

/** Inline wrappers whose text belongs to the parent line ("<b>$</b>24<sup>99</sup>"). */
function hasOnlyInlineChildren(el: Element): boolean {
    return Array.from(el.children).every(c => /^(B|I|EM|STRONG|SPAN|SUP|SUB|SMALL|MARK|ABBR|BR|S|DEL|INS|U|CODE)$/.test(c.tagName) && c.children.length === 0);
}

export interface ViewResult {
    view: string;
    refs: number;
    truncated: boolean;
}

export function buildReferencedView(maxChars = 12000): ViewResult {
    refMap = new Map();
    const root = (document.querySelector('main, [role="main"], article') as Element | null) ?? document.body;
    const lines: string[] = [];
    const seenText = new Set<string>();
    let size = 0;
    let n = 0;
    let truncated = false;

    const push = (el: Element, text: string, tag: string) => {
        const key = `${tag}|${text}`;
        if (seenText.has(key)) return;
        seenText.add(key);
        const ref = `e${++n}`;
        refMap.set(ref, el);
        const line = `[${ref}] ${tag ? `<${tag}> ` : ''}${text.slice(0, MAX_LINE)}`;
        if (size + line.length + 1 > maxChars) { truncated = true; return; }
        lines.push(line);
        size += line.length + 1;
    };

    const walk = (el: Element) => {
        if (truncated || SKIP_TAGS.has(el.tagName)) return;
        if (el !== root && el.matches(BOILERPLATE)) return;
        if (!isVisible(el)) return;
        const tag = el.tagName.toLowerCase();

        if (tag === 'img') {
            const alt = (el.getAttribute('alt') || '').trim();
            const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
            if (src && (el as HTMLImageElement).width >= 60) push(el, `image${alt ? ` "${alt.slice(0, 80)}"` : ''}`, 'img');
            return;
        }
        if (/^(h[1-6]|p|li|td|th|dt|dd|label|a|button|span|div|strong|b|time|figcaption|caption|small|em|meta)$/.test(tag)) {
            const text = hasOnlyInlineChildren(el) && el.children.length > 0
                ? (el.textContent || '').replace(/\s+/g, ' ').trim()
                : ownText(el);
            if (text && text.length > 0) {
                const label = /^h[1-6]$|^a$|^button$|^time$|^li$|^td$|^th$|^dt$|^dd$|^label$/.test(tag) ? tag : '';
                push(el, text, label);
                if (hasOnlyInlineChildren(el)) return;
            }
        }
        for (const child of Array.from(el.children)) walk(child);
    };
    walk(root);
    return { view: lines.join('\n'), refs: n, truncated };
}

export interface VerifiedField {
    name: string;
    value: string;
    ref: string;
    status: 'verified' | 'relocated' | 'not_on_page' | 'empty';
    /** Page Extractor element type. */
    type: 'text' | 'link' | 'image';
    selectors: { type: 'css' | 'xpath'; value: string }[];
    matchCount: number;
    grade?: GradedSelector;
    /** The value the selector reads now (what bulk runs will get). */
    preview?: string;
}

function elementText(el: Element): string {
    if (el.tagName === 'IMG') return `${el.getAttribute('alt') || ''} ${(el as HTMLImageElement).src}`;
    return (el as HTMLElement).innerText || el.textContent || '';
}

function count(selector: string): number {
    try {
        if (looksLikeXPath(selector)) {
            return document.evaluate(`count(${selector})`, document, null, XPathResult.NUMBER_TYPE, null).numberValue;
        }
        return document.querySelectorAll(selector).length;
    } catch { return 0; }
}

/** Checks each model answer against its referenced element and compiles a selector for it. */
export function verifyAndCompile(answers: { name: string; value: string; ref: string; wantType: string }[]): VerifiedField[] {
    return answers.map(a => {
        const base: VerifiedField = { name: a.name, value: a.value, ref: a.ref, status: 'empty', type: 'text', selectors: [], matchCount: 0 };
        if (!a.value && !a.ref) return base;

        let el: Element | undefined = a.ref ? refMap.get(a.ref) : undefined;
        let status: VerifiedField['status'] = 'verified';
        const isMedia = a.wantType === 'image';
        if (!el || (!isMedia && !isGrounded(a.value, elementText(el)))) {
            // The ref was wrong: look for the one line that holds the value.
            el = undefined;
            if (a.value) {
                const hits = Array.from(refMap.entries()).filter(([, e]) => isGrounded(a.value, elementText(e)));
                // Prefer the most specific element (shortest text).
                hits.sort((x, y) => elementText(x[1]).length - elementText(y[1]).length);
                if (hits[0]) { el = hits[0][1]; status = 'relocated'; }
            }
        }
        if (!el) return { ...base, status: a.value ? 'not_on_page' : 'empty' };

        let target = el as HTMLElement;
        let type: VerifiedField['type'] = 'text';
        if (target.tagName === 'IMG' || a.wantType === 'image') {
            const img = target.tagName === 'IMG' ? target : target.querySelector('img');
            if (img) { target = img as HTMLElement; type = 'image'; }
        } else if (a.wantType === 'url') {
            const link = target.closest('a') || target.querySelector('a');
            if (link) { target = link as HTMLElement; type = 'link'; }
        }

        const chain = elementChain(target);
        const css = chain.find(c => !looksLikeXPath(c.selector))?.selector;
        const xpath = chain.find(c => looksLikeXPath(c.selector))?.selector;
        const selectors: VerifiedField['selectors'] = [];
        if (css) selectors.push({ type: 'css', value: css });
        if (xpath) selectors.push({ type: 'xpath', value: xpath });
        const primary = css || xpath;
        const matchCount = primary ? count(primary) : 0;
        const preview = type === 'image' ? (target as HTMLImageElement).src : type === 'link' ? (target as HTMLAnchorElement).href : (target.innerText || target.textContent || '').trim().slice(0, 200);
        return {
            ...base,
            status,
            type,
            selectors,
            matchCount,
            grade: primary ? gradeSelector(primary, matchCount, 1) : undefined,
            preview,
        };
    });
}
