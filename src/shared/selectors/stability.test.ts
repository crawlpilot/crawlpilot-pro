import { describe, it, expect } from 'vitest';
import { isUnstableClass, isHashClass, isStableAttributeValue, isVolatileSelector, filterPersistableChain, isStableId, isUtilityByFrequency, xpathLiteral } from './stability';

describe('isUnstableClass', () => {
    it('flags Tailwind utility classes', () => {
        expect(isUnstableClass('w-4')).toBe(true);
        expect(isUnstableClass('flex')).toBe(true);
        expect(isUnstableClass('bg-red-500')).toBe(true);
        expect(isUnstableClass('hover:underline')).toBe(true);
        expect(isUnstableClass('[--border-width:1px]')).toBe(true);
    });
    it('flags CSS-in-JS hash classes', () => {
        expect(isUnstableClass('css-dy3i81')).toBe(true);
        expect(isUnstableClass('sc-abc12')).toBe(true);
    });
    it('flags versioned/state classes', () => {
        expect(isUnstableClass('layout-ss26')).toBe(true);
        expect(isUnstableClass('active')).toBe(true);
    });
    it('flags Tachyons-style atomic utilities', () => {
        for (const c of ['ma0', 'mr2', 'mr2-xl', 'ph1', 'mv1', 'nl2', 'f6', 'f5-l', 'lh-title', 'nearer-mid-gray', 'mid-gray', 'black', 'ws-normal', 'dib', 'tc', 'br-pill', 'b']) {
            expect(isUnstableClass(c), c).toBe(true);
        }
        for (const c of ['price', 'brand', 'badge', 'title', 'product-title', 'gray-box-title']) {
            expect(isUnstableClass(c), c).toBe(false);
        }
    });
    it('allows semantic classes through', () => {
        expect(isUnstableClass('product-card')).toBe(false);
        expect(isUnstableClass('article-title')).toBe(false);
        expect(isUnstableClass('nav-item')).toBe(false);
    });
});

describe('isHashClass', () => {
    it('matches emotion/styled-components hash patterns', () => {
        expect(isHashClass('css-dy3i81')).toBe(true);
        expect(isHashClass('sc-bdvaja')).toBe(true);
    });
    it('matches short-prefix module hashes', () => {
        expect(isHashClass('ld_Ec')).toBe(true);
        expect(isHashClass('w_iUH7')).toBe(true);
        expect(isHashClass('ld_AY')).toBe(true);
        expect(isHashClass('my_title')).toBe(false);
        expect(isHashClass('sr_only')).toBe(false);
    });
    it('rejects semantic classes', () => {
        expect(isHashClass('product-card')).toBe(false);
        expect(isHashClass('css')).toBe(false);
    });
});

describe('isStableAttributeValue', () => {
    it('rejects always-instance-specific attributes', () => {
        expect(isStableAttributeValue('data-id', '12345')).toBe(false);
        expect(isStableAttributeValue('href', '/product/123')).toBe(false);
    });
    it('accepts vocabulary attributes regardless of value', () => {
        expect(isStableAttributeValue('role', 'button')).toBe(true);
    });
    it('accepts stable test-id values, rejects instance-shaped ones', () => {
        expect(isStableAttributeValue('data-testid', 'submit-button')).toBe(true);
        expect(isStableAttributeValue('data-testid', 'item-123456')).toBe(false);
    });
    it('rejects values with digits or URL characters for generic attrs', () => {
        expect(isStableAttributeValue('name', 'field-42')).toBe(false);
        expect(isStableAttributeValue('name', 'https://x.com')).toBe(false);
    });
    it('accepts short, stable, lowercase generic attribute values', () => {
        expect(isStableAttributeValue('name', 'search-field')).toBe(true);
    });
});

describe('isVolatileSelector', () => {
    it('flags positional and hash-class selectors', () => {
        expect(isVolatileSelector('div:nth-child(2)')).toBe(true);
        expect(isVolatileSelector('.css-dy3i81')).toBe(true);
        expect(isVolatileSelector('.sc-abc12 > span')).toBe(true);
    });
    it('allows structural/semantic selectors', () => {
        expect(isVolatileSelector('.product-card')).toBe(false);
        expect(isVolatileSelector('[data-testid="price"]')).toBe(false);
    });
});

describe('filterPersistableChain', () => {
    it('drops volatile entries when a stable entry exists', () => {
        const chain = [
            { selector: '.css-dy3i81', strategy: 'CSS Gen' },
            { selector: '.product-card', strategy: 'Minimal' },
            { selector: 'div:nth-child(3)', strategy: 'Path' },
        ];
        expect(filterPersistableChain(chain)).toEqual([{ selector: '.product-card', strategy: 'Minimal' }]);
    });
    it('keeps the whole chain when every entry is volatile', () => {
        const chain = [{ selector: '.css-dy3i81', strategy: 'CSS Gen' }, { selector: 'div:nth-child(3)', strategy: 'Path' }];
        expect(filterPersistableChain(chain)).toEqual(chain);
    });
    it('passes through empty/undefined chains unchanged', () => {
        expect(filterPersistableChain(undefined)).toBeUndefined();
        expect(filterPersistableChain([])).toEqual([]);
    });
});

