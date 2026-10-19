/**
 * The Page assistant's brief and citations (docs/plans/summarize-ask-plan.md P1) on corpus pages:
 * the kind of page, and checking what the model says against the page's blocks.
 */
import { describe, it, expect } from 'vitest';
import { loadPage } from './measure';
import { buildPageView, viewBlocks } from '../../content/services/ai-view/pageView';
import { checkPageClaims, rangeOf } from '../../content/services/ai-view/claims';
import { BRIEFS, briefColumns, briefRow, briefSchema, detectKind, mergeBriefs, parseBrief, parseTable, tableCsv, type PageKind } from '../../shared/ai/brief';
import { checkClaims, citedSentences, claimSupport, quoteIn, stripMarkers } from '../../shared/ai/cite';

const PAGES: [string, string, PageKind][] = [
    ['pdp-walmart', 'https://www.walmart.com/ip/x/123', 'product'],
    ['pdp-amazon', 'https://www.amazon.com/dp/B0X', 'product'],
    ['pdp-uniqlo', 'https://www.uniqlo.com/us/en/products/E123', 'product'],
    ['pdp-zara', 'https://www.zara.com/us/en/shirt-p01234.html', 'product'],
    ['walmart-search', 'https://www.walmart.com/search?q=cars', 'listing'],
    ['amazon-search', 'https://www.amazon.com/s?k=laptop', 'listing'],
    ['bestbuy-search', 'https://www.bestbuy.com/site/searchpage.jsp?st=laptop', 'listing'],
    ['chewy-plp', 'https://www.chewy.com/b/dog-treats-288', 'listing'],
    ['homedepot-search', 'https://www.homedepot.com/b/N-5yc1v/Ntk-elasticplus/Ntt-tools?NCNI-5', 'listing'],
    ['cos-search', 'https://www.cos.com/en-us/search?search=shirts', 'listing'],
    ['article-wikipedia', 'https://en.wikipedia.org/wiki/Web_scraping', 'article'],
    ['docs-mdn', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'documentation'],
];

describe('the kind of page', () => {
    for (const [name, url, kind] of PAGES) {
        it(`${name} is a ${kind} page`, () => {
            loadPage(`corpus/${name}.html.gz`);
            expect(detectKind({ ...buildPageView(6000, 3, { live: false }), url })).toBe(kind);
        });
    }

    it('a job posting by its structured data, or by its wording on a careers URL', () => {
        const structured = (types: string[]) => ({ entities: types.map(t => ({ '@type': t })), meta: {} });
        expect(detectKind({ url: 'https://x.test/a', title: '', chunks: [], structured: structured(['JobPosting', 'Organization']) })).toBe('job');
        expect(detectKind({ url: 'https://x.test/careers/123', title: '', chunks: ['Responsibilities: build things. Qualifications: 3 years.'], structured: structured([]) })).toBe('job');
        // A product's variants are one product; many products are a results page.
        expect(detectKind({ url: 'https://x.test/a', title: '', chunks: [], structured: structured(['ProductGroup', 'Product', 'Product', 'Product']) })).toBe('product');
        expect(detectKind({ url: 'https://x.test/a', title: '', chunks: [], structured: structured(['Product', 'Product', 'Product']) })).toBe('listing');
    });
});

describe('checking claims against the page', () => {
    it('a quote from the cited block is verified; from another block, relocated; made up, not on the page', () => {
        loadPage('corpus/pdp-walmart.html.gz');
        buildPageView(6000, 3, { live: false });
        const blocks = [...viewBlocks()].map(([ref, el]) => ({ ref, text: (el.textContent || '').replace(/\s+/g, ' ').trim() })).filter(b => b.text.split(' ').length >= 6);
        expect(blocks.length).toBeGreaterThan(3);
        const [a, b] = [blocks[1], blocks[blocks.length - 1]];
        const quoteA = a.text.split(' ').slice(0, 6).join(' ');
        const results = checkPageClaims([
            { key: 'cited', text: 'x', quote: quoteA, refs: [a.ref] },
            { key: 'elsewhere', text: 'x', quote: quoteA, refs: [b.ref] },
            { key: 'invented', text: 'x', quote: 'ships free to the moon in 2 days', refs: [a.ref] },
        ]);
        expect(results).toEqual([
            { key: 'cited', status: 'verified', ref: a.ref },
            { key: 'elsewhere', status: 'relocated', ref: a.ref },
            { key: 'invented', status: 'not_on_page' },
        ]);
    });

    it('a quote is found in the page text, across inline elements and spacing', () => {
        document.body.innerHTML = '<p id="p">Battery lasts <b>up to   10</b> hours, says the maker.</p>';
        const range = rangeOf(document.getElementById('p')!, 'battery lasts up to 10 hours');
        expect(range?.toString()).toBe('Battery lasts up to   10 hours');
        expect(rangeOf(document.getElementById('p')!, 'lasts for days')).toBeNull();
    });

    it('a chat sentence is supported by a block holding its numbers and most of its words', () => {
        const block = 'This 24V ride-on ATV reaches 3 mph and carries up to 66 lb.';
        expect(claimSupport('It reaches a top speed of 3 mph.', block)).toBeGreaterThanOrEqual(0.5);
        expect(claimSupport('It reaches 5 mph.', block)).toBe(0);
        const blocks = new Map([['b1', 'Free returns within 30 days.'], ['b2', block]]);
        expect(checkClaims([
            { key: 's1', text: 'It carries up to 66 lb.', refs: ['b2'] },
            { key: 's2', text: 'Returns are free within 30 days.', refs: ['b2'] },
            { key: 's3', text: 'It is waterproof to 10 meters.', refs: ['b2'] },
        ], blocks)).toEqual([
            { key: 's1', status: 'verified', ref: 'b2' },
            { key: 's2', status: 'relocated', ref: 'b1' },
            { key: 's3', status: 'not_on_page' },
        ]);
    });

    it('quotes match case and spacing aside, and nearly verbatim', () => {
        expect(quoteIn('Top Speed: 3 MPH', 'top   speed: 3 mph for kids')).toBe(true);
        expect(quoteIn('easy to assemble and fun for kids', 'Easy to assemble, and fun for the kids!')).toBe(true);
        expect(quoteIn('hard to assemble', 'Easy to assemble')).toBe(false);
    });
});

