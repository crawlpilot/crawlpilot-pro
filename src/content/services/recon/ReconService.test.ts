import { describe, it, expect } from 'vitest';
import { collectEmbedded, detectFrameworks, detectPagination } from './ReconService';

function doc(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
}

describe('collectEmbedded', () => {
    it('finds JSON-LD with types, __NEXT_DATA__, inline state, microdata and OpenGraph', () => {
        const big = JSON.stringify({ props: { pageProps: { products: Array.from({ length: 20 }, (_, i) => ({ id: i, name: `P${i}` })) } } });
        const d = doc(`<html><head>
            <meta property="og:title" content="Lamp"><meta property="product:price:amount" content="9.99">
            <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Lamp"},{"@type":"BreadcrumbList"}]}</script>
            <script id="__NEXT_DATA__" type="application/json">${big}</script>
            <script>window.__INITIAL_STATE__ = {"cart":{"items":[]}};</script>
            </head><body><div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Lamp</span></div></body></html>`);
        const e = collectEmbedded(d);
        const kinds = e.map(x => x.kind);
        expect(kinds).toEqual(expect.arrayContaining(['json-ld', 'next-data', 'inline-state', 'microdata', 'opengraph']));
        expect(e.find(x => x.kind === 'json-ld')!.types).toEqual(['Product', 'BreadcrumbList']);
        expect(e.find(x => x.kind === 'inline-state')!.json).toContain('"cart"');
        expect(e.find(x => x.kind === 'next-data')!.json).toContain('pageProps');
    });

    it('skips tiny JSON config scripts', () => {
        const d = doc('<script type="application/json" id="cfg">{"a":1}</script>');
        expect(collectEmbedded(d)).toHaveLength(0);
    });
});

describe('detectFrameworks', () => {
    it('recognises Next.js and Shopify', () => {
        const d = doc('<div id="__next"></div><script src="https://cdn.shopify.com/s/x.js"></script>');
        expect(detectFrameworks(d)).toEqual(expect.arrayContaining(['Next.js', 'React', 'Shopify']));
    });
});

describe('detectPagination', () => {
    it('finds rel=next, page params and load-more buttons', () => {
        const d = doc('<link rel="next" href="https://ex.com/c?page=2"><a href="/c?page=3">3</a><button>Load more</button>');
        const p = detectPagination(d, 'https://ex.com/c');
        expect(p.relNext).toContain('page=2');
        expect(p.pageParam).toBe('page');
        expect(p.loadMore).toBe(true);
    });
});
