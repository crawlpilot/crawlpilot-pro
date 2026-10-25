import { describe, expect, it } from 'vitest';
import { bindToData, readBinding, sourcesOf } from './dataBinding';
import { bindingsFor, scanPageJson, type PickedAttribute } from '../../../shared/pageJson/scan';
import { loadPage } from '../../../test/corpus/measure';

/** The page's main item, its attributes ticked and named as a schema names them, read as a run reads them. */
function read(page: string, picks: PickedAttribute[]): Record<string, unknown> {
    loadPage(`corpus/${page}.html.gz`);
    const item = scanPageJson(sourcesOf()).find(c => c.kind === 'item')!;
    return Object.fromEntries(bindingsFor(item, picks).map(e => [e.name, readBinding(e.data)]));
}

describe('a product page\'s attributes, picked and named as the person\'s schema', { timeout: 30_000 }, () => {
    it('uniqlo.com: the JSON-LD product, one price from the variants, every image as a list', () => {
        loadPage('corpus/pdp-uniqlo.html.gz');
        const item = scanPageJson(sourcesOf()).find(c => c.kind === 'item')!;
        expect(item.title).toBe('ProductGroup');
        const keys = item.attributes.map(a => a.key);
        expect(keys).toEqual(expect.arrayContaining(['name', 'brand.name', 'description', 'url', 'image', 'material', 'hasVariant[*].offers.price']));

        expect(read('pdp-uniqlo', [
            { key: 'brand.name', name: 'brand' },
            { key: 'name', name: 'title' },
            { key: 'hasVariant[*].offers.price', name: 'price', many: true, first: true },
            { key: 'image', name: 'images', many: true },
            { key: 'material', name: 'composition' },
        ])).toMatchObject({
            brand: 'UNIQLO', title: 'Oversized Sweatshirt', price: '2490',
            images: expect.arrayContaining([expect.stringMatching(/^https:\/\/image\.uniqlo\.com\/.+\.jpg$/)]),
            composition: 'Body: 67% Polyester, 33% Cotton/ Rib: 82% Cotton, 18% Polyester',
        });
    });

    it('zara.com: the specifications list read whole as one object', () => {
        loadPage('corpus/pdp-zara.html.gz');
        const specs = scanPageJson(sourcesOf()).find(c => c.kind === 'item')!.attributes.find(a => a.pairs);
        expect(specs).toMatchObject({ key: 'additionalProperty', pairs: ['name', 'value'], sample: 'OUTER SHELL: 100% cotton' });
        const r = read('pdp-zara', [{ key: 'additionalProperty', name: 'product_specifications' }, { key: 'hasVariant[*].size', name: 'sizes', many: true }]);
        expect(JSON.parse(String(r.product_specifications))).toEqual({ 'OUTER SHELL': '100% cotton' });
        expect(r.sizes).toEqual(expect.arrayContaining(['EU 36 (UK 29)']));
    });

    it('zara.com: a picked image, shown at another width, is the JSON-LD image', () => {
        loadPage('corpus/pdp-zara.html.gz');
        const product = sourcesOf().map(s => s.data as any).find(d => d?.['@type'] === 'ProductGroup');
        const url = new URL(product.image[0]);
        url.searchParams.set('w', '563');
        const img = document.createElement('img');
        img.src = url.href;
        document.body.appendChild(img);
        const b = bindToData(img, 'image')!;
        expect(b).toMatchObject({ kind: 'ld', as: 'text', ops: [{ op: 'absoluteUrl' }] });
        expect(readBinding(b)).toBe(product.image[0]);
    });
});
