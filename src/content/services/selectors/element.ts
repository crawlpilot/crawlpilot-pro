/**
 * Selectors for one element (a Page Extractor field, a container, a control): what it *is*, not
 * where it sits. Candidates are built from the element's own names (id, author hooks, other stable
 * attributes, naming classes, a unique tag), scoped under a named ancestor when they aren't unique
 * alone, plus label XPaths for values next to their label and, for controls only, their text. Each
 * is kept only when it names the element alone in its document; they are ranked by `selectorCost`.
 *
 * | Kind     | Example                                                           | Cost       |
 * |----------|-------------------------------------------------------------------|-----------:|
 * | test id  | `[data-testid="price"]`                                            | 1          |
 * | label    | `//th[normalize-space()="Weight"]/following-sibling::td[1]`        | 100        |
 * | id       | `#corePrice_feature_div`                                           | 150        |
 * | attribute| `input[name="q"]`, `[itemprop="price"]`                            | 200        |
 * | text     | `//a[normalize-space()="Next"]` (controls only, never values)      | 300+       |
 * | class    | `span.a-price`                                                     | 400        |
 * | scoped   | `#productTitle_feature_div h1`, `[data-testid="buybox"] .price`    | + 50 + 1/10 of the scope |
 * | position | `#results > div:nth-of-type(3) > a` (only when nothing else names it) | + 10,000 |
 *
 * Every CSS candidate has an XPath twin, so a chain can hold both and they fail independently.
 */
import { selectorCost, selectorFamily } from '../../../shared/selectors/grade';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import {
    AUTHOR_ATTRIBUTES, isNamingClass, isStableAttributeValue, isStableId, xpathLiteral,
} from '../../../shared/selectors/stability';

export interface ChainEntry {
    selector: string;
    /** The evidence it rests on (`test id`, `id`, `label`, `attribute`, `text`, `class`, `structure`, `xpath`). */
    strategy: string;
}

interface Part {
    css: string;
    /** The same test as an XPath predicate. */
    xp: string;
}

const MAX_CHAIN = 3;
const MAX_SCOPE_LEVELS = 7;
const MAX_LABEL_LEVELS = 2;
/** Candidates checked against the page per element. */
const MAX_CHECKS = 40;
const NAMING_ATTRIBUTES = [...AUTHOR_ATTRIBUTES, 'name', 'aria-label', 'title', 'alt', 'placeholder', 'for', 'role', 'type', 'rel'];
/** A tag's own role: `button[role="button"]` says nothing a bare `button` does not. */
const IMPLICIT_ROLES: Record<string, string> = {
    a: 'link', button: 'button', li: 'listitem', ul: 'list', ol: 'list', nav: 'navigation', table: 'table', tr: 'row',
    td: 'cell', img: 'img', main: 'main', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
};

const tagOf = (el: Element) => el.tagName.toLowerCase();
const normalizeSpace = (t: string | null | undefined) => (t ?? '').replace(/[ \t\n\r]+/g, ' ').trim();

function cssAttr(attr: string, value: string): string {
    return `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/** Short words, no price or count: text that labels a value rather than being one. */
function isLabelText(text: string): boolean {
    return text.length >= 1 && text.length <= 40 && text.split(' ').length <= 6
        && /\p{L}/u.test(text) && !/\p{Sc}/u.test(text) && !/\d{3}/.test(text);
}

/**
 * An element that labels the one after it: a header cell, a term, a label, a heading, a row's first
 * cell, or any short text ending in a colon ("Model:"). A sibling list item or section is a value.
 */
function isLabelElement(el: Element): boolean {
    if (/^(TH|DT|LABEL|LEGEND|H[1-6])$/.test(el.tagName)) return true;
    if (el.tagName === 'TD') return el.previousElementSibling === null;
    return /:\s*$/.test(normalizeSpace(el.textContent));
}

/** The element's own names: stable id, author and naming attributes, naming classes. */
function partsOf(el: Element): Part[] {
    const parts: Part[] = [];
    if (isStableId(el.id)) parts.push({ css: `#${CSS.escape(el.id)}`, xp: `@id=${xpathLiteral(el.id)}` });
    const data = el.getAttributeNames().filter(n => n.startsWith('data-') && !NAMING_ATTRIBUTES.includes(n));
    for (const attr of [...NAMING_ATTRIBUTES, ...data]) {
        const value = el.getAttribute(attr);
        if (!value || !isStableAttributeValue(attr, value)) continue;
        if (attr === 'role' && IMPLICIT_ROLES[tagOf(el)] === value) continue;
        parts.push({ css: cssAttr(attr, value), xp: `@${attr}=${xpathLiteral(value)}` });
    }
    const classes = Array.from(el.classList).filter(c => isNamingClass(c, el.ownerDocument ?? document)).slice(0, 4);
    for (const c of classes) {
        parts.push({ css: `.${CSS.escape(c)}`, xp: `contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')` });
    }
    if (classes.length >= 2) {
        parts.push({
            css: `.${CSS.escape(classes[0])}.${CSS.escape(classes[1])}`,
            xp: `contains(concat(' ', normalize-space(@class), ' '), ' ${classes[0]} ') and contains(concat(' ', normalize-space(@class), ' '), ' ${classes[1]} ')`,
        });
    }
    return parts;
}