// Shared cases pinned against real pages (ported from thenos stability-cases.json).
// Bootstrap col-md-* is intentionally kept usable for grid items (short col-6 was already unstable).
describe('stability rules: real-page cases', () => {
    const unstable = [
        'flex', 'grid', 'hidden', 'absolute', 'w-4', 'h-8', 'px-2', 'mt-1', 'text-sm', 'font-bold', 'bg-white',
        'border-gray', 'rounded-lg', 'transition-all', 'duration-300', 'cursor-pointer', 'sr-only', 'sc-a1b2c3',
        'css-dy3i81', 'items-center', 'justify-between', 'gap-3', 'shadow-md', 'opacity-50', 'active', 'selected',
        'open', 'layout-main', 'zds-layout-desktop', 'card-desktop', 'w-[100px]', 'hover:bg-red', 'product-ss26',
        '[--border-width:1px]', 'a', 'is-active', 'expanded', 'show', 'fade',
        'a-expander-content-expanded', 'is-open', 'has-error', 'panel--collapsed', 'menu-open', 'tab_selected',
        'a-size-medium', 'a-spacing-none', 'a-color-secondary', 'a-text-bold', 'aok-hidden', 'd-none', 'd-flex',
        'fr-ec-mb-spacing-02', 'ito-padding-vertical-16',
    ];
    const stable = [
        'product-detail-description', 'expandable-text__inner-content', 'care-list', 'price', 'product-title',
        'composition-panel', 'breadcrumb', 'review-count', 'swatch-name', 'ss26', 'facade', 'product-card',
        'article-title', 'nav-item', 'product-title-word-break', 'prodDetAttrValue', 'price-current', 'a-price-whole',
        'money-amount__main', 'openings', 'col-md-4',
    ];
    it.each(unstable)('flags %s as unstable', (c) => expect(isUnstableClass(c)).toBe(true));
    it.each(stable)('keeps %s as stable', (c) => expect(isUnstableClass(c)).toBe(false));

    it.each([
        ['css-dy3i81', true], ['sc-1mbp38s', true], ['sc-AxjAm', true], ['sc-abc12', true], ['sc-bdvaja', true],
        ['_75228706', true], ['e6d1c6b3', true], ['_3Ab4F', true], ['Button__root___1a2b3', true],
        ['price_x7f2a', true], ['jsx-2847193', true], ['x7Gh2KpQ', true],
        ['facade', false], ['decade', false], ['price', false], ['product-title', false], ['css', false],
        ['product_title', false], ['card_image', false], ['prodDetAttrValue', false],
    ] as const)('isHashClass(%s) is %s', (c, expected) => expect(isHashClass(c)).toBe(expected));

    it.each([
        ['role', 'button', true],
        ['data-testid', 'details-and-description-heading', true],
        ['aria-label', 'Add to cart', true],
        ['aria-label', 'Nike Air Max', false],
        ['data-testid', '{"a":1}', false],
        ['data-config', '{open}', false],
        ['data-label', 'two  spaces', false],
        ['aria-expanded', 'true', false],
        ['aria-selected', 'false', false],
        ['data-state', 'open', false],
        ['style', 'color: red', false],
    ] as const)('isStableAttributeValue(%s, %s) is %s', (a, v, expected) =>
        expect(isStableAttributeValue(a, v)).toBe(expected));
});

describe('shared selector rules', () => {
    it('flags border-colour, font-weight and grid-span utilities', () => {
        for (const c of ['b--near-white', 'b--light-gray', 'normal', 'fw6', 'sg-col-20-of-24', 'sg-col-inner', 'col-3-of-12']) {
            expect(isUnstableClass(c), c).toBe(true);
        }
        expect(isUnstableClass('col-md-4')).toBe(false);
    });

    it('keeps ids with underscores and short numbers, rejects generated ones', () => {
        for (const id of ['search', 'corePrice_feature_div', 'productDetails_techSpec_section_1', 'section-1', 'mainContent']) {
            expect(isStableId(id), id).toBe(true);
        }
        for (const id of ['ember123', 'react-select-2-input', 'item-12345', ':r1:', 'a7Fq2xK9', 'f3b2c1d4-e5f6', '']) {
            expect(isStableId(id), id).toBe(false);
        }
    });

    it('never embeds an instance value', () => {
        expect(isStableAttributeValue('data-item-id', 'abc')).toBe(false);
        expect(isStableAttributeValue('data-asin', 'B0ABC')).toBe(false);
        expect(isStableAttributeValue('href', '/p/1')).toBe(false);
        expect(isStableAttributeValue('data-product-sku', 'aa')).toBe(false);
        expect(isStableAttributeValue('data-offer-id', 'deal')).toBe(false);
        expect(isStableAttributeValue('data-automation-id', 'product-title')).toBe(true);
        expect(isStableAttributeValue('data-automation-id', 'item-77812')).toBe(false);
    });

    it('writes XPath literals that evaluate to the text, whatever its quotes', () => {
        document.body.innerHTML = `<a>Don't stop</a><b>Say "hi"</b><i>It's "both"</i>`;
        for (const text of [`Don't stop`, `Say "hi"`, `It's "both"`]) {
            const r = document.evaluate(`//*[normalize-space()=${xpathLiteral(text)}]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            expect(r.snapshotLength, text).toBe(1);
        }
    });

    it('counts a class spread over many elements of several tags as a utility', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="spread"></span><div class="spread"></div><a class="spread"></a>'.repeat(4) + '<li class="card"></li>'.repeat(20);
        expect(isUtilityByFrequency('spread', root)).toBe(true);
        expect(isUtilityByFrequency('card', root)).toBe(false);
    });

    it('treats more than two XPath positions as volatile, but not the nearest sibling', () => {
        expect(isVolatileSelector('//*[@id="search"]/div[1]/div[1]/span[2]')).toBe(true);
        expect(isVolatileSelector('//th[normalize-space()="Weight"]/following-sibling::td[1]')).toBe(false);
        expect(isVolatileSelector('(//a[@rel="next"])[1]')).toBe(false);
    });
});
