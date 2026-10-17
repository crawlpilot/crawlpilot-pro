/**
 * Annotated targets of the selector corpus. The selectors here are ground truth, written by hand to
 * find each target in the fixture; they are never what is measured.
 */
import type { AtomAttr } from '../../content/services/extraction/atoms';

export interface FieldTarget {
    name: string;
    /** Row-relative selector of the element holding the value. */
    at: string;
    attr: AtomAttr;
}

export interface PageTargets {
    /** File in `src/test/fixtures` (`.html.gz` is gunzipped). */
    file: string;
    list: {
        container: string;
        /** The item set, relative to the container. */
        items: string;
        fields: FieldTarget[];
    };
    /** Single elements a Page Extractor pick could target, document-wide (the first match). */
    elements: { name: string; at: string }[];
    /** A Next / Load more control, document-wide. */
    next?: string;
}

export const CORPUS: Record<string, PageTargets> = {
    'amazon-search': {
        file: 'corpus/amazon-search.html.gz',
        list: {
            container: '.s-main-slot',
            items: ':scope > [data-component-type="s-search-result"]',
            fields: [
                { name: 'title', at: 'h2 span', attr: 'text' },
                { name: 'url', at: '[data-cy="title-recipe"] a', attr: 'href' },
                { name: 'image', at: 'img.s-image', attr: 'src' },
                { name: 'price', at: '.a-price', attr: 'text' },
            ],
        },
        elements: [
            { name: 'title', at: '[data-component-type="s-search-result"] h2 span' },
            { name: 'price', at: '[data-component-type="s-search-result"] .a-price' },
        ],
        next: '.s-pagination-next',
    },
    'walmart-search': {
        file: 'corpus/walmart-search.html.gz',
        list: {
            container: '[data-testid="item-stack"]',
            items: ':scope > div:has([data-item-id])',
            fields: [
                { name: 'title', at: '[data-automation-id="product-title"]', attr: 'text' },
                { name: 'url', at: 'a[link-identifier]', attr: 'href' },
                { name: 'image', at: '[data-testid="productTileImage"]', attr: 'src' },
                { name: 'price', at: '[data-testid="unified-global-product-price-a11y-text"]', attr: 'text' },
                { name: 'was price', at: '[data-testid="ugpp-was-price"]', attr: 'text' },
            ],
        },
        elements: [
            { name: 'title', at: '[data-automation-id="product-title"]' },
            { name: 'price', at: '[data-testid="unified-global-product-price"]' },
        ],
    },
    'walmart-carousel': {
        file: 'walmart-carousel.html',
        list: {
            container: '[data-testid="carousel-container"]',
            items: ':scope > li',
            fields: [
                { name: 'title', at: '[data-automation-id="product-title"]', attr: 'text' },
                { name: 'image', at: '[data-testid="productTileImage"]', attr: 'src' },
            ],
        },
        elements: [{ name: 'title', at: '[data-automation-id="product-title"]' }],
    },
    'bootstrap-grid': {
        file: 'bootstrap-grid.html',
        list: {
            container: '#results',
            items: ':scope > .col-md-4',
            fields: [
                { name: 'title', at: '.card-title a', attr: 'text' },
                { name: 'url', at: '.card-title a', attr: 'href' },
                { name: 'price', at: '.price', attr: 'text' },
            ],
        },
        elements: [{ name: 'title', at: '#results .card-title a' }],
    },
    'tailwind-grid': {
        file: 'tailwind-grid.html',
        list: {
            container: '[data-role="results"]',
            items: ':scope > li',
            fields: [
                { name: 'title', at: 'a', attr: 'text' },
                { name: 'price', at: 'p', attr: 'text' },
            ],
        },
        elements: [{ name: 'title', at: '[data-role="results"] a' }],
    },
    'emotion-hashed': {
        file: 'emotion-hashed.html',
        list: {
            container: 'section',
            items: ':scope > [data-testid="job-card"]',
            fields: [
                { name: 'title', at: 'h3 a', attr: 'text' },
                { name: 'location', at: 'span', attr: 'text' },
            ],
        },
        elements: [{ name: 'title', at: '[data-testid="job-card"] h3 a' }],
    },
};
