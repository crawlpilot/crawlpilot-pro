import { describe, it, expect } from 'vitest';
import { loadPage } from '../../test/corpus/measure';
import { summarizePage } from './pageSummary';

describe('summarizePage (what Home suggests for the open page)', { timeout: 30_000 }, () => {
    it.each([
        ['corpus/walmart-search.html.gz', 'list', 'products'],
        ['corpus/amazon-search.html.gz', 'list', undefined],
        ['corpus/amazon-category.html.gz', 'list', undefined],
        ['corpus/cos-search.html.gz', 'list', 'products'],
        ['bootstrap-grid.html', 'list', 'products'],
        ['corpus/pdp-walmart.html.gz', 'product', 'products'],
        ['corpus/pdp-uniqlo.html.gz', 'product', 'products'],
        ['corpus/pdp-zara.html.gz', 'product', 'products'],
    ])('%s is a %s', (file, kind, noun) => {
        loadPage(file);
        const s = summarizePage(document);
        expect(s.kind).toBe(kind);
        if (noun) expect(s.noun).toBe(noun);
        if (kind === 'list') expect(s.items).toBeGreaterThanOrEqual(4);
    });

    it('counts the results, not the filter sidebar or a menu of links (Amazon search)', () => {
        loadPage('corpus/amazon-search.html.gz');
        // 16 products plus sponsored slots in the results grid; the filter groups hold 50 boxes.
        expect(summarizePage(document).items).toBeLessThan(25);
    });

    it('names the product', () => {
        loadPage('corpus/pdp-zara.html.gz');
        expect(summarizePage(document).name).toBe('STRAIGHT-LEG JEANS');
    });

    it('reads a long story as an article, and a bare page as nothing in particular', () => {
        const para = 'Long-form reporting about how the harbour changed over thirty years, told by the people who work there. ';
        document.documentElement.innerHTML = `<head><meta property="og:type" content="article"><title>The harbour</title></head>
            <body><nav><ul>${'<li><a href="/x">Section</a></li>'.repeat(8)}</ul></nav><article><h1>The harbour</h1><p>${para.repeat(20)}</p></article></body>`;
        expect(summarizePage(document)).toMatchObject({ kind: 'article', name: 'The harbour' });

        document.documentElement.innerHTML = '<body><h1>Contact</h1><p>Write to us.</p></body>';
        expect(summarizePage(document).kind).toBe('none');
    });

    it('a product page with a buy button and no structured data', () => {
        document.documentElement.innerHTML = `<body><h1>Desk lamp</h1><span>$24.99</span><button>Add to cart</button>
            <section><h2>You may also like</h2><ul>${'<li><a href="/p"><img src="/a.jpg">Other lamp $9.99</a></li>'.repeat(5)}</ul></section></body>`;
        expect(summarizePage(document)).toMatchObject({ kind: 'product', name: 'Desk lamp' });
    });
});
