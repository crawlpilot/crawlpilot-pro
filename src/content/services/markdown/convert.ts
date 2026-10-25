/**
 * DOM → markdown (thenos `convert/*`): each element goes to its family's handler, everything else
 * renders its children. Block handlers return their markdown between blank lines; runs of blank lines
 * are collapsed at the end, so blocks never run into each other or into inline text.
 *
 * - **Text:** headings, paragraphs and generic containers as blocks (on utility-class pages every
 *   paragraph is a `<div>`), emphasis, links (`[label](href "title")`, a link that goes nowhere is its
 *   text), quotes, rules, breaks. Page text that would read as structure at a line start (`# `, `- `,
 *   `1. `, `>`) is escaped.
 * - **Lists:** `start`/`reversed`, continuation lines indented by the marker's width, nested lists tight.
 * - **Tables:** data tables as GFM pipe grids with `colspan`/`rowspan` filling every slot they cover
 *   (clamped), the `<thead>` row or an all-`<th>` first row as header, the caption above in italics;
 *   layout tables (a `presentation` role, a nested table, no text) as plain blocks.
 * - **Code:** fenced blocks keep whitespace, take their language from `language-*`/`lang-*`/`data-lang`,
 *   skip gutters, and use a fence longer than any backtick run inside; inline code likewise.
 * - **Media:** images under the image policy (icons, tracking pixels and `data:` images dropped), figures
 *   with their caption.
 * - **Other:** `sup`/`sub` kept as HTML, definition lists as `**term**` / `: definition`, `details` with a
 *   bold summary, `kbd` as code, form controls as their label and value.
 */
import { isIcon } from './main';

export interface RenderSettings {
    links: boolean;
    images: 'content' | 'none';
    tables: boolean;
    /** Block refs: ` [bN]` after each leaf block (heading, paragraph, item, row, image), '' when off. */
    ref?: (el: Element) => string;
}

const refOf = (el: Element, s: RenderSettings) => (s.ref ? s.ref(el) : '');

type Handler = (el: Element, depth: number, s: RenderSettings) => string;

