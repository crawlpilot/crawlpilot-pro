/**
 * The page's JavaScript-backed data for Pro's editor (`pages/PageDataSource.tsx`): every value in its JSON sources
 * (JSON-LD, `__NEXT_DATA__`, inline state: `content/services/page/dataBinding.ts`), with its path, so a field can be
 * read from it. Values found by key or value text; lists of plain values offered whole. Runs in the page, in Pro's
 * step script (`contentSteps.ts`).
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
