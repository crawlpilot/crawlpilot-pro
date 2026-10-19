/**
 * Tier 0 of AI Extract: answers from the page's own structured data (JSON-LD, microdata, Open Graph and
 * product meta), with no model call (docs/plans/ai-extract-markdown-plan.md §3.2). A hit costs nothing
 * and is exact: on a product page this alone often fills title, price, currency, brand, SKU, rating and
 * availability.
 *
 * Fields match by name: a field's name (and its words) is looked up in a synonym table of schema.org
 * paths (`price` → `offers.price`), then as a property of the entity (`color` → `color`). The entity
 * read is the one that answers most fields. Lists come from an `ItemList` or from 2+ entities of the
 * same type (a listing's `Product`s).
 */
import type { SchemaField, SchemaList } from './schemaIntake';

export interface StructuredData {
    /** Every JSON-LD and microdata object with a `@type`, nested ones included (an `Offer` in a `Product`). */
    entities: Record<string, any>[];
    /** `og:*`, `product:*`, `article:*`, `twitter:*` and named meta tags. */
    meta: Record<string, string>;
}

export interface StructuredHit {
    value: string;
    /** Where it came from: `Product.offers.price`, `meta og:title`. */
    source: string;
}

const SYNONYMS: [RegExp, string[]][] = [
    [/^(title|name|product_?name|product_?title|headline)$/, ['name', 'headline']],
    [/^(price|current_?price|sale_?price|selling_?price|amount)$/, ['offers.price', 'offers.lowPrice', 'price']],
    [/^(currency|price_?currency)$/, ['offers.priceCurrency', 'priceCurrency']],
    [/^(brand|manufacturer|maker)$/, ['brand.name', 'brand', 'manufacturer.name', 'manufacturer']],
    [/^(rating|stars|average_?rating|rating_?value|score)$/, ['aggregateRating.ratingValue']],
    [/^(reviews?_?count|reviews|ratings?_?count|number_?of_?reviews|review_?count)$/, ['aggregateRating.reviewCount', 'aggregateRating.ratingCount']],
    [/^(availability|stock|in_?stock|stock_?status)$/, ['offers.availability']],
    [/^(image|photo|picture|thumbnail|main_?image|image_?url)$/, ['image.url', 'image', 'thumbnailUrl']],
    [/^(sku|product_?id|item_?id|model|mpn|gtin|ean|upc|model_?number)$/, ['sku', 'mpn', 'gtin13', 'gtin12', 'gtin', 'productID', 'model']],
    [/^(description|summary|about|details)$/, ['description']],
    [/^(author|byline|writer)$/, ['author.name', 'author']],
    [/^(published|date|published_?date|date_?published|publish_?date|posted|date_?posted)$/, ['datePublished', 'dateCreated', 'datePosted']],
    [/^(updated|modified|date_?modified)$/, ['dateModified']],
    [/^(url|link|product_?url|page_?url|website|homepage)$/, ['url']],
    [/^(company|employer|hiring_?organization|organization)$/, ['hiringOrganization.name', 'hiringOrganization']],
    [/^(location|city|job_?location)$/, ['jobLocation.address.addressLocality', 'address.addressLocality', 'jobLocation.address']],
    [/^(salary|pay|compensation|salary_?range)$/, ['baseSalary.value.value', 'baseSalary.value.minValue', 'baseSalary.value']],
    [/^(employment_?type|job_?type)$/, ['employmentType']],
    [/^(phone|telephone|phone_?number|tel)$/, ['telephone']],
    [/^(email|e_?mail)$/, ['email']],
    [/^(address|street_?address)$/, ['address.streetAddress', 'address']],
    [/^(hours|opening_?hours|open_?hours)$/, ['openingHours']],
    [/^(category|categories)$/, ['category']],
    [/^(color|colour)$/, ['color']],
];

const META: [RegExp, string[]][] = [
    [/^(title|name|headline)$/, ['og:title', 'twitter:title']],
    [/^(description|summary)$/, ['og:description', 'description', 'twitter:description']],
    [/^(image|photo|thumbnail|main_?image)$/, ['og:image', 'twitter:image']],
    [/^(price|current_?price|sale_?price)$/, ['product:price:amount', 'og:price:amount']],
    [/^(currency|price_?currency)$/, ['product:price:currency', 'og:price:currency']],
    [/^(author|byline)$/, ['author', 'article:author']],
    [/^(published|date|published_?date|date_?published)$/, ['article:published_time']],
    [/^(url|link|page_?url)$/, ['og:url']],
    [/^(site|site_?name|publisher)$/, ['og:site_name']],
    [/^(brand)$/, ['product:brand', 'og:brand']],
    [/^(availability|stock)$/, ['product:availability', 'og:availability']],
];

const norm = (name: string) => name.toLowerCase().replace(/[\s-]+/g, '_');
const camel = (name: string) => norm(name).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** A JSON-LD value as text: the first of an array, an object's `name`/`url`/`@value`, schema.org URLs shortened. */
function asText(v: unknown): string | null {
    if (Array.isArray(v)) return v.length ? asText(v[0]) : null;
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return asText(o.name ?? o.url ?? o['@value'] ?? o.contentUrl ?? null);
    }
    const text = String(v).trim();
    if (!text) return null;
    return text.replace(/^https?:\/\/schema\.org\//i, '');
}

function at(entity: Record<string, any>, path: string): unknown {
    let cur: any = entity;
    for (const key of path.split('.')) {
        if (Array.isArray(cur)) cur = cur[0];
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = cur[key];
    }
    return cur;
}