const WS = /\s+/g;
const BLANK_LINES = /\n{3,}/g;
const LINE_START = /^(#{1,6}(?=\s)|[-+*](?=\s)|\d{1,9}(?=[.)]\s)|>)/;
const COLSPAN_LIMIT = 1000;

export const cleanText = (text: string | null) => (text ? text.replace(WS, ' ') : '');
export const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');
export const collapseBlankLines = (text: string) => text.replace(BLANK_LINES, '\n\n');

/** Inline text from rendered children: heading markers of nested headings dropped (`# ## Title`). */
const flat = (text: string) => oneLine(text.replace(/(^|\n)#{1,6} /g, '$1'));

function block(inner: string): string {
    const stripped = collapseBlankLines(inner).trim();
    return stripped ? `\n\n${stripped}\n\n` : '';
}

function escapeLineStart(chunk: string): string {
    return chunk.replace(LINE_START, token => (/^\d/.test(token) ? `${token}\\` : `\\${token}`));
}

export function render(el: Element, depth: number, s: RenderSettings): string {
    const handler = HANDLERS[el.localName];
    return handler ? handler(el, depth, s) : renderChildren(el, depth, s);
}

/**
 * The element's text and children. Spaces at a line start are dropped (whitespace between blocks in the
 * source would indent the next line, and four make it code); page text at a line start is escaped.
 */
export function renderChildren(el: Element, depth: number, s: RenderSettings): string {
    const parts: string[] = [];
    let atLineStart = true;
    const add = (chunk: string, text: boolean) => {
        if (atLineStart) {
            chunk = chunk.replace(/^ +/, '');
            if (text && chunk) chunk = escapeLineStart(chunk);
        } else if (chunk.startsWith('\n') && parts.length && parts[parts.length - 1].endsWith(' ') && !parts[parts.length - 1].endsWith('  ')) {
            parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
        }
        if (chunk) {
            parts.push(chunk);
            atLineStart = chunk.endsWith('\n');
        }
    };
    for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) add(cleanText(node.nodeValue), true);
        else if (node.nodeType === Node.ELEMENT_NODE) add(render(node as Element, depth, s), false);
    }
    return parts.join('');
}

// ─── Text ─────────────────────────────────────────────────────────────────────

const heading = (level: number): Handler => (el, d, s) => {
    const inner = flat(renderChildren(el, d, s));
    return inner ? block(`${'#'.repeat(level)} ${inner}${refOf(el, s)}`) : '';
};
const container: Handler = (el, d, s) => {
    const inner = renderChildren(el, d, s);
    // A leaf block (one line of text) gets a ref; a container of blocks leaves them to its children.
    const leaf = s.ref && inner.trim() && !inner.trim().includes('\n') && !/\[b\d+\]$/.test(inner.trim());
    return block(leaf ? `${inner.trimEnd()}${refOf(el, s)}` : inner);
};
const wrap = (marker: string): Handler => (el, d, s) => {
    const inner = oneLine(renderChildren(el, d, s));
    return inner ? `${marker}${inner}${marker}` : '';
};

const SKIP_LINK = /^(skip (to (the )?)?(main )?(content|navigation|main)|jump to (main )?content)$/i;

const link: Handler = (el, d, s) => {
    const href = (el.getAttribute('href') ?? '').trim();
    const inner = flat(renderChildren(el, d, s));
    const label = inner || oneLine(el.getAttribute('aria-label') ?? '') || oneLine(el.getAttribute('title') ?? '');
    // "Skip to main content": navigation for keyboards, not content.
    if (href.includes('#') && SKIP_LINK.test(label)) return '';
    // A link to a place on this page reads as its text.
    if (!s.links || !href || href.startsWith('#') || href.endsWith('#') || /^javascript:/i.test(href)) return label;
    const text = label || href;
    const title = el.getAttribute('title');
    const md = title && title !== text ? `[${text}](${href} "${title.replace(/"/g, '\\"')}")` : `[${text}](${href})`;
    // A link around a heading (a card title) is a heading holding the link, when the heading is
    // most of what the link says (not a whole card with images, price and rating).
    const h = el.querySelector('h1, h2, h3, h4, h5, h6');
    const textLength = (n: Element) => (n.textContent ?? '').replace(/\s+/g, '').length;
    return h && textLength(h) >= textLength(el) * 0.6 ? block(`${'#'.repeat(Number(h.localName[1]))} ${md}`) : md;
};

const blockquote: Handler = (el, d, s) => {
    const inner = collapseBlankLines(renderChildren(el, d, s)).trim();
    return inner ? block(inner.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n')) : '';
};

// ─── Lists ────────────────────────────────────────────────────────────────────

const list = (ordered: boolean): Handler => (el, d, s) => {
    const items = Array.from(el.children).filter(c => c.localName === 'li');
    const reversed = ordered && el.hasAttribute('reversed');
    const start = parseInt(el.getAttribute('start') ?? '', 10);
    let index = Number.isFinite(start) ? start : reversed ? items.length : 1;
    const lines: string[] = [];
    for (const item of items) {
        const marker = ordered ? `${Math.max(index, 0)}.` : '-';
        index += reversed ? -1 : 1;
        const indent = ' '.repeat(marker.length + 1);
        const content = collapseBlankLines(renderChildren(item, d + 1, s)).trim();
        const [first, ...rest] = content ? content.split('\n') : [''];
        if (!first && rest.length === 0) continue;
        lines.push(`${`${marker} ${first}`.trimEnd()}${first ? refOf(item, s) : ''}`);
        for (const extra of rest) lines.push(extra ? `${indent}${extra}` : '');
    }
    if (!lines.length) return '';
    const body = lines.join('\n');
    return d > 0 ? `\n${body}\n` : `\n\n${body}\n\n`;
};

// ─── Tables ───────────────────────────────────────────────────────────────────

function directRows(table: Element): [Element, boolean][] {
    const rows: [Element, boolean][] = [];
    for (const child of Array.from(table.children)) {
        if (child.localName === 'tr') rows.push([child, false]);
        else if (/^(thead|tbody|tfoot)$/.test(child.localName)) {
            for (const tr of Array.from(child.children)) if (tr.localName === 'tr') rows.push([tr, child.localName === 'thead']);
        }
    }
    return rows;
}

const cells = (tr: Element) => Array.from(tr.children).filter(c => c.localName === 'td' || c.localName === 'th');

function span(value: string | null, limit: number): number {
    const n = parseInt(value ?? '1', 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), limit) : 1;
}

function isLayoutTable(table: Element): boolean {
    if (/^(presentation|none)$/i.test(table.getAttribute('role') ?? '')) return true;
    if (table.querySelector('table')) return true;
    return !directRows(table).some(([tr]) => cells(tr).some(c => (c.textContent ?? '').trim()));
}

const table: Handler = (el, d, s) => {
    const rows = directRows(el);
    if (!s.tables || isLayoutTable(el)) {
        return block(rows.flatMap(([tr]) => cells(tr)).map(c => block(renderChildren(c, d, s))).join(''));
    }
    const grid: (string | undefined)[][] = rows.map(() => []);
    rows.forEach(([tr], r) => {
        let column = 0;
        for (const cell of cells(tr)) {
            while (grid[r][column] !== undefined) column++;
            const text = oneLine(renderChildren(cell, 0, s)).replace(/\|/g, '\\|');
            const colspan = span(cell.getAttribute('colspan'), COLSPAN_LIMIT);
            const rowspan = span(cell.getAttribute('rowspan'), rows.length - r);
            for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) grid[r + dr][column + dc] = text;
            column += colspan;
        }
    });
    const columns = Math.max(0, ...grid.map(row => row.length));
    if (!columns) return '';
    const header = rows.findIndex(([tr, inHead], i) => inHead || (i === 0 && cells(tr).length > 0 && cells(tr).every(c => c.localName === 'th')));
    const line = (row: (string | undefined)[], i: number) => `| ${Array.from({ length: columns }, (_, c) => row[c] ?? '').join(' | ')} |${refOf(rows[i][0], s)}`;
    const separator = `|${' --- |'.repeat(columns)}`;
    const lines: string[] = [];
    if (header < 0) lines.push(`|${'     |'.repeat(columns)}`, separator, ...grid.map((row, i) => line(row, i)));
    else grid.forEach((row, i) => { lines.push(line(row, i)); if (i === header) lines.push(separator); });
    const caption = Array.from(el.children).find(c => c.localName === 'caption');
    const captionText = caption ? oneLine(renderChildren(caption, 0, s)) : '';
    return `\n\n${captionText ? `*${captionText}*\n\n` : ''}${lines.join('\n')}\n\n`;
};

