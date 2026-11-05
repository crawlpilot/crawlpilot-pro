/**
 * Reads a field's ways one by one, raw (`shared/types/ways.ts`): what each way's matches hold, or that its
 * condition did not hold. Which way wins is decided outside the page, after each way's cleanup. Text is
 * read as Jsoup's `text()` reads it (what Atlas templates were written against): every text node, hidden
 * ones too, with a space at block edges, whitespace collapsed. CSS may use Jsoup's `:contains(text)`.
 * Conditions and page rules count selector matches, or regex matches in the page's HTML.
 */
import { looksLikeXPath, resolveItems } from '../../../shared/selectors/resolve';
import type { Condition, CountOp, PageRule, PageWay, RegexIn, WayHit } from '../../../shared/types/ways';
import { readBinding } from './dataBinding';

/** Matches read per way, and characters per value: a way that matches the whole page stays small. */
const MAX_MATCHES = 200;
const MAX_CHARS = 20_000;

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const BLOCK = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** An element's text as Jsoup's `text()` gives it. */
export function textOf(el: Element): string {
    const parts: string[] = [];
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) { parts.push(node.nodeValue ?? ''); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = (node as Element).tagName.toUpperCase();
        if (SKIP.has(tag)) return;
        if (tag === 'BR') { parts.push(' '); return; }
        const block = BLOCK.has(tag);
        if (block) parts.push(' ');
        for (const child of Array.from(node.childNodes)) walk(child);
        if (block) parts.push(' ');
    };
    walk(el);
    return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Splits on `sep` outside brackets, parentheses and quotes. */
function splitTop(s: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out.map(p => p.trim()).filter(Boolean);
}

/** The index of the `)` closing the `(` at `open`, or -1. */
function closing(s: string, open: number): number {
    let depth = 0, quote = '';
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return i;
    }
    return -1;
}

function plainAll(selector: string, root: ParentNode): Element[] {
    if (!looksLikeXPath(selector)) {
        try { return Array.from(root.querySelectorAll(selector)); } catch { /* the shared resolver's fixes */ }
    }
    return resolveItems([selector], root).result;
}

let marks = 0;

/** Every match of a CSS selector (with `:contains(text)`, case-insensitive, as Jsoup has it) or an XPath, in page order. */
export function selectAll(selector: string, root: ParentNode = document): Element[] {
    const groups = looksLikeXPath(selector) ? [selector] : splitTop(selector, ',');
    if (groups.length > 1) {
        const all = new Set(groups.flatMap(g => selectAll(g, root)));
        return [...all].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    }
    const at = looksLikeXPath(selector) ? -1 : selector.search(/:contains\(/i);
    if (at < 0) return plainAll(selector, root);
    const open = at + ':contains'.length;
    const close = closing(selector, open);
    if (close < 0) return [];
    const text = selector.slice(open + 1, close).trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
    const before = selector.slice(0, at);
    const rest = selector.slice(close + 1);
    const base = !before.trim() || /[\s>+~]$/.test(before) ? `${before}*` : before;
    const hits = selectAll(base, root).filter(el => textOf(el).toLowerCase().includes(text));
    if (!rest.trim() || !hits.length) return hits;
    // The rest of the selector is relative to the matches: they are marked for a moment to select from.
    const mark = `data-cp-contains-${++marks}`;
    hits.forEach(el => el.setAttribute(mark, ''));
    try {
        return selectAll(`[${mark}]${rest}`, root);
    } finally {
        hits.forEach(el => el.removeAttribute(mark));
    }
}

/** The first match of `selector` in `el`, `el` itself included (as Jsoup selects); `el` when there is no selector. */
function within(el: Element, selector?: string): Element | null {
    if (!selector?.trim()) return el;
    try { if (el.matches(selector)) return el; } catch { /* :contains or XPath */ }
    return selectAll(selector, el)[0] ?? null;
}

function attrOf(el: Element, name: string): string {
    if (name.startsWith('abs:')) {
        const v = el.getAttribute(name.slice(4));
        if (!v) return '';
        try { return new URL(v, el.baseURI).href; } catch { return ''; }
    }
    return el.getAttribute(name) ?? '';
}

const cut = (s: string) => s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) : s;