/** Named ancestors to scope under, nearest first: their best part (stable id or author hook first). */
function scopesOf(el: Element): Part[] {
    const out: Part[] = [];
    let a = el.parentElement;
    for (let level = 0; a && a !== a.ownerDocument.body && level < MAX_SCOPE_LEVELS; level++, a = a.parentElement) {
        const best = partsOf(a).sort((x, y) => selectorCost(x.css) - selectorCost(y.css))[0];
        if (best) out.push({ css: `${/^[#[]/.test(best.css) ? '' : tagOf(a)}${best.css}`, xp: `${tagOf(a)}[${best.xp}]` });
    }
    return out;
}

/** A value next to its label: `th`→`td`, `dt`→`dd`, a label span before a value span. */
function labelXPaths(el: Element): string[] {
    const out: string[] = [];
    let cell: Element | null = el;
    for (let level = 0; cell && level <= MAX_LABEL_LEVELS; level++, cell = cell.parentElement) {
        const label = cell.previousElementSibling;
        if (!label || !isLabelElement(label)) continue;
        const text = normalizeSpace(label.textContent);
        if (!isLabelText(text) || text === normalizeSpace(cell.textContent)) continue;
        const below = cell === el ? '' : `//${tagOf(el)}`;
        out.push(`//${tagOf(label)}[normalize-space()=${xpathLiteral(text)}]/following-sibling::${tagOf(cell)}[1]${below}`);
    }
    const id = el.id;
    if (id) {
        const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
        const text = normalizeSpace(forLabel?.textContent);
        if (forLabel && isLabelText(text)) out.push(`//*[@id=//label[normalize-space()=${xpathLiteral(text)}]/@for]`);
    }
    return out;
}

/**
 * A path with positions, the last resort: from the nearest named ancestor (stable id or attribute)
 * that makes it unique, else from the body. Positions only where siblings share a tag.
 */
