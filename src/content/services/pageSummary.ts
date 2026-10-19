/**
 * A quick look at the open page for Home's suggestion (docs/plans/ux-simplification-plan.md §4.2):
 * is it a list of things, one product, an article, or none of those? Cheap by design (it runs each
 * time Home opens): the page's JSON-LD types, one bounded list search, and the article's length.
 */
import type { PageSummary } from '../../shared/types/pageSummary';

/** Fewer items than this is a few links, not a list worth a table. */
const MIN_LIST = 4;
/** A list this long wins over a product's JSON-LD (search pages often describe one product too). */
const CLEAR_LIST = 8;
/** Visible text of an article body, in characters. */
const ARTICLE_TEXT = 1500;

const NOUNS: [RegExp, string][] = [
    [/^(product|offer|productgroup)$/i, 'products'],
    [/^(jobposting)$/i, 'jobs'],
    [/^(newsarticle|article|blogposting|report)$/i, 'articles'],
    [/^(event)$/i, 'events'],
    [/^(recipe)$/i, 'recipes'],
    [/^(localbusiness|restaurant|store|hotel)$/i, 'places'],
    [/^(review)$/i, 'reviews'],
    [/^(course)$/i, 'courses'],
];

interface LdNode { '@type'?: string | string[]; name?: string; headline?: string; itemListElement?: unknown[]; '@graph'?: unknown[] }

/** Every JSON-LD node on the page (top level and `@graph`), skipping what doesn't parse. */
function ldNodes(doc: Document): LdNode[] {
    const out: LdNode[] = [];
    const add = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(add);
        else if (v && typeof v === 'object') {
            out.push(v as LdNode);
            if (Array.isArray((v as LdNode)['@graph'])) (v as LdNode)['@graph']!.forEach(add);
        }
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { add(JSON.parse(s.textContent || '')); } catch { /* not JSON */ }
    });
    return out;
}

const typesOf = (n: LdNode) => (Array.isArray(n['@type']) ? n['@type'] : n['@type'] ? [n['@type']] : []).map(String);
const has = (nodes: LdNode[], re: RegExp) => nodes.find(n => typesOf(n).some(t => re.test(t)));

function nounFor(nodes: LdNode[]): string {
    // An ItemList's members name the items; otherwise the page's own types do.
    const members = nodes.flatMap(n => (n.itemListElement ?? []) as LdNode[]).flatMap(m => [m, (m as any)?.item].filter(Boolean)) as LdNode[];
    for (const n of [...members, ...nodes]) {
        for (const t of typesOf(n)) for (const [re, noun] of NOUNS) if (re.test(t)) return noun;
    }
    return 'items';
}

/** Page chrome and hidden parts: never the page's list. */
const NOT_CONTENT = 'nav, header, footer, aside, [role="navigation"], [hidden], [aria-hidden="true"]';

