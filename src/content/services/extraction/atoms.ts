/**
 * Field atoms: the values a row holds, each read as one piece. A price split over inline tags
 * (`$<b>24</b><sup>99</sup>`) or a byline with a link (`By <a>Acme</a>`) is one atom, not three
 * columns; sibling spans that each hold their own value (`<span>Acme</span><span>$5</span>`) stay
 * separate. The same reading is used when the fields are inferred and on every run (`readRow`), so
 * inference and runs can never disagree about what a value is.
 */
import { shapeOf, Shape } from '../../../shared/extraction/shape';

export { shapeOf };
export type { Shape };
import { nodeStep, NodeStep, setStepCache } from './nodeName';

export type AtomAttr = 'text' | 'own' | 'cell' | 'href' | 'src' | 'aria-label' | 'title' | 'datetime';

export interface Atom {
    el: Element;
    attr: AtomAttr;
    value: string;
    /** Row-relative signature: stable node labels from the row to the element, plus the attribute. */
    sig: string;
    /** Elements from the row's child down to `el`. */
    path: Element[];
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'SELECT', 'OPTION', 'TEXTAREA', 'INPUT', 'OBJECT', 'LINK', 'META']);
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD', 'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR', 'IMG']);
/** Formatting tags: their text is a fragment of the parent's value, never a value of its own. */
const FORMATTING = new Set(['B', 'BR', 'WBR', 'DEL', 'EM', 'I', 'INS', 'MARK', 'S', 'SMALL', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'U', 'ABBR', 'IMG']);
/** Text that is only a piece of a number or price ("$", "24", ".99", "%"). */
const NUMBER_PIECE = /^[\p{Sc}\d.,\s%+\-/]*$/u;
/** A word that opens a price written in pieces ("Now" $ 519 99). "List:" with a colon is a label, kept apart. */
const PRICE_WORD = /^(now|from|was|sale|only|price|our price)$/i;
const MAX_VALUE = 1000;

export function isHidden(el: Element): boolean {
    const h = el as HTMLElement;
    if (h.hidden || h.style?.display === 'none' || h.style?.visibility === 'hidden') return true;
    // Chrome's native check is cheap. It also says "no box" for display:contents wrappers, whose
    // children do render, so those count as visible.
    if (typeof (h as any).checkVisibility === 'function') {
        if ((h as any).checkVisibility({ visibilityProperty: true })) return false;
        return getComputedStyle(h).display !== 'contents';
    }
    // offsetParent is null for display:none subtrees (and for fixed elements, and always in jsdom),
    // so only then pay for the computed style.
    if (h.offsetParent === null && el.tagName !== 'BODY') {
        const cs = getComputedStyle(h);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
}

function meaningful(text: string): boolean {
    return text.length > 1 || /[\p{L}\d]/u.test(text);
}

function collapse(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

/** Own text nodes only (a block that has text and block children). */
export function ownText(el: Element): string {
    let t = '';
    el.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) t += ` ${n.textContent}`; });
    return collapse(t).slice(0, MAX_VALUE);
}

/**
 * The text of an atom: inline pieces joined as written, `aria-hidden` duplicates skipped (Amazon's
 * visual price next to its screen-reader price), and `$24<sup>99</sup>` read as `$24.99`.
 */
export function atomText(el: Element): string {
    const read = (skipAriaHidden: boolean): string => {
        let out = '';
        const walk = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; return; }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const e = node as Element;
            if (SKIP.has(e.tagName)) return;
            if (skipAriaHidden && e.getAttribute('aria-hidden') === 'true') return;
            if (e.tagName === 'BR') { out += ' '; return; }
            // Cents in their own element after the whole number: `$24<sup>99</sup>`, `<span>519</span><span>99</span>`.
            if (e.tagName === 'SUP' || (e.tagName === 'SPAN' && e.previousElementSibling && /\d$/.test(e.previousElementSibling.textContent || ''))) {
                const cents = (e.textContent || '').trim();
                if (/^\d{2}$/.test(cents) && /\d$/.test(out.trimEnd()) && !/[.,]\d*$/.test(out.trimEnd())) {
                    out = out.trimEnd() + '.' + cents;
                    return;
                }
            }
            // "Now" then "$519": keep a word apart from the amount after it.
            if (/\p{L}$/u.test(out) && /^[\p{Sc}\d]/u.test((e.textContent || '').trim())) out += ' ';
            e.childNodes.forEach(walk);
        };
        walk(el);
        return collapse(out);
    };
    const visible = read(true);
    return (visible || read(false)).slice(0, MAX_VALUE);
}

