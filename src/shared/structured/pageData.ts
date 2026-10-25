/**
 * "Data on this page" (docs/plans/automation-and-page-tools-plan.md §3.8), the side that needs no page:
 * the sources' types, paths in a source (dotted and JSON pointer), checks against schema.org's
 * required and recommended properties for common types, and an entity as AI Extract schema lines.
 */
export type PageDataKind = 'json-ld' | 'microdata' | 'rdfa' | 'meta' | 'app-state';

export interface PageDataSource {
    kind: PageDataKind;
    label: string;
    /** Characters of source (JSON-LD, app state), or items / tags. */
    size: number;
    data?: unknown;
    /** It didn't parse: the parser's message. */
    error?: string;
    /** Over the size the panel shows: listed, not read. */
    tooLarge?: boolean;
    /** schema.org types in it. */
    types?: string[];
}

export type Path = (string | number)[];

/** `offers.0.price`: what `getDotted` reads back. */
export const dottedPath = (path: Path) => path.join('.');
/** `/offers/0/price` (RFC 6901). */
export const jsonPointer = (path: Path) => path.map(p => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

export const typeOf = (o: unknown): string | undefined => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    const t = (o as any)['@type'];
    return (Array.isArray(t) ? t[0] : t) ?? undefined;
};

/** schema.org: what search engines require (`!`) or recommend for the common types. */
const EXPECTED: Record<string, string[]> = {
    Product: ['name!', 'offers.price|offers.lowPrice!', 'offers.priceCurrency', 'image', 'brand', 'aggregateRating', 'sku|gtin|gtin13|mpn'],
    Article: ['headline!', 'datePublished!', 'author', 'image', 'dateModified'],
    NewsArticle: ['headline!', 'datePublished!', 'author', 'image'],
    BlogPosting: ['headline!', 'datePublished!', 'author', 'image'],
    JobPosting: ['title!', 'datePosted!', 'hiringOrganization!', 'jobLocation|applicantLocationRequirements!', 'description!', 'baseSalary', 'employmentType'],
    Recipe: ['name!', 'image!', 'recipeIngredient', 'recipeInstructions', 'totalTime'],
    Event: ['name!', 'startDate!', 'location!', 'endDate', 'offers'],
    LocalBusiness: ['name!', 'address!', 'telephone', 'openingHours|openingHoursSpecification'],
    Organization: ['name!', 'url', 'logo'],
    BreadcrumbList: ['itemListElement!'],
    FAQPage: ['mainEntity!'],
    VideoObject: ['name!', 'thumbnailUrl!', 'uploadDate!', 'description'],
};

function has(entity: Record<string, any>, path: string): boolean {
    let cur: any = entity;
    for (const key of path.split('.')) {
        if (Array.isArray(cur)) cur = cur[0];
        if (!cur || typeof cur !== 'object') return false;
        cur = cur[key];
    }
    return cur !== undefined && cur !== null && cur !== '' && !(Array.isArray(cur) && !cur.length);
}

export interface Check {
    level: 'missing' | 'recommended' | 'invalid';
    message: string;
}

/** Every entity with a `@type` in a source, nested ones included, with its path. */
export function entitiesOf(data: unknown, path: Path = [], out: { path: Path; entity: Record<string, any> }[] = [], depth = 0): { path: Path; entity: Record<string, any> }[] {
    if (depth > 8 || !data || typeof data !== 'object') return out;
    if (Array.isArray(data)) { data.forEach((d, i) => entitiesOf(d, [...path, i], out, depth + 1)); return out; }
    if (typeOf(data)) out.push({ path, entity: data as Record<string, any> });
    for (const [k, v] of Object.entries(data)) if (v && typeof v === 'object') entitiesOf(v, [...path, k], out, depth + 1);
    return out;
}

/** One line per problem: invalid JSON, a required property missing, a recommended one missing. */
export function checkSources(sources: PageDataSource[]): Check[] {
    const checks: Check[] = [];
    for (const s of sources) {
        if (s.error) checks.push({ level: 'invalid', message: `${s.label}: not valid JSON (${s.error})` });
        if (s.kind === 'meta' || s.kind === 'app-state' || s.data === undefined) continue;
        for (const { entity } of entitiesOf(s.data)) {
            const type = typeOf(entity)!;
            for (const rule of EXPECTED[type] ?? []) {
                const required = rule.endsWith('!');
                const options = rule.replace(/!$/, '').split('|');
                if (options.some(p => has(entity, p))) continue;
                checks.push({ level: required ? 'missing' : 'recommended', message: `${type}: no ${options.join(' or ')}${required ? '' : ' (recommended)'}` });
            }
        }
    }
    return checks;
}

const MAX_LINES = 25;
const SKIP_KEY = /^@(context|id|type)$/;

/**
 * An entity as AI Extract lines: one per value (`offers.price: e.g. 299.99`), arrays read through their
 * first item, nested entities to 3 levels, at most 25 lines. The dotted names keep the JSON's shape,
 * and AI Extract answers them from the page's structured data with no model.
 */
export function schemaLines(entity: Record<string, any>): string {
    const lines: string[] = [];
    const visit = (node: any, path: string[]) => {
        if (lines.length >= MAX_LINES) return;
        if (Array.isArray(node)) { if (node.length) visit(node[0], path); return; }
        if (node && typeof node === 'object') {
            if (path.length >= 3) return;
            for (const [k, v] of Object.entries(node)) if (!SKIP_KEY.test(k)) visit(v, [...path, k]);
            return;
        }
        if (node === null || node === undefined || node === '' || !path.length) return;
        const example = String(node).replace(/\s+/g, ' ').trim();
        lines.push(`${path.join('.')}: e.g. ${example.length > 40 ? `${example.slice(0, 40)}…` : example}`);
    };
    visit(entity, []);
    return lines.join('\n');
}

/**
 * Paths whose key or value contains `query` (any case), in document order, at most `max`: the tree
 * opens these and their parents.
 */
export function searchTree(data: unknown, query: string, max = 200): Path[] {
    const q = query.trim().toLowerCase();
    const out: Path[] = [];
    if (!q) return out;
    const visit = (node: unknown, path: Path, depth: number) => {
        if (out.length >= max || depth > 40) return;
        const key = path.length ? String(path[path.length - 1]).toLowerCase() : '';
        if (node && typeof node === 'object') {
            if (key.includes(q)) out.push(path);
            for (const [k, v] of Array.isArray(node) ? node.entries() : Object.entries(node)) visit(v, [...path, k], depth + 1);
            return;
        }
        if (key.includes(q) || String(node).toLowerCase().includes(q)) out.push(path);
    };
    visit(data, [], 0);
    return out;
}