describe('the brief', () => {
    it("each kind's schema is a list of points per field, quoted unless it's the model's reading", () => {
        const schema = briefSchema('article') as any;
        expect(Object.keys(schema.properties)).toEqual(BRIEFS.article.fields.map(f => f.key));
        expect(schema.properties.points.items.required).toEqual(['text', 'quote', 'ref']);
        expect(schema.properties.angle.items.required).toEqual(['text']);
        expect(schema.properties.points.maxItems).toBe(4);
    });

    it('parses the model answer, drops empty points and bad refs, and merges chunks without repeats', () => {
        const one = parseBrief(JSON.stringify({
            gist: [{ text: 'A kids ATV', quote: '24V Kids ATV', ref: 'b3' }],
            price: [{ text: '$158.89 flash deal', quote: 'Now $158.89', ref: 'nope' }],
            specs: [{ text: '', quote: '', ref: '' }, { text: 'Top speed 3 mph', quote: 'Maximum speed 3 mph', ref: 'b40' }],
            likes: [], dislikes: [], watch: [],
        }), 'product');
        expect(one.sections.find(s => s.key === 'price')!.points[0].ref).toBe('');
        expect(one.sections.find(s => s.key === 'specs')!.points).toHaveLength(1);
        const two = parseBrief(JSON.stringify({
            gist: [{ text: 'Another gist', quote: 'x', ref: 'b90' }], price: [],
            specs: [{ text: 'top speed 3 mph', quote: 'Maximum speed 3 mph', ref: 'b40' }, { text: 'Max load 66 lb', quote: 'Max load 66 lb', ref: 'b41' }],
            likes: [], dislikes: [], watch: [],
        }), 'product');
        const merged = mergeBriefs([one, two]);
        expect(merged.sections.find(s => s.key === 'gist')!.points.map(p => p.text)).toEqual(['A kids ATV']);
        expect(merged.sections.find(s => s.key === 'specs')!.points.map(p => p.text)).toEqual(['Top speed 3 mph', 'Max load 66 lb']);
    });

    it("splits a chat answer into sentences with the blocks each cites", () => {
        const answer = 'It reaches 3 mph [b40]. It carries 66 lb [b41, b42].\n- Ages 3 to 8 [b43]';
        expect(citedSentences(answer)).toEqual([
            { text: 'It reaches 3 mph.', refs: ['b40'] },
            { text: 'It carries 66 lb.', refs: ['b41', 'b42'] },
            { text: 'Ages 3 to 8', refs: ['b43'] },
        ]);
        expect(stripMarkers(answer)).toBe('It reaches 3 mph. It carries 66 lb.\n- Ages 3 to 8');
    });
});

describe('answers become data', () => {
    it('a brief is a row of the Briefs table: found points joined, unsupported ones left out', () => {
        const brief = parseBrief(JSON.stringify({
            gist: [{ text: 'A kids ATV', quote: 'Kids ATV', ref: 'b1' }],
            points: [{ text: 'Fast', quote: 'x', ref: 'b2' }, { text: 'Made up', quote: 'y', ref: 'b3' }],
            facts: [], angle: [{ text: 'The seller’s view' }],
        }), 'article');
        const row = briefRow(brief, { url: 'https://a.test/x', title: 'X' }, (section, i) => !(section === 'points' && i === 1));
        expect(row).toEqual({ source_url: 'https://a.test/x', title: 'X', kind: 'Article', gist: 'A kids ATV', points: 'Fast', angle: "The seller’s view (the model's reading)" });
        const ids = briefColumns().map(c => c.id);
        expect(ids.slice(0, 3)).toEqual(['source_url', 'title', 'kind']);
        expect(new Set(ids).size).toBe(ids.length);
        for (const spec of Object.values(BRIEFS)) for (const f of spec.fields) expect(ids).toContain(f.key);
    });

    it('an answer as a table: rows as wide as the columns, bad refs and empty rows dropped, CSV quoted', () => {
        const table = parseTable(JSON.stringify({
            columns: ['Spec', 'Value'],
            rows: [{ cells: ['Speed', '3 mph'], ref: 'b4' }, { cells: ['', ''], ref: 'b5' }, { cells: ['Load, max'], ref: 'x' }],
        }));
        expect(table).toEqual({ columns: ['Spec', 'Value'], rows: [{ cells: ['Speed', '3 mph'], ref: 'b4' }, { cells: ['Load, max', ''], ref: '' }] });
        expect(tableCsv(table)).toBe('Spec,Value\nSpeed,3 mph\n"Load, max",');
        expect(() => parseTable('{"columns":[],"rows":[]}')).toThrow();
    });
});
