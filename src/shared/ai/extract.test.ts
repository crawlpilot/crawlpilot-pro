import { describe, it, expect } from 'vitest';
import { structuredAnswers, structuredList, collectStructured } from './structured';
import { mergeItems, selectBlocks } from './merge';
import { chunkMarkdown, markdownBlocks } from '../markdown/chunks';
import { parseSchemaInput } from './schemaIntake';

const fields = (text: string) => parseSchemaInput(text).fields;

describe('structured data (T0)', () => {
    const product = {
        '@context': 'https://schema.org', '@type': 'Product', name: 'Desk Lamp', sku: 'DL-1',
        brand: { '@type': 'Brand', name: 'Acme' },
        offers: [{ '@type': 'Offer', price: '24.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }],
        aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 120 },
        image: ['https://x.test/a.jpg'],
    };

    it('answers from the entity that answers most fields, synonyms and nested paths', () => {
        document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebSite', name: 'Shop' }, product] })}</script><meta property="og:description" content="A lamp.">`;
        const data = collectStructured(document);
        const hits = structuredAnswers(fields('title\nprice\ncurrency\nbrand\nrating\nreviews_count\navailability\nimage\nsku\ndescription\nwarranty'), data);
        expect(Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.value]))).toEqual({
            title: 'Desk Lamp', price: '24.99', currency: 'USD', brand: 'Acme', rating: '4.6', reviews_count: '120',
            availability: 'InStock', image: 'https://x.test/a.jpg', sku: 'DL-1', description: 'A lamp.',
        });
        expect(hits.price.source).toBe('Product.offers.price');
        expect(hits.description.source).toBe('meta og:description');
    });

    it('lists from an ItemList or repeated entities; a list of bare URLs is left to the model', () => {
        const list = parseSchemaInput('products[]: title, price').lists[0];
        const items = [1, 2, 3].map(i => ({ '@type': 'Product', name: `Lamp ${i}`, offers: { price: `${i}0` } }));
        document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })) })}</script>`;
        expect(structuredList(list, collectStructured(document)).map(h => [h.title.value, h.price.value])).toEqual([['Lamp 1', '10'], ['Lamp 2', '20'], ['Lamp 3', '30']]);
        document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [1, 2, 3].map(i => ({ '@type': 'ListItem', url: `https://x.test/${i}` })) })}</script>`;
        expect(structuredList(list, collectStructured(document))).toEqual([]);
    });

    it('reads microdata', () => {
        document.head.innerHTML = '';
        document.body.innerHTML = '<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Chair</h1><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="99.00"></div></div>';
        const hits = structuredAnswers(fields('title\nprice'), collectStructured(document));
        expect([hits.title.value, hits.price.value]).toEqual(['Chair', '99.00']);
    });
});

describe('chunks and block selection', () => {
    const md = ['# Lamp [b1]', 'Intro text. [b2]', '```js\nconst a = 1;\n\nconst b = 2;\n```', '| a | b |\n| --- | --- |\n| 1 | 2 | [b3]\n| 3 | 4 | [b4]\n| 5 | 6 | [b5]', '## Specs [b6]', 'Weight: 2 kg [b7]'].join('\n\n');

    it('keeps code fences and tables whole, splits a long table with its header', () => {
        expect(markdownBlocks(md)).toHaveLength(6);
        const chunks = chunkMarkdown(md, 40);
        expect(chunks.some(c => c.includes('const a = 1;\n\nconst b = 2;'))).toBe(true);
        const tableParts = chunks.filter(c => c.startsWith('| a | b |'));
        expect(tableParts.length).toBeGreaterThan(1);
        expect(tableParts.every(p => p.startsWith('| a | b |\n| --- | --- |'))).toBe(true);
    });

    it('selects the blocks about the fields, with their heading, in page order', () => {
        const picked = selectBlocks(chunkMarkdown(md, 60), 'weight in kg', 40);
        expect(picked).toBe('## Specs [b6]\n\nWeight: 2 kg [b7]');
    });
});

describe('mergeItems', () => {
    it('drops repeats, folds complementary items, keeps distinct ones', () => {
        const merged = mergeItems([
            { values: { title: 'Lamp', price: '' }, ref: 'b1', chunk: 0 },
            { values: { title: 'Chair', price: '$9' }, ref: 'b5', chunk: 0 },
            { values: { title: 'lamp', price: '$5' }, ref: 'b9', chunk: 1 },
            { values: { title: 'Chair', price: '$9' }, ref: 'b9', chunk: 1 },
            { values: { title: 'Chair', price: '$10' }, ref: 'b12', chunk: 1 },
        ]);
        expect(merged.map(m => m.values)).toEqual([{ title: 'Lamp', price: '$5' }, { title: 'Chair', price: '$9' }, { title: 'Chair', price: '$10' }]);
    });
});
