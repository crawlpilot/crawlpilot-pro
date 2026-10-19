/**
 * AI Extract end to end on corpus pages, with a fake on-device model that answers like a perfect one:
 * it copies each known value (from the corpus targets) from the page text it is shown, with the ref
 * of the block it is in, and invents one value that isn't on the page. Everything else is real: the
 * model host (budget, clones, constraints), the page view with refs, chunking, structured data,
 * merging, grounding and the tables saved.
 *
 * What must hold: every known value comes back found on the page (or from the page's structured
 * data), the invented one comes back `unverified`, and list items are found across chunks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPage } from './measure';
import { CORPUS } from './targets';
import PDP from './pdp-targets.json';
import type { PdpTarget } from './targets';
import { buildPageView, ground } from '../../content/services/ai-view/pageView';
import { runPageExtract, type PageAccess } from '../../sidepanel/services/ai/extractRun';
import { outcomeTables, SOURCES_KEY } from '../../sidepanel/services/ai/extractTables';
import { modelHost } from '../../sidepanel/services/ai/modelHost';
import type { SchemaField, SchemaList } from '../../shared/ai/schemaIntake';

const flat = (s: string) => s.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
const INVENTED = 'Made up value 4242';

/** What the fake model knows: single values by field, and list items. */
let truth: { single: Record<string, string>; items: Record<string, string>[] } = { single: {}, items: [] };
let calls = 0;

/** The ref of the line of `page` holding `value` (the line's last `[bN]`, or the next one after it). */
function refFor(page: string, value: string): string | null {
    const lines = page.split('\n');
    const i = lines.findIndex(l => flat(l).includes(flat(value)));
    if (i < 0) return null;
    for (let j = i; j < lines.length; j++) {
        const refs = lines[j].match(/\[b(\d+)\]/g);
        if (refs) return refs[refs.length - 1].slice(1, -1);
    }
    return '';
}

class FakeLM extends EventTarget {
    static async availability() { return 'available'; }
    static async create(opts: any) { const s = new FakeLM(); s.contextUsage = Math.ceil((opts.initialPrompts?.[0]?.content ?? '').length / 3.7); return s; }
    contextWindow = 6144;
    contextUsage = 0;
    async clone() { const c = new FakeLM(); c.contextUsage = this.contextUsage; return c; }
    async measureContextUsage(text: string, opts?: any) {
        return Math.ceil((text.length + (opts?.responseConstraint ? JSON.stringify(opts.responseConstraint).length : 0)) / 3.7);
    }
    async prompt(text: string, opts: any) {
        calls++;
        const page = text.slice(text.indexOf('<page>') + 6, text.indexOf('</page>'));
        const props = opts.responseConstraint.properties;
        if (props.items) {
            const fields = Object.keys(props.items.items.properties).filter(k => k !== 'ref');
            const items = truth.items
                .map(item => ({ item, ref: refFor(page, item[fields[0]]) }))
                .filter(x => x.ref !== null)
                .slice(0, props.items.maxItems ?? 20)
                .map(({ item, ref }) => ({ ref, ...Object.fromEntries(fields.map(f => [f, item[f] && refFor(page, item[f]) !== null ? item[f] : ''])) }));
            return JSON.stringify({ items });
        }
        const out: Record<string, { value: string; ref: string }> = {};
        for (const f of Object.keys(props)) {
            if (f === 'invented') { out[f] = { value: INVENTED, ref: 'b1' }; continue; }
            const v = truth.single[f];
            const ref = v ? refFor(page, v) : null;
            out[f] = ref === null ? { value: '', ref: '' } : { value: v, ref };
        }
        return JSON.stringify(out);
    }
    destroy() { /* nothing held */ }
}

const page: PageAccess = {
    view: async (chunkChars, maxChunks) => buildPageView(chunkChars, maxChunks, { live: false }),
    ground: async requests => ground(requests),
};

beforeEach(() => {
    (globalThis as any).LanguageModel = FakeLM;
    calls = 0;
    modelHost.reset();
});
afterEach(() => { delete (globalThis as any).LanguageModel; });