function anchoredPath(el: Element): { css: string; xpath: string } {
    const steps: { tag: string; nth: number; many: boolean }[] = [];
    const css = () => steps.map(s => `${s.tag}${s.many ? `:nth-of-type(${s.nth})` : ''}`).join(' > ');
    const xpath = () => steps.map(s => `${s.tag}${s.many ? `[${s.nth}]` : ''}`).join('/');
    const body = el.ownerDocument.body;
    let node: Element = el;
    while (node !== body && node.parentElement) {
        const parent: Element = node.parentElement;
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        steps.unshift({ tag: tagOf(node), nth: same.indexOf(node) + 1, many: same.length > 1 });
        if (parent === body) break;
        const named = partsOf(parent).find(p => /^[#[]/.test(p.css));
        if (named && namesAlone(el, `${named.css} > ${css()}`)) return { css: `${named.css} > ${css()}`, xpath: `//*[${named.xp}]/${xpath()}` };
        node = parent;
    }
    return { css: `body > ${css()}`, xpath: `/html/body/${xpath()}` };
}

/** Most copies of one control a page shows (a pager above and below the results). */
const MAX_CONTROL_COPIES = 3;

/**
 * Whether the selector finds the element alone. A control may also be found with its copies (the
 * same text, at most three): the run clicks the visible, enabled one.
 */
function namesAlone(el: Element, selector: string, control = false): boolean {
    const doc = el.ownerDocument;
    let found: Element[];
    try {
        if (looksLikeXPath(selector)) {
            const r = doc.evaluate(selector, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            found = Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element);
        } else {
            found = Array.from(doc.querySelectorAll(selector));
        }
    } catch {
        return false;
    }
    if (found.length === 1) return found[0] === el;
    if (!control || found.length > MAX_CONTROL_COPIES || !found.includes(el)) return false;
    const text = normalizeSpace(el.textContent);
    return found.every(f => normalizeSpace(f.textContent) === text);
}

function familyOf(selector: string, labelled: Set<string>): string {
    if (labelled.has(selector)) return 'label';
    if (/contains\(concat\(/.test(selector) && !/normalize-space\(\)=/.test(selector)) return selectorFamily(selector.replace(/\[contains\(concat\([^\]]*\]/g, '.c'));
    if (looksLikeXPath(selector) && /normalize-space\(\)=/.test(selector)) return 'text';
    return selectorFamily(selector);
}

export interface ElementOptions {
    /** A control (Next, a click target): its own text may name it. A value's text never does. */
    control?: boolean;
}

/** Position-free selectors that name the element alone, cheapest first, checked one at a time as they are asked for. */
function* uniqueCandidates(el: Element, options: ElementOptions): Generator<ChainEntry> {
    const tag = tagOf(el);
    const parts = partsOf(el);
    const raw: string[] = [tag, `//${tag}`];
    for (const p of parts) {
        raw.push(`${tag}${p.css}`, `//${tag}[${p.xp}]`);
        if (/^[#[]/.test(p.css)) raw.push(p.css);
    }
    const labels = labelXPaths(el);
    raw.push(...labels);
    const text = normalizeSpace(el.textContent);
    if (options.control && isLabelText(text)) {
        raw.push(`//${tag}[normalize-space()=${xpathLiteral(text)}]`);
    }
    for (const scope of scopesOf(el)) {
        for (const p of [...parts, { css: '', xp: '' }]) {
            raw.push(`${scope.css} ${tag}${p.css}`, `//${scope.xp}//${tag}${p.xp ? `[${p.xp}]` : ''}`);
        }
        for (const l of labels) raw.push(`//${scope.xp}${l}`);
    }

    const labelled = new Set([...labels, ...raw.filter(r => labels.some(l => r.endsWith(l)))]);
    // Cheapest first, and only the cheapest MAX_CHECKS: past them, candidates are scoped variants of the same names.
    const sorted = [...new Set(raw)].sort((a, b) => cost(a, labelled) - cost(b, labelled) || a.length - b.length).slice(0, MAX_CHECKS);
    for (const s of sorted) {
        if (namesAlone(el, s, options.control)) yield { selector: s, strategy: familyOf(s, labelled) };
    }
}

/** Every position-free selector that names the element alone, cheapest first. */
export function elementCandidates(el: Element, options: ElementOptions = {}, limit = Infinity): ChainEntry[] {
    const out: ChainEntry[] = [];
    for (const c of uniqueCandidates(el, options)) {
        out.push(c);
        if (out.length >= limit) break;
    }
    return out;
}

/** Label XPaths cost a label (100, +50 a scope step), a control's text 300 + a tenth of its length. */
function cost(selector: string, labelled: Set<string>): number {
    if (labelled.has(selector)) return 100 + (selector.startsWith('//*[') || /^\/\/\w+\[[^\]]*\]\/\/\w+\[normalize/.test(selector) ? 50 : 0);
    const text = /^\/\/\w+\[normalize-space\(\)=(.+)\]$/.exec(selector);
    if (text) return 300 + text[1].length / 10;
    return selectorCost(selector);
}

/**
 * The chain to store, cheapest first: at most two CSS of different families and one XPath. A label
 * XPath can lead. A path with positions only when nothing names the element at all.
 */
export function elementChain(el: Element, options: ElementOptions = {}): ChainEntry[] {
    const labelled = new Set<string>();
    const css: ChainEntry[] = [];
    const families = new Set<string>();
    let xpath: ChainEntry | undefined;
    for (const c of uniqueCandidates(el, options)) {
        if (c.strategy === 'label') labelled.add(c.selector);
        if (looksLikeXPath(c.selector)) { xpath ??= c; continue; }
        if (css.length < MAX_CHAIN - 1 && !families.has(c.strategy)) { families.add(c.strategy); css.push(c); }
        if (css.length >= MAX_CHAIN - 1 && xpath) break;
    }
    if (css.length === 0 && !xpath) {
        const path = anchoredPath(el);
        return [{ selector: path.css, strategy: 'structure' }, { selector: path.xpath, strategy: 'xpath' }];
    }
    const chain = xpath ? [...css, xpath] : css;
    return chain.sort((a, b) => cost(a.selector, labelled) - cost(b.selector, labelled) || a.selector.length - b.selector.length);
}
