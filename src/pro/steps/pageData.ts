/**
 * The page's JavaScript-backed data for Pro's editor (`pages/PageDataSource.tsx`): every value in its JSON sources
 * (JSON-LD, `__NEXT_DATA__`, inline state: `content/services/page/dataBinding.ts`), with its path, so a field can be
 * read from it. Values found by key or value text; lists of plain values offered whole; a list of objects offered
 * whole as rows (`offers`: sku, price…), and, when its items are name / value pairs (Walmart's
 * `idml.specifications`), as one object of name → value. Runs in the page, in Pro's step script (`contentSteps.ts`).
 */
import { sourcesOf } from '../../content/services/page/dataBinding';
import type { DataBinding, JsonStep } from '../../shared/types/database';

export interface PageDataEntry {
    binding: DataBinding;
    /** `__NEXT_DATA__ · props.pageProps…product.name` */
    where: string;
    /** The value, or a list's first items, shortened. */
    value: string;
}

const MAX_NODES = 40_000;
const MAX_DEPTH = 14;
const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NAME_KEYS = ['name', 'key', 'label', 'title', 'attribute', 'displayName', 'attributeName'];
const VALUE_KEYS = ['value', 'displayValue', 'val', 'attributeValue', 'text'];

/**
 * A list of objects: the keys most of its items have a plain value for (`@type` and such left out), and, when one is
 * a name and another its value, that pair.
 */
export function collectionOf(v: unknown): { keys: string[]; pair?: [string, string] } | null {
    if (!Array.isArray(v) || v.length < 2 || !v.every(isRecord)) return null;
    const counts = new Map<string, number>();
    for (const item of v) for (const [k, x] of Object.entries(item)) if (plain(x) && !k.startsWith('@')) counts.set(k, (counts.get(k) ?? 0) + 1);
    const keys = [...counts].filter(([, n]) => n >= Math.ceil(v.length / 2)).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);
    if (!keys.length) return null;
    const name = NAME_KEYS.find(k => keys.includes(k));
    const value = VALUE_KEYS.find(k => keys.includes(k) && k !== name);
    return { keys, ...(name && value ? { pair: [name, value] as [string, string] } : {}) };
}
const short = (s: string) => s.length > 120 ? `${s.slice(0, 120)}…` : s;

/** Values whose path or text has `query` (all when empty), at most `max`: fewer list positions first, then shorter paths. */
export function listPageData(query = '', max = 50): PageDataEntry[] {
    const q = query.trim().toLowerCase();
    const found: (PageDataEntry & { rank: number })[] = [];
    for (const src of sourcesOf()) {
        let seen = 0;
        const stack: { v: unknown; path: JsonStep[] }[] = [{ v: src.data, path: [] }];
        while (stack.length && seen++ < MAX_NODES) {
            const { v, path } = stack.pop()!;
            const list = Array.isArray(v) && v.length > 0 && v.every(plain);
            const rows = path.length ? collectionOf(v) : null;
            if (rows) {
                const items = v as Record<string, unknown>[];
                const dotted = path.map(String).join('.');
                const base = path.filter(s => typeof s === 'number').length * 100 + path.length - 0.5;
                const where = `${src.label} · ${dotted}`;
                const text = (x: unknown) => plain(x) ? String(x) : '';
                if (rows.pair) {
                    const [nk, vk] = rows.pair;
                    const value = items.slice(0, 3).map(i => `${text(i[nk])}: ${text(i[vk])}`).join('; ') + (items.length > 3 ? '; …' : '');
                    if (!q || dotted.toLowerCase().includes(q) || items.some(i => `${text(i[nk])} ${text(i[vk])}`.toLowerCase().includes(q))) {
                        found.push({ binding: { kind: src.kind, label: src.label, nth: src.nth, path, as: 'object', keys: [nk, vk] }, where, value: short(value), rank: base - 0.25 });
                    }
                }
                const value = `${items.length} rows: ${rows.keys.join(', ')}`;
                if (!q || dotted.toLowerCase().includes(q) || rows.keys.some(k => k.toLowerCase().includes(q))) {
                    found.push({ binding: { kind: src.kind, label: src.label, nth: src.nth, path, as: 'rows', keys: rows.keys, names: rows.keys }, where, value, rank: base });
                }
            }
            if (plain(v) || list) {
                const value = list ? (v as unknown[]).slice(0, 4).map(String).join(', ') + ((v as unknown[]).length > 4 ? ', …' : '') : String(v);
                const dotted = path.map(String).join('.');
                if (path.length && (!q || dotted.toLowerCase().includes(q) || value.toLowerCase().includes(q))) {
                    found.push({
                        binding: { kind: src.kind, label: src.label, nth: src.nth, path, as: list ? 'list' : 'text' },
                        where: `${src.label} · ${dotted}`, value: short(value),
                        rank: path.filter(s => typeof s === 'number').length * 100 + path.length,
                    });
                }
                if (!list) continue;
            }
            if (path.length >= MAX_DEPTH || v === null || typeof v !== 'object') continue;
            if (Array.isArray(v)) v.forEach((x, i) => stack.push({ v: x, path: [...path, i] }));
            else for (const [k, x] of Object.entries(v as Record<string, unknown>)) stack.push({ v: x, path: [...path, k] });
        }
    }
    return found.sort((a, b) => a.rank - b.rank).slice(0, max).map(({ rank: _, ...e }) => e);
}