const FOUND = ['structured', 'verified', 'relocated'];

describe('AI Extract on corpus pages (fake model)', () => {
    for (const [name, targets] of Object.entries(PDP as Record<string, PdpTarget[]>)) {
        it(`product page ${name}: known values found on the page, the invented one unverified`, async () => {
            loadPage(`corpus/pdp-${name}.html.gz`);
            const values: Record<string, string> = {};
            for (const t of targets.filter(t => t.kind === 'value')) {
                const el = document.evaluate(t.at, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
                const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
                // One block's value (a list of features spans many lines: not something to copy as one value).
                if (text && text.length <= 120 && !el!.querySelector('li, p, br, tr')) values[t.name] = text;
            }
            truth = { single: values, items: [] };
            const fields: SchemaField[] = [...Object.keys(values).map(n => ({ name: n, type: 'string' as const })), { name: 'invented', type: 'string' }];
            const outcome = await runPageExtract({ fields, lists: [] }, { page, compileSingle: true });

            expect(outcome.single.invented.status).toBe('unverified');
            for (const n of Object.keys(values)) {
                const v = outcome.single[n];
                expect(FOUND, `${name}.${n} = ${JSON.stringify(v)}`).toContain(v.status);
                if (v.status !== 'structured') expect(flat(v.text)).toBe(flat(values[n]));
                // Found on the page, so the Page Extractor gets a selector for it.
                if (v.status !== 'structured') expect(v.selectors?.length).toBeGreaterThan(0);
            }
            expect(calls).toBeGreaterThan(0);
        }, 60_000);
    }

    for (const name of ['amazon-search', 'walmart-search'] as const) {
        it(`listing ${name}: items found across chunks, none unverified, saved with sources`, async () => {
            const t = CORPUS[name];
            loadPage(t.file);
            const titleField = t.list.fields.find(f => f.name === 'title')!;
            const priceField = t.list.fields.find(f => f.name === 'price')!;
            const container = document.querySelector(t.list.container)!;
            truth = {
                single: {},
                items: Array.from(container.querySelectorAll(t.list.items)).map(item => ({
                    title: (item.querySelector(titleField.at)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                    price: (item.querySelector(priceField.at)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                })).filter(i => i.title),
            };
            const list: SchemaList = { name: 'products', fields: [{ name: 'title', type: 'string' }, { name: 'price', type: 'string' }] };
            const outcome = await runPageExtract({ fields: [], lists: [list] }, { page });
            const items = outcome.lists.products;

            const titles = new Set(items.map(i => flat(i.title.text)));
            const found = truth.items.filter(i => titles.has(flat(i.title))).length;
            expect(found / truth.items.length, `${found} of ${truth.items.length}`).toBeGreaterThanOrEqual(0.9);
            const statuses = items.flatMap(i => [i.title.status, i.price.status]);
            expect(statuses).not.toContain('unverified');
            expect(items.every(i => FOUND.includes(i.title.status))).toBe(true);

            const [table] = outcomeTables(outcome, { fields: [], lists: [list] });
            expect(table.result.items).toHaveLength(items.length);
            expect(table.result.columns.map(c => c.id)).toEqual(['title', 'price']);
            expect((table.result.items[0] as any)[SOURCES_KEY].title.status).toMatch(/verified|relocated|structured/);
        }, 60_000);
    }

    it('without the model: structured data still answers, the rest is marked as needing it', async () => {
        delete (globalThis as any).LanguageModel;
        loadPage('corpus/pdp-walmart.html.gz');
        const outcome = await runPageExtract({ fields: [{ name: 'title', type: 'string' }, { name: 'warranty_terms', type: 'string' }], lists: [] }, { page });
        expect(outcome.modelUsed).toBe(false);
        expect(outcome.warnings.join(' ')).toMatch(/on-device model/);
        expect(outcome.single.warranty_terms.status).toBe('needs_model');
    });
});
