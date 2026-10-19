import { describe, expect, it } from 'vitest';
import { loadPage } from '../../../test/corpus/measure';
import { collectPageData } from './pageData';
import { checkSources, dottedPath, entitiesOf, jsonPointer, schemaLines, searchTree, typeOf } from '../../../shared/structured/pageData';
import { getDotted } from '../extraction/structuredRows';
import { parseSchemaInput } from '../../../shared/ai/schemaIntake';
import { runPageExtract, type PageAccess } from '../../../sidepanel/services/ai/extractRun';
import { buildPageView, ground } from '../ai-view/pageView';

const page: PageAccess = { view: async (c, m) => buildPageView(c, m, { live: false }), ground: async r => ground(r) };

describe('data on this page (fixture)', () => {
    it('JSON-LD (and a broken block), microdata, RDFa, meta tags and app state', () => {
        document.head.innerHTML = `<meta property="og:title" content="Lamp"><meta name="twitter:card" content="summary"><meta name="description" content="A lamp"><meta name="viewport" content="width=device-width">
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lamp","offers":{"@type":"Offer","price":"49.00"}}</script>
            <script type="application/ld+json">{"@type": "Article", oops}</script>`;
        document.body.innerHTML = `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Lamp</span><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><span itemprop="price">49</span></div></div>
            <div vocab="https://schema.org/" typeof="Event"><span property="name">Launch</span></div>
            <script>window.__INITIAL_STATE__ = {"cart":{"items":[{"sku":"L1"}]}};</script>
            <script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { product: { id: 1, title: 'Lamp', pad: 'x'.repeat(200) } } } })}</script>`;
        const sources = collectPageData(document);
        expect(sources.map(s => [s.kind, s.label])).toEqual([
            ['json-ld', 'JSON-LD · Product'], ['json-ld', 'JSON-LD'], ['microdata', 'Microdata'], ['rdfa', 'RDFa'],
            ['meta', 'Meta tags'], ['app-state', '__NEXT_DATA__'], ['app-state', '__INITIAL_STATE__'],
        ]);
        expect(sources[1].error).toBeTruthy();
        expect(sources[2].data).toEqual({ '@type': 'Product', name: 'Lamp', offers: { '@type': 'Offer', price: '49' } });
        expect(sources[3].data).toEqual({ '@type': 'Event', name: 'Launch' });
        expect(sources[4].data).toEqual({ 'Open Graph': { 'og:title': 'Lamp' }, Twitter: { 'twitter:card': 'summary' }, Named: { description: 'A lamp' } });
        expect(getDotted(sources[6].data, 'cart.items.0.sku')).toBe('L1');
        expect(searchTree(sources[6].data, 'l1')).toEqual([['cart', 'items', 0, 'sku']]);
        expect(searchTree(sources[6].data, 'ITEMS')).toEqual([['cart', 'items']]);

        const checks = checkSources(sources);
        expect(checks.map(c => c.message)).toEqual(expect.arrayContaining([
            expect.stringMatching(/^JSON-LD: not valid JSON/),
            'Product: no offers.priceCurrency (recommended)',
            'Event: no startDate',
        ]));
        expect(checks.some(c => c.message.startsWith('Product: no name'))).toBe(false);
    });

    it('paths: dotted and JSON pointer', () => {
        expect(dottedPath(['offers', 0, 'price'])).toBe('offers.0.price');
        expect(jsonPointer(['a/b', 'c~d', 2])).toBe('/a~1b/c~0d/2');
    });
});

describe('data on corpus product pages', () => {
    for (const name of ['uniqlo', 'zara']) {
        it(`${name}: the Product shows with its price; paths read back; its schema is answered with no model`, async () => {
            loadPage(`corpus/pdp-${name}.html.gz`);
            const sources = collectPageData(document);
            const products = sources.flatMap(s => entitiesOf(s.data).map(e => ({ ...e, source: s }))).filter(e => typeOf(e.entity) === 'Product');
            expect(products.length).toBeGreaterThan(0);
            const { entity, path, source } = products[0];
            expect(getDotted(entity, 'offers.price') ?? getDotted(entity, 'offers.0.price')).toBeTruthy();
            expect(getDotted(source.data, dottedPath(path))).toBe(entity);

            // "Use in AI Extract": every line answered from the page's structured data, no model.
            const intake = parseSchemaInput(schemaLines(entity));
            expect(intake.error).toBeFalsy();
            expect(intake.fields.map(f => f.name)).toEqual(expect.arrayContaining(['name', 'offers__price']));
            delete (globalThis as any).LanguageModel;
            const outcome = await runPageExtract(intake, { page });
            expect(Object.values(outcome.single).every(v => v.status === 'structured')).toBe(true);
            expect(outcome.single.offers__price.text).toBe(String(getDotted(entity, 'offers.price') ?? getDotted(entity, 'offers.0.price')));
        });
    }

    it('walmart: no schema.org Product, but its price is found in the Next.js app state', () => {
        loadPage('corpus/pdp-walmart.html.gz');
        const state = collectPageData(document).find(s => s.label === '__NEXT_DATA__')!;
        const hits = searchTree(state.data, 'price');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(p => getDotted(state.data, dottedPath(p)) !== undefined)).toBe(true);
    });

    it('amazon: meta tags only', () => {
        loadPage('corpus/pdp-amazon.html.gz');
        expect(collectPageData(document).map(s => s.kind)).toEqual(['meta']);
    });
});