/** Resolved URLs by base and raw value: a card repeats its product URL, and every read resolves it again. */
const resolved = new Map<string, string>();
let resolvedBase = '';

function absoluteUrl(raw: string | null): string {
    if (!raw) return '';
    const v = raw.trim();
    if (!v || /^(javascript:|#|data:|mailto:|tel:)/i.test(v)) return '';
    const base = document.baseURI;
    if (base !== resolvedBase || resolved.size > 5000) { resolved.clear(); resolvedBase = base; }
    let out = resolved.get(v);
    if (out === undefined) {
        try { out = new URL(v, base).href; } catch { out = ''; }
        resolved.set(v, out);
    }
    return out;
}

/** The largest candidate of a `srcset` (by width or density descriptor). */
function largestFromSrcset(srcset: string | null): string {
    if (!srcset) return '';
    let best = '';
    let bestScore = -1;
    for (const part of srcset.split(/,\s+(?=\S)/)) {
        const [url, desc = '1x'] = part.trim().split(/\s+/);
        const n = parseFloat(desc) * (desc.endsWith('x') ? 1000 : 1);
        if (url && n > bestScore) { bestScore = n; best = url; }
    }
    return best;
}

export function imageSrc(img: Element): string {
    const i = img as HTMLImageElement;
    const raw = img.getAttribute('src') || '';
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || '';
    const srcset = largestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
    // A data: placeholder means the real image is still lazy.
    const pick = (!raw || raw.startsWith('data:')) ? (lazy || srcset || i.currentSrc || '') : (srcset || raw);
    return absoluteUrl(pick);
}

/** Reads one attribute of one element the way inference read it. */
export function readValue(el: Element, attr: AtomAttr): string {
    switch (attr) {
        case 'text': case 'cell': return atomText(el);
        case 'own': return ownText(el);
        case 'href': return absoluteUrl(el.getAttribute('href'));
        case 'src': return imageSrc(el);
        default: return collapse(el.getAttribute(attr) || '').slice(0, MAX_VALUE);
    }
}

/**
 * True when `el`'s content is one value: all descendants are inline and either it has text of its
 * own next to them ("By <a>Acme</a>"), or every child is formatting or a piece of a number.
 */
let textAtomCache: WeakMap<Element, boolean> | null = null;

/**
 * Runs `fn` with `isTextAtom` and `nodeStep` memoised: inference and row reads ask about the same
 * nodes many times. Nested calls share the outermost cache, so wrap a whole batch of rows (a page)
 * to share it across them. The DOM must not change inside `fn`.
 */
export function withAtomCache<T>(fn: () => T): T {
    if (textAtomCache) return fn();
    scope++;
    textAtomCache = new WeakMap();
    atomsCache = new WeakMap();
    setStepCache(new WeakMap<Element, NodeStep>());
    try { return fn(); } finally { textAtomCache = null; atomsCache = null; setStepCache(null); }
}

let atomsCache: WeakMap<Element, Atom[]> | null = null;
let scope = 0;

/** The current `withAtomCache` scope (0 outside one): other per-scan caches key on it. */
export function atomScope(): number {
    return textAtomCache ? scope : 0;
}

export function isTextAtom(el: Element): boolean {
    const cached = textAtomCache?.get(el);
    if (cached !== undefined) return cached;
    const v = computeTextAtom(el);
    textAtomCache?.set(el, v);
    return v;
}

/** At most 16 descendants, all inline (or skipped). Stops at the first that isn't, without listing the subtree. */
function inlineOnly(el: Element): boolean {
    let seen = 0;
    const stack: Element[] = Array.from(el.children);
    while (stack.length > 0) {
        const d = stack.pop()!;
        if (++seen > 16 || (!INLINE.has(d.tagName) && !SKIP.has(d.tagName))) return false;
        for (let c = d.firstElementChild; c; c = c.nextElementSibling) stack.push(c);
    }
    return true;
}

function computeTextAtom(el: Element): boolean {
    if (el.children.length === 0) return true;
    if (!inlineOnly(el)) return false;
    if (meaningful(ownText(el))) return true;
    const children = Array.from(el.children);
    const plain = (c: Element) => FORMATTING.has(c.tagName) || c.getAttribute('aria-hidden') === 'true' || SKIP.has(c.tagName);
    const piece = (c: Element) => NUMBER_PIECE.test((c.textContent || '').trim());
    if (children.every(c => plain(c) || piece(c))) return true;
    // A price opened by a word: "Now" $ 519 99.
    return PRICE_WORD.test((children[0].textContent || '').trim()) && /\d/.test(el.textContent || '')
        && children.slice(1).every(c => plain(c) || piece(c));
}

/**
 * Whether `el` is where an atom of `attr` starts when `row` is walked: a text value is read from the
 * outermost element that holds it whole, so an inline piece inside it ("$" in "$24.99") is not one.
 */
export function isAtomRoot(el: Element, row: Element, attr: AtomAttr): boolean {
    if (attr !== 'text' && attr !== 'own') return true;
    const hidden = el.closest('[aria-hidden="true"]');
    if (hidden && !visualCopies(row).blocks.has(hidden)) return false;
    for (let p = el === row ? null : el.parentElement; p; p = p.parentElement) {
        if (isTextAtom(p)) return false;
        if (p === row) break;
    }
    return attr === 'text' ? isTextAtom(el) : !isTextAtom(el);
}

function sigOf(path: Element[], attr: AtomAttr): string {
    return `${path.map(e => nodeStep(e).label).join('>')}@${attr}`;
}

/** Text for screen readers only, by the usual class or test-id names (`sr-only`, `visually-hidden`, `a11y-text`). */
const SCREEN_READER_ONLY = /(^|[\s_-])(sr-only|screen-reader|visually-hidden|visuallyhidden|a11y|offscreen)([\s_-]|$)/i;

function isScreenReaderOnly(el: Element): boolean {
    return SCREEN_READER_ONLY.test(el.getAttribute('class') || '') || SCREEN_READER_ONLY.test(el.getAttribute('data-testid') || '');
}

const SCREEN_READER_CANDIDATES = '[class*="sr-only"], [class*="screen-reader"], [class*="isually"], [class*="a11y"], [class*="offscreen"], [data-testid*="a11y"]';
const digitsOf = (el: Element) => (el.textContent || '').replace(/\D/g, '');

/**
 * Pairs of a visual copy and its screen-reader sentence: an `aria-hidden` block (not a piece of one
 * value, like Amazon's `$24<sup>99</sup>` inside `.a-price`) whose numbers a screen-reader-only
 * element of the row repeats ("Now $519.99 · Was $799.99" and "Price Now $519.99 Was $799.99").
 */
function visualCopies(row: Element): { blocks: Set<Element>; sentences: Set<Element> } {
    const blocks = new Set<Element>();
    const sentences = new Set<Element>();
    const readers = Array.from(row.querySelectorAll(SCREEN_READER_CANDIDATES)).filter(isScreenReaderOnly);
    if (readers.length === 0) return { blocks, sentences };
    for (const h of Array.from(row.querySelectorAll('[aria-hidden="true"]'))) {
        if (h.parentElement && isTextAtom(h.parentElement)) continue;
        const digits = digitsOf(h);
        if (digits.length === 0) continue;
        const sentence = readers.find(r => digitsOf(r).includes(digits));
        if (sentence) { blocks.add(h); sentences.add(sentence); }
    }
    return { blocks, sentences };
}

/** Every atom of a row, in document order (memoised inside `withAtomCache`). */
export function collectAtoms(row: Element): Atom[] {
    const cached = atomsCache?.get(row);
    if (cached) return cached;
    const atoms = scanAtoms(row);
    atomsCache?.set(row, atoms);
    return atoms;
}

function scanAtoms(row: Element): Atom[] {
    const atoms: Atom[] = [];
    const add = (el: Element, attr: AtomAttr, value: string, path: Element[]) => {
        if (value) atoms.push({ el, attr, value, sig: sigOf(path, attr), path });
    };

    // Links, images and labelled icons inside a text atom still count on their own.
    const addInner = (el: Element, path: Element[]) => {
        if (el.tagName === 'A') add(el, 'href', readValue(el, 'href'), path);
        if (el.tagName === 'IMG') add(el, 'src', readValue(el, 'src'), path);
        if (el.tagName === 'TIME') add(el, 'datetime', readValue(el, 'datetime'), path);
        // A button's label describes the action ("Add to cart", "Save Lamp to list"), not the item.
        if (!(el.textContent || '').trim() && !el.closest('button, [role="button"]')) {
            for (const a of ['aria-label', 'title'] as const) {
                const v = readValue(el, a);
                if (v && meaningful(v)) { add(el, a, v, path); break; }
            }
        }
    };

    // A row with a visual copy of its values hidden from screen readers (`aria-hidden` around
    // "Now $519.99 · Was $799.99") and a sentence for them ("Price Now $519.99 Was $799.99"): the
    // visual copy keeps the values apart, so it is read and the screen-reader sentence is not.
    const copies = visualCopies(row);

    const walk = (el: Element, path: Element[]) => {
        if (SKIP.has(el.tagName) || isHidden(el) || copies.sentences.has(el)) return;
        // Other aria-hidden content is the visual copy of text screen readers get elsewhere in the
        // row (a "4.5" next to "4.5 out of 5 stars"): read only its images.
        if (el.getAttribute('aria-hidden') === 'true' && !copies.blocks.has(el)) {
            const imgs = el.tagName === 'IMG' ? [el] : Array.from(el.querySelectorAll('img'));
            imgs.forEach(img => {
                const chain: Element[] = [];
                for (let p: Element | null = img; p && p !== el; p = p.parentElement) chain.unshift(p);
                add(img, 'src', readValue(img, 'src'), [...path, ...chain]);
            });
            return;
        }
        addInner(el, path);
        if (el.tagName === 'IMG') return;

        if (isTextAtom(el)) {
            const text = atomText(el);
            if (meaningful(text)) add(el, 'text', text, path);
            el.querySelectorAll('a, img, time, [aria-label], [title]').forEach(inner => {
                const hidden = inner.closest('[aria-hidden="true"]');
                if (isHidden(inner) || (inner.tagName !== 'IMG' && hidden && el.contains(hidden))) return;
                const innerPath: Element[] = [...path];
                const chain: Element[] = [];
                for (let p: Element | null = inner; p && p !== el; p = p.parentElement) chain.unshift(p);
                addInner(inner, [...innerPath, ...chain]);
            });
            return;
        }

        const own = ownText(el);
        if (meaningful(own)) add(el, 'own', own, path);
        for (const child of Array.from(el.children)) walk(child, [...path, child]);
    };

    walk(row, []);
    return atoms;
}

/**
 * Assigns each of a row's repeated values to a slot of the template (the shapes of a full row), in
 * order. A row missing its first value ("Acme" absent) still puts "4.5" under the rating slot
 * instead of under the brand slot. Returns one slot index per value; values that don't fit get -1.
 */
export function alignToTemplate(shapes: Shape[], template: Shape[]): number[] {
    const out: number[] = [];
    let p = 0;
    for (let i = 0; i < shapes.length; i++) {
        const left = shapes.length - i;
        let q = p;
        while (q < template.length && template[q] !== shapes[i] && template.length - (q + 1) >= left) q++;
        if (q >= template.length || template[q] !== shapes[i]) q = p;
        out.push(q < template.length ? q : -1);
        p = q + 1;
    }
    return out;
}