const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const linkText = (el: Element) => (el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a'))).reduce((n, a) => n + textOf(a).length, 0);

/** A card: something to open (a link) and something to read, but not a whole section. */
function isCard(el: Element): boolean {
    if (!el.querySelector('a[href]') && el.tagName !== 'A') return false;
    const len = (el.textContent || '').length;
    return len >= 12 && len <= 4000;
}

const PRICE = /[$€£¥₹]\s?\d|\d[.,]\d{2}\s?(€|zł|kr|lei)/;

interface ListGuess { items: number; priced: boolean }

/**
 * The page's main list: of the parents with several children of one kind (tag and first class)
 * that look like cards, the richest (cards with pictures and some text beat a column of filter
 * links). One pass over the elements with enough children to be a list.
 */
function mainList(doc: Document): ListGuess {
    const root = doc.body;
    let best: ListGuess & { score: number } = { items: 0, priced: false, score: 0 };
    if (!root) return best;
    for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.childElementCount < MIN_LIST || el.closest(NOT_CONTENT)) continue;
        const groups = new Map<string, Element[]>();
        for (const c of Array.from(el.children)) {
            if (!isCard(c)) continue;
            const key = `${c.tagName}.${c.classList[0] ?? ''}`;
            groups.set(key, [...(groups.get(key) ?? []), c]);
        }
        for (const cards of groups.values()) {
            if (cards.length < MIN_LIST) continue;
            const share = (test: (c: Element) => boolean) => cards.filter(test).length / cards.length;
            const pictures = share(c => !!c.querySelector('img, picture'));
            const wordy = share(c => textOf(c).length >= 40);
            // All link text is a menu entry ("Thinkpad", "2-in-1"); checkboxes and fields are a filter group.
            const menu = share(c => linkText(c) >= textOf(c).length * 0.9);
            const filter = share(c => !!c.querySelector('input, select'));
            // Pictures first: a page's items nearly always have them, its sidebars and footers don't.
            const score = (pictures >= 0.5 ? 1000 : 0) + cards.length * (1 + 2 * pictures + wordy) * (1 - 0.5 * menu) * (1 - 0.8 * filter);
            if (score > best.score) best = { items: cards.length, priced: share(c => PRICE.test(c.textContent || '')) >= 0.5, score };
        }
    }
    return best;
}

/**
 * One product's page: one or two buy buttons ("Add to cart", "Buy now") beside a single main
 * heading. A results page has a buy button on every card, so more than two is a list.
 */
function looksLikeProduct(doc: Document): boolean {
    if (doc.querySelectorAll('h1').length !== 1) return false;
    const buy = /\b(add to (cart|bag|basket|trolley)|buy now|add to order)\b/i;
    const buttons = Array.from(doc.querySelectorAll('button, input[type="submit"], [role="button"]'))
        .filter(b => !b.closest(NOT_CONTENT) && buy.test(b.textContent || (b as HTMLInputElement).value || b.getAttribute('aria-label') || ''));
    return buttons.length >= 1 && buttons.length <= 2;
}

const clean = (s?: string | null) => s?.replace(/\s+/g, ' ').trim().slice(0, 140) || undefined;

function articleText(doc: Document): number {
    const article = doc.querySelector('article, [itemprop="articleBody"]');
    return (article?.textContent || '').replace(/\s+/g, ' ').trim().length;
}

export function summarizePage(doc: Document = document): PageSummary {
    const nodes = ldNodes(doc);
    const list = mainList(doc);
    const itemList = has(nodes, /^itemlist$/i);
    const products = nodes.filter(n => typesOf(n).some(t => /^(product|productgroup)$/i.test(t)));
    const article = has(nodes, /^(newsarticle|article|blogposting|report|techarticle)$/i);
    const ogType = doc.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? '';
    const listNoun = () => { const n = nounFor(itemList ? [itemList] : nodes); return n === 'items' && list.priced ? 'products' : n; };

    const product = (): PageSummary => ({ kind: 'product', noun: 'products', name: clean(products[0]?.name ?? doc.querySelector('h1')?.textContent) });

    // The page says it describes one product: that product, whatever lists ("related items") sit below it.
    if (!itemList && (products.length === 1 || /product/i.test(ogType))) return product();
    if (list.items >= CLEAR_LIST || (itemList && list.items >= MIN_LIST)) return { kind: 'list', items: list.items, noun: listNoun() };
    // No such statement: a buy button by a single heading still marks a product page.
    if (looksLikeProduct(doc)) return product();
    const text = articleText(doc);
    if (((article || ogType === 'article') && text >= ARTICLE_TEXT) || text >= ARTICLE_TEXT * 2) {
        return { kind: 'article', noun: 'articles', name: clean(article?.headline ?? article?.name ?? doc.title) };
    }
    if (list.items >= MIN_LIST) return { kind: 'list', items: list.items, noun: listNoun() };
    return { kind: 'none', noun: 'items' };
}
