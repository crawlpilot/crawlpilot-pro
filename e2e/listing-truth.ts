/**
 * Ground truth for the listing scorecard: per corpus page, what to click, which elements are the
 * products, and what each product really holds (hidden text included). This is the one place that
 * knows sites; the extractor never does. Each `read` runs in the page, so it must be self-contained.
 */

export type TruthField = 'title' | 'url' | 'id' | 'price' | 'was_price' | 'rating' | 'review_count' | 'brand' | 'model';
export type TruthRow = Partial<Record<TruthField, string | number>>;

export interface ListingTruth {
    /** Corpus file name (`src/test/fixtures/corpus/<name>.html.gz`). */
    name: string;
    /** What the user clicks to pick the list: a product title in the main results. */
    click: string;
    /** Which of the matches to click (the first is sometimes in a sponsored block on purpose). */
    clickIndex?: number;
    /** The main results' products, including ones not rendered yet. */
    products: string;
    read: (card: Element) => TruthRow;
}

export const LISTINGS: ListingTruth[] = [
    {
        name: 'chewy-plp',
        click: '[data-testid="plp-product-card"] .chirp-title',
        products: '[data-testid="plp-product-card"]',
        read: (card: Element) => {
            const n = (s: string | null | undefined) => (s ? Number(s.replace(/[,$]/g, '')) : undefined);
            const link = card.querySelector('a.chirp-title__link') as HTMLAnchorElement | null;
            return {
                title: card.querySelector('.chirp-title__text')?.textContent?.replace(/\s+/g, ' ').trim(),
                url: link ? new URL(link.href).pathname : undefined,
                id: card.getAttribute('data-id') ?? undefined,
                rating: n(card.querySelector('.chirp-product-rating__rating-display')?.textContent),
                review_count: n(card.querySelector('.chirp-product-rating__count > span')?.textContent),
                price: n(/\$([\d,.]+)/.exec(card.querySelector('.chirp-pricing__row:not(.chirp-pricing__row--autoship) .chirp-price__label')?.textContent ?? '')?.[1]),
            };
        },
    },
    {
        name: 'bestbuy-search',
        click: 'li.product-list-item h3.product-title',
        products: 'li.product-list-item',
        read: (card: Element) => {
            const n = (s: string | null | undefined) => (s ? Number(s.replace(/,/g, '')) : undefined);
            const sr = card.querySelector('.c-ratings-reviews .visually-hidden')?.textContent ?? '';
            const price = card.querySelector('[data-testid="price-block-customer-price"] .sr-only')?.textContent;
            const link = card.querySelector('a.product-list-item-link') as HTMLAnchorElement | null;
            return {
                title: card.querySelector('h3.product-title')?.getAttribute('title') ?? undefined,
                url: link ? new URL(link.href).pathname : undefined,
                id: card.getAttribute('data-product-id') ?? undefined,
                rating: n(/Rating ([\d.]+) out of/.exec(sr)?.[1]),
                review_count: n(/with ([\d,]+) review/.exec(sr)?.[1]),
                price: n(/\$([\d,.]+)/.exec(price ?? '')?.[1]),
            };
        },
    },
    {
        name: 'walmart-search-live',
        click: '[data-testid="item-stack"] [data-item-id] [data-automation-id="product-title"]',
        products: '[data-testid="item-stack"] [data-item-id]',
        read: (card: Element) => {
            const n = (s: string | null | undefined) => (s ? Number(s.replace(/,/g, '')) : undefined);
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const link = card.querySelector('a[href*="/ip/"], a[href*="%2Fip%2F"]') as HTMLAnchorElement | null;
            let url: string | undefined;
            if (link) {
                const u = new URL(link.href);
                const inner = u.searchParams.get('rd');
                url = inner ? new URL(inner).pathname : u.pathname;
            }
            return {
                title: card.querySelector('[data-automation-id="product-title"]')?.textContent?.trim(),
                url,
                id: card.getAttribute('data-item-id') ?? undefined,
                price: n(/(?:current price|Price)\s*(?:Now\s*)?\$(\d[\d,]*(?:\.\d{2})?)/i.exec(text)?.[1]),
                was_price: n(/Was \$(\d[\d,]*(?:\.\d{2})?)/.exec(text)?.[1]),
                rating: n(/([\d.]+) out of 5 Stars/i.exec(text)?.[1]),
                review_count: n(/Stars\. ([\d,]+) reviews/i.exec(text)?.[1]),
            };
        },
    },
    ...(['amazon-search', 'amazon-category', 'amazon-grocery'] as const).map(name => ({
        name,
        click: '[data-component-type="s-search-result"] h2',
        products: '[data-component-type="s-search-result"]',
        read: (card: Element) => {
            const n = (s: string | null | undefined) => (s ? Number(s.replace(/,/g, '')) : undefined);
            const link = card.querySelector('a.a-link-normal[href*="/dp/"], h2 a, a:has(h2)') as HTMLAnchorElement | null;
            const ratings = Array.from(card.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label') || '').find(l => /^[\d,]+ ratings?$/.test(l));
            return {
                // A sponsored card's label says so ("Sponsored Ad - …") and its link is the ad click, the product address in it.
                title: (card.querySelector('h2')?.getAttribute('aria-label') || card.querySelector('h2')?.textContent || '').replace(/^Sponsored Ad - /, '').trim() || undefined,
                url: link ? new URL(new URL(link.href).searchParams.get('url') ?? link.href, link.href).pathname.replace(/\/ref=.*$/, '') : undefined,
                id: card.getAttribute('data-asin') ?? undefined,
                rating: n(/([\d.]+) out of 5/.exec(card.querySelector('.a-icon-alt')?.textContent ?? '')?.[1]),
                review_count: n(ratings?.replace(/ ratings?$/, '')),
                price: n(/\$([\d,.]+)/.exec(card.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent ?? '')?.[1]),
            };
        },
    })),
    {
        name: 'homedepot-search',
        click: '.browse-search__pod [data-testid="attribute-product-label"]',
        products: '.browse-search__pod',
        read: (card: Element) => {
            const n = (s: string | null | undefined) => (s ? Number(s.replace(/,/g, '')) : undefined);
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const rr = /\(([\d.]+) \/ ([\d,]+)\)/.exec(text);
            const link = card.querySelector('a[href*="/p/"]') as HTMLAnchorElement | null;
            const dollars = /\$\s*([\d,]+)\s*\.?\s*(\d{2})/.exec(card.querySelector('[data-testid="price-simple"], [class*="price-format"]')?.textContent ?? text);
            return {
                title: card.querySelector('[data-testid="attribute-product-label"]')?.textContent?.trim(),
                brand: card.querySelector('[data-testid="attribute-brandname-above"], [data-testid="attribute-brandname-inline"]')?.textContent?.trim(),
                url: link ? new URL(link.href).pathname : undefined,
                id: card.querySelector('[data-product-id]')?.getAttribute('data-product-id') ?? undefined,
                rating: n(rr?.[1]),
                review_count: n(rr?.[2]),
                // The leaf that holds it: the card's text runs values together ("Model# H300MTS$249.00").
                model: /Model#\s*(\S+)/i.exec(Array.from(card.querySelectorAll('*')).find(e => e.children.length === 0 && /Model#/.test(e.textContent || ''))?.textContent ?? '')?.[1],
                price: dollars ? Number(`${dollars[1].replace(/,/g, '')}.${dollars[2]}`) : undefined,
            };
        },
    },
];
