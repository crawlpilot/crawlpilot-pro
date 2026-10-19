/**
 * Compose: the live page as a detached copy the pipeline can cut, keeping only what a reader gets.
 *
 * The live DOM knows what served HTML can only guess, so this is where it is read:
 * - **Rendered only.** Elements that aren't rendered (`display: none`, `visibility: hidden`, `hidden`,
 *   `aria-hidden="true"` copies) are left out. Text the user can't see never reaches a model, which
 *   also removes most hidden-text prompt injection. Content of a closed `<details>` is kept: it is
 *   content, collapsed.
 * - **Floating chrome marked.** `position: fixed | sticky` blocks get `data-cp-pos`, so `fit` can drop
 *   cookie bars, sticky headers and chat launchers (`main.ts`).
 * - **Real URLs.** Links and images carry absolute URLs; an image's source is what the browser loaded
 *   (`currentSrc`), else the best lazy-loading source (`images.ts`).
 * - **Shadow DOM.** Open shadow roots are read as rendered: the shadow tree, with each `<slot>`
 *   replaced by what is assigned to it.
 * - **Live values.** Form controls carry their current value.
 *
 * Without layout (`live: false`, jsdom), only `hidden`, `aria-hidden` and inline styles are read.
 */
import { imageSource } from '../images/source';

export const POSITION_ATTRIBUTE = 'data-cp-pos';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'canvas', 'svg', 'head', 'link', 'meta', 'base', 'audio', 'video', 'source', 'track', 'map', 'dialog']);
const KEEP_ATTRIBUTES = [
    'id', 'class', 'role', 'title', 'alt', 'colspan', 'rowspan', 'start', 'reversed', 'lang',
    'data-lang', 'data-language', 'aria-label', 'type', 'datetime', 'display', 'encoding', 'open', 'name',
];

export interface ComposeOptions {
    /** Read layout (visibility, position, sizes). False in tests without layout. */
    live?: boolean;
    /** Keep each copy's source element (`sources`, indexed by `data-cp-src`): for block refs. */
    refs?: boolean;
}

export interface Composed {
    doc: Document;
    root: HTMLElement;
    /** Elements left out because they weren't rendered. */
    hidden: number;
    /** With `refs`: the live element of each copy, by its `data-cp-src` index. */
    sources: Element[];
}

export const SOURCE_ATTRIBUTE = 'data-cp-src';

function rendered(el: Element, inDetails: boolean, live: boolean): boolean {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (inDetails) return true;
    if ((el as HTMLElement).hidden) return false;
    if (!live) {
        // No layout: the inline style is all there is to read.
        const style = (el as HTMLElement).style;
        return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    }
    const check = (el as any).checkVisibility;
    if (typeof check === 'function') return check.call(el, { visibilityProperty: true });
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

/** The rendered children of `el`: its shadow tree with slots filled, or its own children. */
function renderedChildren(el: Element): Node[] {
    const shadow = (el as HTMLElement).shadowRoot;
    if (!shadow) return Array.from(el.childNodes);
    return Array.from(shadow.childNodes);
}

export function compose(source: Element | Document, options: ComposeOptions = {}): Composed {
    const live = options.live ?? true;
    const sourceDoc = source instanceof Document ? source : source.ownerDocument!;
    const start = source instanceof Document ? (source.body ?? source.documentElement) : source;
    const doc = sourceDoc.implementation.createHTMLDocument(sourceDoc.title);
    let hidden = 0;
    const sources: Element[] = [];

    const copy = (el: Element, inDetails: boolean, inFloating: boolean): Element | null => {
        const tag = el.localName;
        if (SKIP.has(tag)) return null;
        if (el !== start && !rendered(el, inDetails, live)) { hidden++; return null; }
        if (tag === 'slot') {
            // Rendered as what is assigned to it (or its fallback content).
            const wrapper = doc.createElement('span');
            const assigned = (el as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [];
            appendAll(wrapper, assigned.length ? assigned : Array.from(el.childNodes), inDetails, inFloating);
            return wrapper;
        }
        const out = doc.createElement(tag);
        if (options.refs) { out.setAttribute(SOURCE_ATTRIBUTE, String(sources.length)); sources.push(el); }
        for (const name of KEEP_ATTRIBUTES) {
            const v = el.getAttribute(name);
            if (v !== null) out.setAttribute(name, v);
        }
        if (tag === 'a') {
            const href = (el as HTMLAnchorElement).href;
            if (href && el.hasAttribute('href')) out.setAttribute('href', el.getAttribute('href')!.trim().startsWith('#') ? el.getAttribute('href')!.trim() : href);
        } else if (tag === 'img') {
            const src = imageSource(el as HTMLImageElement, live);
            if (src) out.setAttribute('src', src);
            const size = displayedSize(el, live);
            if (size.width !== undefined) out.setAttribute('width', String(size.width));
            if (size.height !== undefined) out.setAttribute('height', String(size.height));
        } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            const value = (el as HTMLInputElement).value;
            if (value && (el as HTMLInputElement).type !== 'password' && (el as HTMLInputElement).type !== 'hidden') out.setAttribute('value', value);
        }
        let floating = inFloating;
        if (live && !inFloating) {
            const position = el.ownerDocument.defaultView?.getComputedStyle(el).position;
            if (position === 'fixed' || position === 'sticky') { out.setAttribute(POSITION_ATTRIBUTE, position); floating = true; }
        }
        appendAll(out, renderedChildren(el), inDetails || (tag === 'details' && !(el as HTMLDetailsElement).open), floating);
        return out;
    };

    const appendAll = (parent: Element, nodes: Node[], inDetails: boolean, inFloating: boolean) => {
        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) parent.appendChild(doc.createTextNode(node.nodeValue ?? ''));
            else if (node.nodeType === Node.ELEMENT_NODE) {
                const child = copy(node as Element, inDetails, inFloating);
                if (child) parent.appendChild(child);
            }
        }
    };

    const root = copy(start, false, false) as HTMLElement ?? doc.createElement('body');
    doc.body.replaceWith(root.localName === 'body' ? root : wrapInBody(doc, root));
    return { doc, root: doc.body, hidden, sources };
}

function wrapInBody(doc: Document, el: Element): HTMLElement {
    const body = doc.createElement('body');
    body.appendChild(el);
    return body;
}

/** The size the image is shown at (live), else its declared width and height. */
function displayedSize(el: Element, live: boolean): { width?: number; height?: number } {
    if (live) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { width: Math.round(r.width), height: Math.round(r.height) };
    }
    const w = parseInt(el.getAttribute('width') ?? '', 10);
    const h = parseInt(el.getAttribute('height') ?? '', 10);
    return { ...(Number.isFinite(w) ? { width: w } : {}), ...(Number.isFinite(h) ? { height: h } : {}) };
}
