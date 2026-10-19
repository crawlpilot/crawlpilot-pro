/**
 * Page → markdown: the one converter for the whole extension (docs/plans/ai-extract-markdown-plan.md §2,
 * ported from thenos `packages/markdown`).
 *
 * compose (live page → detached copy of what is rendered) → main content (boilerplate, floating chrome,
 * density pruning) → injection filter → convert → post-process.
 *
 * Modes: `markdown` is the whole main content; `fit` also drops floating chrome and prunes by density;
 * `text` is the main content's plain text. Every filter can reduce a page to nothing, and an empty
 * result can't be told from a page that never loaded, so attempts run from strictest to loosest and
 * the first with content wins (`attempt`, `fellBack`).
 */
import { compose, SOURCE_ATTRIBUTE, type ComposeOptions } from './compose';
import { dropFloating, prune, removeBoilerplate } from './main';
import { dropInjections } from './injection';
import { convert, plainText, type RenderSettings } from './convert';
import { outline, postprocess, truncateMarkdown, type Heading } from './post';

export type MarkdownMode = 'markdown' | 'fit' | 'text';

export interface MarkdownOptions extends ComposeOptions {
    mode?: MarkdownMode;
    /** Remove named boilerplate (header, nav, footer, sidebars…). Default true. */
    mainContent?: boolean;
    includeLinks?: boolean;
    includeImages?: boolean;
    includeTables?: boolean;
    /** Only these elements (CSS selectors), in page order. */
    include?: string[];
    /** Never these elements. */
    exclude?: string[];
    /** Drop text addressed to an AI model. Default true. */
    dropInjections?: boolean;
    maxChars?: number;
    /** Content captured while revealing that the page no longer shows (a lazy tab's panel, cloned
     * when it was open): appended at the end, each under its label. */
    extra?: { label: string; el: Element }[];
}

export interface Attempt { mode: MarkdownMode; mainContent: boolean }

export interface MarkdownStats {
    /** Text characters of the composed page, after the main-content stage, and of the output. */
    composedChars: number;
    keptChars: number;
    markdownChars: number;
    hidden: number;
    boilerplateDropped: number;
    floatingDropped: number;
    prunedDropped: number;
    injectionsDropped: number;
}

export interface MarkdownResult {
    markdown: string;
    title: string;
    attempt: Attempt;
    fellBack: boolean;
    truncated: boolean;
    outline: Heading[];
    stats: MarkdownStats;
    /** With `refs`: each ` [bN]` in the markdown and the live element it was read from. */
    refs?: Map<string, Element>;
}

export function fallbackChain(mode: MarkdownMode, mainContent: boolean): Attempt[] {
    const chain: Attempt[] = [{ mode, mainContent }];
    if (mode === 'fit') chain.push({ mode: 'markdown', mainContent });
    if (mainContent) {
        chain.push({ mode, mainContent: false });
        if (mode === 'fit') chain.push({ mode: 'markdown', mainContent: false });
    }
    return chain;
}

const textChars = (el: Element) => (el.textContent ?? '').replace(/\s+/g, '').length;

export function toMarkdown(source: Element | Document = document, options: MarkdownOptions = {}): MarkdownResult {
    const mode = options.mode ?? 'markdown';
    const settings: RenderSettings = {
        links: options.includeLinks ?? true,
        images: options.includeImages === false ? 'none' : 'content',
        tables: options.includeTables ?? true,
    };
    const composed = compose(source, options);
    const base = composed.root;
    if (options.include?.length) {
        const kept = composed.doc.createElement('body');
        for (const selector of options.include) {
            try { base.querySelectorAll(selector).forEach(el => kept.appendChild(el)); } catch { /* bad selector */ }
        }
        base.replaceChildren(...Array.from(kept.childNodes));
    }
    for (const selector of options.exclude ?? []) {
        try { base.querySelectorAll(selector).forEach(el => el.remove()); } catch { /* bad selector */ }
    }
    for (const { label, el } of options.extra ?? []) {
        // A detached copy: no layout to read, so only `hidden` and inline styles count.
        const part = compose(el, { live: false, refs: options.refs });
        // Its refs point at the captured copy, numbered after the page's own.
        part.root.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`).forEach(n => {
            const own = part.sources[Number(n.getAttribute(SOURCE_ATTRIBUTE))];
            n.setAttribute(SOURCE_ATTRIBUTE, String(composed.sources.length));
            composed.sources.push(own);
        });
        const section = composed.doc.createElement('section');
        const heading = composed.doc.createElement('h3');
        heading.textContent = label;
        section.append(heading, ...Array.from(part.root.childNodes).map(n => composed.doc.importNode(n, true)));
        base.appendChild(section);
    }

    const chain = fallbackChain(mode, options.mainContent ?? true);
    const composedChars = textChars(base);
    let markdown = '';
    let attempt = chain[0];
    let stats: MarkdownStats = { composedChars, keptChars: 0, markdownChars: 0, hidden: composed.hidden, boilerplateDropped: 0, floatingDropped: 0, prunedDropped: 0, injectionsDropped: 0 };
    let refs: Map<string, Element> | undefined;
    for (attempt of chain) {
        const root = base.cloneNode(true) as Element;
        if (options.refs) {
            const map = new Map<string, Element>();
            refs = map;
            settings.ref = el => {
                const i = el.getAttribute(SOURCE_ATTRIBUTE);
                const source = i === null ? undefined : composed.sources[Number(i)];
                if (!source) return '';
                const key = `b${map.size + 1}`;
                map.set(key, source);
                return ` [${key}]`;
            };
        }
        const boilerplateDropped = attempt.mainContent ? removeBoilerplate(root) : 0;
        const floatingDropped = attempt.mode === 'fit' && attempt.mainContent ? dropFloating(root) : 0;
        const prunedDropped = attempt.mode === 'fit' ? prune(root) : 0;
        const injectionsDropped = options.dropInjections === false ? 0 : dropInjections(root);
        markdown = attempt.mode === 'text'
            ? plainText(root)
            : postprocess(convert(root, settings));
        stats = { composedChars, keptChars: textChars(root), markdownChars: markdown.length, hidden: composed.hidden, boilerplateDropped, floatingDropped, prunedDropped, injectionsDropped };
        if (markdown.trim()) break;
    }

    const cut = options.maxChars ? truncateMarkdown(markdown, options.maxChars) : { markdown, truncated: false };
    const doc = source instanceof Document ? source : source.ownerDocument!;
    const h1 = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
    return {
        markdown: cut.markdown,
        title: doc.title?.trim() || h1 || '',
        attempt,
        fellBack: attempt !== chain[0],
        truncated: cut.truncated,
        outline: attempt.mode === 'text' ? [] : outline(cut.markdown),
        stats: { ...stats, markdownChars: cut.markdown.length },
        ...(refs ? { refs } : {}),
    };
}
