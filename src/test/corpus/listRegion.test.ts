/**
 * The list region (docs/plans/ai-extract-v2-plan.md §3.2): on every saved listing it is the container
 * that holds the annotated items; on articles, docs and most product pages there is none, so the
 * whole page is read.
 */
import { describe, expect, it } from 'vitest';
import { loadPage } from './measure';
import { CORPUS } from './targets';
import { listRegion } from '../../content/services/ai-view/listRegion';

describe('list region on corpus pages', () => {
    for (const name of ['amazon-search', 'amazon-category', 'cos-search', 'walmart-search', 'walmart-carousel']) {
        it(`${name}: holds every annotated item`, () => {
            const t = CORPUS[name];
            loadPage(t.file);
            const region = listRegion(document.body);
            const items = Array.from(document.querySelector(t.list.container)!.querySelectorAll(t.list.items));
            expect(region).not.toBeNull();
            expect(items.filter(i => region!.el.contains(i))).toHaveLength(items.length);
        });
    }

    for (const file of ['article-wikipedia', 'docs-mdn', 'pdp-uniqlo', 'pdp-walmart', 'pdp-zara']) {
        it(`${file}: no list region (an article's sections, a cookie panel and spec rows aren't a listing)`, () => {
            loadPage(`corpus/${file}.html.gz`);
            expect(listRegion(document.body)).toBeNull();
        });
    }
});