const compare = (n: number, op: CountOp, value: number) => {
    switch (op) {
        case 'eq': return n === value;
        case 'gt': return n > value;
        case 'lt': return n < value;
        case 'gte': return n >= value;
        case 'lte': return n <= value;
        case 'ne': return n !== value;
    }
};

/** One page's conditions, each counted once: many ways ask the same thing. */
export class PageProbe {
    private sources = new Map<RegexIn, string>();
    private counts = new Map<string, number>();

    private count(c: Extract<Condition, { kind: 'css' | 'regex' }>): number {
        const key = c.kind === 'css' ? `css ${c.selector}` : `re ${c.in ?? 'html'} ${c.flags ?? ''} ${c.pattern}`;
        let n = this.counts.get(key);
        if (n === undefined) {
            n = c.kind === 'css' ? selectAll(c.selector).length : this.matches(c.pattern, c.flags ?? '', c.in ?? 'html');
            this.counts.set(key, n);
        }
        return n;
    }

    /** What a regex condition reads: the HTML source, the text a visitor sees, the URL, or the title. */
    private source(where: RegexIn): string {
        let s = this.sources.get(where);
        if (s === undefined) {
            // What a visitor reads: rendered text, so no scripts, hidden parts or markup (`innerText`; jsdom has only `textContent`).
            s = where === 'text' ? (document.body?.innerText ?? document.body?.textContent ?? '')
                : where === 'url' ? location.href
                : where === 'title' ? document.title
                : document.documentElement.outerHTML;
            this.sources.set(where, s);
        }
        return s;
    }

    /** How many times the regex matches; NaN when it doesn't compile (no comparison holds). */
    private matches(pattern: string, flags: string, where: RegexIn): number {
        let re: RegExp;
        try { re = new RegExp(pattern, `${flags.replace(/[gy]/g, '')}g`); } catch { return NaN; }
        const text = this.source(where);
        let n = 0;
        for (let m = re.exec(text); m && n < 100_000; m = re.exec(text)) {
            n++;
            if (m[0] === '') re.lastIndex++;
        }
        return n;
    }

    holds(c: Condition): boolean {
        switch (c.kind) {
            case 'all': return c.of.every(x => this.holds(x));
            case 'any': return c.of.some(x => this.holds(x));
            case 'not': return !this.holds(c.of);
            default: return compare(this.count(c), c.op, c.value);
        }
    }
}

/** The first page rule that holds, or null. */
export function firstRule(rules: PageRule[], probe: PageProbe): Pick<PageRule, 'name' | 'status'> | null {
    const hit = rules.find(r => probe.holds(r.when));
    return hit ? { name: hit.name, status: hit.status } : null;
}

function readData(way: PageWay): WayHit {
    const v = readBinding(way.data!);
    if (v === undefined || v === '') return { values: [] };
    const values = Array.isArray(v) ? v.map(x => Array.isArray(x) ? JSON.stringify(x) : String(x)) : [v];
    return { values: values.slice(0, way.many ? MAX_MATCHES : 1).map(cut) };
}

function readSelector(way: PageWay): WayHit {
    const all = selectAll(way.selector ?? '');
    if (way.read === 'count') return { values: all.length ? [String(all.length)] : [] };
    const matches = all.slice(0, way.many ? MAX_MATCHES : 1);
    if (way.read === 'pairs') {
        const pairs: [string, string][] = [];
        for (const m of matches) {
            const k = within(m, way.pairs?.key);
            const v = within(m, way.pairs?.value);
            if (k && v) pairs.push([cut(textOf(k)), cut(way.attr ? attrOf(v, way.attr) : textOf(v))]);
        }
        return { values: [], pairs };
    }
    const read = (el: Element) => way.read === 'attr' ? attrOf(el, way.attr ?? '') : way.read === 'html' ? el.outerHTML : textOf(el);
    return { values: matches.map(el => cut(read(el))) };
}

/** What each way reads on this page, in order. */
export function readWays(ways: PageWay[], probe: PageProbe): WayHit[] {
    return ways.map(way => {
        if (way.when && !probe.holds(way.when)) return { skipped: true, values: [] };
        try {
            // Neither: a way read outside the page's script (Pro's markup ways), filled in after.
            return way.data ? readData(way) : way.selector ? readSelector(way) : { values: [] };
        } catch {
            return { values: [] };
        }
    });
}