const typeOf = (e: Record<string, any>) => (Array.isArray(e['@type']) ? e['@type'][0] : e['@type']) as string | undefined;

/** Paths to try for a field: its synonyms, then the field itself as a property. */
function pathsFor(field: SchemaField): string[] {
    const name = norm(field.name);
    const paths = SYNONYMS.filter(([re]) => re.test(name)).flatMap(([, p]) => p);
    return [...paths, camel(field.name), field.name];
}

function answer(entity: Record<string, any>, field: SchemaField): StructuredHit | null {
    for (const path of pathsFor(field)) {
        const value = asText(at(entity, path));
        if (value) return { value, source: `${typeOf(entity) ?? 'Thing'}.${path}` };
    }
    return null;
}

const SKIP_TYPES = /^(BreadcrumbList|WebSite|WebPage|SearchAction|Organization|ListItem|ImageObject|Offer|AggregateOffer|AggregateRating|Rating|Brand|PostalAddress|Person|SiteNavigationElement|EntryPoint)$/;

/** Single answers: from the entity that answers most fields, then meta tags for the rest. */
export function structuredAnswers(fields: SchemaField[], data: StructuredData): Record<string, StructuredHit> {
    const candidates = data.entities.filter(e => !SKIP_TYPES.test(typeOf(e) ?? ''));
    let best: Record<string, StructuredHit> = {};
    for (const entity of candidates) {
        const hits: Record<string, StructuredHit> = {};
        for (const f of fields) { const h = answer(entity, f); if (h) hits[f.name] = h; }
        if (Object.keys(hits).length > Object.keys(best).length) best = hits;
    }
    for (const f of fields) {
        if (best[f.name]) continue;
        const name = norm(f.name);
        const keys = META.filter(([re]) => re.test(name)).flatMap(([, k]) => k);
        const key = keys.find(k => data.meta[k]?.trim());
        if (key) best[f.name] = { value: data.meta[key].trim(), source: `meta ${key}` };
    }
    return best;
}

/** The entities that make up a list: an `ItemList`'s items, or 2+ entities of one type. */
function listEntities(data: StructuredData): Record<string, any>[] {
    for (const e of data.entities) {
        if (typeOf(e) !== 'ItemList' || !Array.isArray(e.itemListElement)) continue;
        const items = e.itemListElement.map((li: any) => (li && typeof li === 'object' && li.item && typeof li.item === 'object' ? { ...li, ...li.item } : li)).filter((x: any) => x && typeof x === 'object');
        if (items.length >= 2) return items;
    }
    const byType = new Map<string, Record<string, any>[]>();
    for (const e of data.entities) {
        const t = typeOf(e);
        if (!t || SKIP_TYPES.test(t)) continue;
        byType.set(t, [...(byType.get(t) ?? []), e]);
    }
    const groups = [...byType.values()].filter(g => g.length >= 2).sort((a, b) => b.length - a.length);
    return groups[0] ?? [];
}

/** List items from structured data: each item's answers, when the list's fields are mostly answered. */
export function structuredList(list: SchemaList, data: StructuredData): Record<string, StructuredHit>[] {
    const items = listEntities(data).map(e => {
        const hits: Record<string, StructuredHit> = {};
        for (const f of list.fields) { const h = answer(e, f); if (h) hits[f.name] = h; }
        return hits;
    }).filter(h => Object.keys(h).length > 0);
    // A list whose items answer under half the fields (an ItemList of bare URLs) is left to the model.
    const answered = items.reduce((n, h) => n + Object.keys(h).length, 0);
    return items.length >= 2 && answered >= items.length * list.fields.length * 0.5 ? items : [];
}

/** Reads a document's structured data (runs in the page). */
export function collectStructured(doc: Document): StructuredData {
    const entities: Record<string, any>[] = [];
    const visit = (node: unknown, depth: number) => {
        if (depth > 6 || node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(n => visit(n, depth + 1)); return; }
        const o = node as Record<string, any>;
        if (o['@type']) entities.push(o);
        if (Array.isArray(o['@graph'])) o['@graph'].forEach((n: unknown) => visit(n, depth + 1));
        for (const [k, v] of Object.entries(o)) if (k !== '@graph' && v && typeof v === 'object') visit(v, depth + 1);
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { visit(JSON.parse(s.textContent || ''), 0); } catch { /* malformed JSON-LD */ }
    });

    // Microdata: each itemscope as an object of its itemprops (nested scopes as objects).
    const readScope = (scope: Element): Record<string, any> => {
        const out: Record<string, any> = {};
        const type = scope.getAttribute('itemtype');
        if (type) out['@type'] = type.split('/').pop();
        scope.querySelectorAll('[itemprop]').forEach(el => {
            if (el.parentElement?.closest('[itemscope]') !== scope) return;
            const name = el.getAttribute('itemprop')!;
            const value = el.hasAttribute('itemscope') ? readScope(el)
                : el.getAttribute('content') ?? el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('datetime') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!(name in out)) out[name] = value;
        });
        return out;
    };
    doc.querySelectorAll('[itemscope]').forEach(scope => {
        const o = readScope(scope);
        if (o['@type']) entities.push(o);
    });

    const meta: Record<string, string> = {};
    doc.querySelectorAll('meta[property], meta[name]').forEach(m => {
        const key = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
        const content = m.getAttribute('content');
        if (key && content && !(key in meta)) meta[key] = content;
    });
    return { entities, meta };
}