// ─── Code ─────────────────────────────────────────────────────────────────────

const GUTTER = /gutter|line-numbers/i;
const CODE_BLOCKS = new Set(['p', 'div', 'li', 'tr', 'table', 'thead', 'tbody', 'tfoot', 'section', 'article', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LANGUAGE_PREFIXES = ['language-', 'lang-', 'highlight-source-', 'highlight-'];
const NOT_LANGUAGES = new Set(['sourcecode', 'hljs', 'highlight', 'code', 'prettyprint', 'linenums', 'source', 'notranslate']);

function language(el: Element | null): string {
    if (!el) return '';
    for (const a of ['data-lang', 'data-language']) {
        const v = (el.getAttribute(a) ?? '').trim().toLowerCase();
        if (v) return v;
    }
    const classes = (el.getAttribute('class') ?? '').toLowerCase();
    if (classes.includes('brush:')) return classes.split('brush:')[1].trim().split(/[;\s]/)[0];
    const parts = classes.split(/\s+/).filter(Boolean);
    for (const part of parts) for (const prefix of LANGUAGE_PREFIXES) if (part.startsWith(prefix) && part.length > prefix.length) return part.slice(prefix.length);
    if (parts.includes('sourcecode') || parts.includes('hljs')) return parts.find(p => !NOT_LANGUAGES.has(p)) ?? '';
    return '';
}

function collectCode(el: Element, out: string[]) {
    if (GUTTER.test(el.getAttribute('class') ?? '')) return;
    if (el.localName === 'br') out.push('\n');
    for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) out.push(node.nodeValue ?? '');
        else if (node.nodeType === Node.ELEMENT_NODE) collectCode(node as Element, out);
    }
    if (CODE_BLOCKS.has(el.localName)) out.push('\n');
}

