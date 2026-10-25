/**
 * What the page publishes as data (docs/plans/automation-and-page-tools-plan.md §3.8), each source
 * parsed for the "Data on this page" tree:
 *
 * - **JSON-LD** blocks, one source each; one that isn't valid JSON is listed with the parse error.
 * - **Microdata** and **RDFa-lite**: each top-level item, nested items as objects.
 * - **Meta tags**: Open Graph, Twitter, `product:` / `article:`, and named meta, grouped by prefix.
 * - **App state**: `__NEXT_DATA__`, `__NUXT_DATA__`, JSON scripts, and state assigned to `window`
 *   (`__INITIAL_STATE__`, `__APOLLO_STATE__`…) when it is plain JSON. Past `MAX_STATE_CHARS` the source
 *   is listed with its size only.
 */
import { microdataItem } from '../../../shared/ai/structured';
import type { PageDataSource } from '../../../shared/structured/pageData';

const MAX_STATE_CHARS = 2_000_000;
const STATE = /(window\.)?(__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__|__remixContext|__INITIAL_DATA__|__STATE__|__DATA__)\s*=\s*/;

function parse(text: string): { data?: unknown; error?: string } {
    try { return { data: JSON.parse(text) }; } catch (e) { return { error: (e as Error).message }; }
}

const typesOf = (data: unknown): string[] => {
    const out = new Set<string>();
    const visit = (n: unknown, depth: number) => {
        if (depth > 3 || !n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(x => visit(x, depth + 1)); return; }
        const t = (n as any)['@type'];
        for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') out.add(x);
        if (Array.isArray((n as any)['@graph'])) visit((n as any)['@graph'], depth + 1);
    };
    visit(data, 0);
    return [...out];
};

/** RDFa-lite: an element with `typeof` as an object of its `property` values (nested `typeof` as objects). */
function rdfaItem(scope: Element): Record<string, any> {
    const out: Record<string, any> = { '@type': (scope.getAttribute('typeof') ?? '').split(/\s+/)[0] };
    scope.querySelectorAll('[property]').forEach(el => {
        if (el.parentElement?.closest('[typeof]') !== scope) return;
        const name = el.getAttribute('property')!.split(':').pop()!;
        const value = el.hasAttribute('typeof') ? rdfaItem(el)
            : el.getAttribute('content') ?? el.getAttribute('href') ?? el.getAttribute('src') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!(name in out)) out[name] = value;
    });
    return out;
}

export function collectPageData(doc: Document = document): PageDataSource[] {
    const out: PageDataSource[] = [];

    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        const text = (s.textContent ?? '').trim();
        const { data, error } = parse(text);
        const types = typesOf(data);
        out.push({ kind: 'json-ld', label: `JSON-LD${types.length ? ` · ${types.slice(0, 3).join(', ')}` : ''}`, size: text.length, ...(error ? { error } : { data }), types });
    });

    const micro = Array.from(doc.querySelectorAll('[itemscope]')).filter(el => !el.parentElement?.closest('[itemscope]')).map(microdataItem).filter(o => Object.keys(o).length > 0);
    if (micro.length) out.push({ kind: 'microdata', label: 'Microdata', size: micro.length, data: micro.length === 1 ? micro[0] : micro, types: typesOf(micro) });

    const rdfa = Array.from(doc.querySelectorAll('[typeof]')).filter(el => !el.parentElement?.closest('[typeof]')).map(rdfaItem);
    if (rdfa.length) out.push({ kind: 'rdfa', label: 'RDFa', size: rdfa.length, data: rdfa.length === 1 ? rdfa[0] : rdfa, types: typesOf(rdfa) });

    const meta: Record<string, Record<string, string>> = {};
    doc.querySelectorAll('meta[property], meta[name]').forEach(m => {
        const key = m.getAttribute('property') || m.getAttribute('name') || '';
        const content = m.getAttribute('content');
        if (!key || content == null || /^(viewport|theme-color|color-scheme|format-detection|referrer)$/i.test(key)) return;
        const group = /^og:/i.test(key) ? 'Open Graph' : /^twitter:/i.test(key) ? 'Twitter' : /^(product|article|book|profile|music|video):/i.test(key) ? key.split(':')[0] : 'Named';
        (meta[group] ??= {})[key] = content;
    });
    const metaCount = Object.values(meta).reduce((n, g) => n + Object.keys(g).length, 0);
    if (metaCount) out.push({ kind: 'meta', label: 'Meta tags', size: metaCount, data: meta });

    doc.querySelectorAll('script[type="application/json"], script[type="application/vnd.json"]').forEach(s => {
        const text = (s.textContent ?? '').trim();
        if (text.length < 200) return; // config flags, not data
        const label = s.id || s.getAttribute('data-target') || 'JSON script';
        if (text.length > MAX_STATE_CHARS) { out.push({ kind: 'app-state', label, size: text.length, tooLarge: true }); return; }
        const { data, error } = parse(text);
        out.push({ kind: 'app-state', label, size: text.length, ...(error ? { error } : { data }) });
    });

    doc.querySelectorAll('script:not([src]):not([type]), script[type="text/javascript"]:not([src])').forEach(s => {
        const text = s.textContent ?? '';
        const m = STATE.exec(text);
        if (!m) return;
        const body = text.slice(m.index + m[0].length).trim();
        if (!body.startsWith('{') && !body.startsWith('[')) return;
        if (body.length > MAX_STATE_CHARS) { out.push({ kind: 'app-state', label: m[2], size: body.length, tooLarge: true }); return; }
        // The assignment's JSON ends where the statement does; try the whole rest, then up to the first `;\n`.
        let parsed = parse(body.replace(/;\s*$/, ''));
        if (parsed.error) { const end = body.search(/;\s*(\n|$)/); if (end > 0) parsed = parse(body.slice(0, end)); }
        if (!parsed.error) out.push({ kind: 'app-state', label: m[2], size: body.length, data: parsed.data });
    });
    return out;
}