const longestRun = (text: string) => Math.max(0, ...(text.match(/`+/g) ?? []).map(r => r.length));

const codeBlock: Handler = el => {
    const code = el.querySelector('code');
    const lang = language(code) || language(el) || language(el.parentElement);
    const parts: string[] = [];
    collectCode(el, parts);
    const content = parts.join('').replace(/\n+$/, '');
    const fence = '`'.repeat(Math.max(longestRun(content) + 1, 3));
    return `\n\n${fence}${lang}\n${content}\n${fence}\n\n`;
};

const inlineCode: Handler = el => {
    if (el.parentElement?.closest('pre')) return '';
    const parts: string[] = [];
    collectCode(el, parts);
    const code = oneLine(parts.join(''));
    if (!code) return '';
    const fence = '`'.repeat(longestRun(code) + 1);
    const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${code}${pad}${fence}`;
};

// ─── Media ────────────────────────────────────────────────────────────────────

const image: Handler = (el, _d, s) => {
    const src = el.getAttribute('src') ?? '';
    const alt = oneLine(el.getAttribute('alt') ?? '');
    const linked = Boolean(el.closest('a'));
    if (s.images === 'none') return linked ? alt : '';
    if (isIcon(el)) return '';
    if (!src || src.startsWith('data:')) return alt;
    const title = el.getAttribute('title');
    return (title ? `![${alt}](${src} "${title.replace(/"/g, '\\"')}")` : `![${alt}](${src})`) + refOf(el, s);
};

const figcaption: Handler = (el, d, s) => {
    const text = oneLine(renderChildren(el, d, s));
    return text ? block(`*${text}*${refOf(el, s)}`) : '';
};

// ─── Other ────────────────────────────────────────────────────────────────────

const keepTag = (tag: string): Handler => (el, d, s) => {
    const inner = oneLine(renderChildren(el, d, s));
    return inner ? `<${tag}>${inner}</${tag}>` : '';
};
const term: Handler = (el, d, s) => {
    const text = oneLine(renderChildren(el, d, s));
    return text ? `\n\n**${text}**${refOf(el, s)}\n` : '';
};
const definition: Handler = (el, d, s) => {
    const text = oneLine(renderChildren(el, d, s));
    return text ? `: ${text}${refOf(el, s)}\n` : '';
};
const summary: Handler = (el, d, s) => {
    const text = oneLine(renderChildren(el, d, s));
    return text ? block(`**${text}**`) : '';
};
const keyboard: Handler = el => {
    const text = oneLine(el.textContent ?? '');
    return text && !text.includes('`') ? `\`${text}\`` : text;
};
const control: Handler = el => {
    const value = el.getAttribute('value');
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (!value || /^(hidden|password|submit|button|reset|image|checkbox|radio)$/.test(type)) return '';
    return value;
};
const nothing: Handler = () => '';

const CONTAINERS = ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'address', 'center', 'form', 'fieldset', 'hgroup', 'picture', 'p', 'figure', 'dl', 'details'];

const HANDLERS: Record<string, Handler> = {
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(l => [`h${l}`, heading(l)])),
    ...Object.fromEntries(CONTAINERS.map(t => [t, container])),
    br: () => '  \n',
    hr: () => '\n\n---\n\n',
    strong: wrap('**'), b: wrap('**'), em: wrap('*'), i: wrap('*'), del: wrap('~~'), s: wrap('~~'), strike: wrap('~~'),
    a: link,
    blockquote,
    ul: list(false), ol: list(true),
    table,
    pre: codeBlock, code: inlineCode,
    img: image, figcaption,
    sup: keepTag('sup'), sub: keepTag('sub'),
    dt: term, dd: definition, summary, kbd: keyboard,
    input: control, textarea: control, select: control,
    button: (el, d, s) => oneLine(renderChildren(el, d, s)),
    option: nothing,
};

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins', 'label', 'img']);

/** Plain text with blocks separated by a space (textContent runs "Title" and "Body" together). */
export function plainText(root: Element): string {
    const parts: string[] = [];
    const walk = (el: Element) => {
        for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) parts.push(node.nodeValue ?? '');
            else if (node.nodeType === Node.ELEMENT_NODE) {
                const child = node as Element;
                const isBlock = !INLINE.has(child.localName);
                if (isBlock) parts.push(' ');
                walk(child);
                if (isBlock) parts.push(' ');
            }
        }
    };
    walk(root);
    return parts.join('').replace(/\s+/g, ' ').trim();
}

export function convert(root: Element, settings: RenderSettings): string {
    const out = collapseBlankLines(render(root, 0, settings)).trim();
    return out ? `${out}\n` : '';
}
