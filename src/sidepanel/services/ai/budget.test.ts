import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchemaField, SchemaList } from '../../../shared/ai/schemaIntake';
import {
    groupFields, identityFields, inputChars, itemCost, itemsPerChunk, listPasses, singleReserve,
    MAX_GROUP_FIELDS, MAX_GROUP_TOKENS, MAX_ITEMS, MIN_ITEMS,
} from './budget';
import { joinPasses, runPageExtract, type PageAccess } from './extractRun';
import { modelHost } from './modelHost';
import { buildPageView, ground } from '../../../content/services/ai-view/pageView';

const field = (name: string, type: SchemaField['type'] = 'string', extra: Partial<SchemaField> = {}): SchemaField => ({ name, type, ...extra });

describe('sizing calls', () => {
    it('answer costs follow the type: numbers short, URLs long, several values longer', () => {
        expect(singleReserve([field('a', 'number')])).toBeLessThan(singleReserve([field('a', 'url')]));
        expect(itemCost([field('a', 'string', { many: true })])).toBeGreaterThan(itemCost([field('a')]));
    });

    it('groups of at most 8 fields and ~300 answer tokens, siblings together', () => {
        const twenty = Array.from({ length: 20 }, (_, i) => field(`f${i}`, 'number'));
        expect(groupFields(twenty).map(g => g.length)).toEqual([8, 8, 4]);
        const urls = Array.from({ length: 8 }, (_, i) => field(`u${i}`, 'url'));
        for (const g of groupFields(urls)) expect(g.reduce(n => n + 12 + 40, 0)).toBeLessThanOrEqual(MAX_GROUP_TOKENS);
        const nested = [field('a'), ...['w', 'h', 'd'].map(k => field(`size__${k}`, 'number')), ...Array.from({ length: 5 }, (_, i) => field(`b${i}`, 'number'))];
        const groups = groupFields(nested, 6);
        // The three size fields don't straddle two calls.
        expect(groups.some(g => ['size__w', 'size__h', 'size__d'].every(n => g.some(f => f.name === n)))).toBe(true);
        expect(groups.every(g => g.length <= MAX_GROUP_FIELDS)).toBe(true);
    });

    it('items per chunk from the item width, 5 to 20', () => {
        expect(itemsPerChunk([field('t')])).toBe(MAX_ITEMS);
        expect(itemsPerChunk(Array.from({ length: 8 }, (_, i) => field(`u${i}`, 'url')))).toBe(MIN_ITEMS);
    });

    it('a wide item is read in passes, each with its identifying fields', () => {
        const list: SchemaList = { name: 'products', fields: ['title', 'url', ...Array.from({ length: 10 }, (_, i) => `x${i}`)].map(n => field(n)) };
        expect(identityFields(list.fields).map(f => f.name)).toEqual(['title', 'url']);
        const passes = listPasses(list);
        expect(passes).toHaveLength(2);
        for (const p of passes) {
            expect(p.fields.slice(0, 2).map(f => f.name)).toEqual(['title', 'url']);
            expect(p.fields.length).toBeLessThanOrEqual(MAX_GROUP_FIELDS);
        }
        expect(listPasses({ name: 'x', fields: list.fields.slice(0, 8) })).toHaveLength(1);
    });

    it('input room: what the reserve, the prompt and the constraint leave, never below a floor', () => {
        expect(inputChars({ tokens: 6000, charsPerToken: 4 }, 500, 400, 600)).toBe(Math.floor((6000 - 500 - 100 - 200) * 4 * 0.9));
        expect(inputChars({ tokens: 100, charsPerToken: 4 }, 500, 0, 0)).toBe(1500);
    });

    it('passes join on the identifying fields, else the ref', () => {
        const joined = joinPasses([
            [{ values: { title: 'Lamp', a: '1' }, ref: 'b1', chunk: 0 }, { values: { title: 'Desk', a: '2' }, ref: 'b5', chunk: 0 }],
            [{ values: { title: ' lamp ', b: 'x' }, ref: 'b2', chunk: 0 }, { values: { title: 'Chair', b: 'y' }, ref: 'b9', chunk: 0 }],
        ], ['title']);
        expect(joined.map(i => i.values)).toEqual([{ title: 'Lamp', a: '1', b: 'x' }, { title: 'Desk', a: '2' }, { title: 'Chair', b: 'y' }]);
    });
});

// ── Whole runs against a fake model that measures every prompt and records the room it had ──

let calls: { need: number; available: number; fields: string[] }[] = [];
const WINDOW = 3000;

class FakeLM extends EventTarget {
    static async availability() { return 'available'; }
    static async create(opts: any) { const s = new FakeLM(); s.contextUsage = Math.ceil((opts.initialPrompts?.[0]?.content ?? '').length / 4); return s; }
    contextWindow = WINDOW;
    contextUsage = 0;
    async clone() { const c = new FakeLM(); c.contextUsage = this.contextUsage; return c; }
    async measureContextUsage(text: string, opts?: any) {
        return Math.ceil((text.length + (opts?.responseConstraint ? JSON.stringify(opts.responseConstraint).length : 0)) / 4);
    }
    async prompt(text: string, opts: any) {
        const need = await this.measureContextUsage(text, opts);
        const props = opts.responseConstraint.properties;
        const page = text.slice(text.indexOf('<page>') + 6, text.indexOf('</page>'));
        const refOf = (value: string) => {
            const line = page.split('\n').find(l => l.includes(value));
            return line?.match(/\[(b\d+)\]/)?.[1] ?? null;
        };
        if (props.items) {
            const names = Object.keys(props.items.items.properties).filter(k => k !== 'ref');
            calls.push({ need, available: this.contextWindow - this.contextUsage, fields: names });
            const items = ITEMS.map(it => ({ it, ref: refOf(it.title) })).filter(x => x.ref)
                .slice(0, props.items.maxItems)
                .map(({ it, ref }) => ({ ref, ...Object.fromEntries(names.map(n => [n, refOf(it[n]) ? it[n] : ''])) }));
            return JSON.stringify({ items });
        }
        calls.push({ need, available: this.contextWindow - this.contextUsage, fields: Object.keys(props) });
        return JSON.stringify(Object.fromEntries(Object.keys(props).map(k => {
            const v = SINGLE[k];
            const ref = v ? refOf(v) : null;
            return [k, ref ? { value: v, ref } : { value: '', ref: '' }];
        })));
    }
    destroy() { /* nothing held */ }
}

const SINGLE: Record<string, string> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, `Value number ${i} of the spec`]));
const ITEMS: Record<string, string>[] = Array.from({ length: 6 }, (_, i) => ({
    title: `Product ${i} name`,
    ...Object.fromEntries(Array.from({ length: 11 }, (_, k) => [`x${k}`, `p${i} detail ${k}`])),
}));

const page: PageAccess = {
    view: async (chunkChars, maxChunks) => buildPageView(chunkChars, maxChunks, { live: false }),
    ground: async requests => ground(requests),
};

beforeEach(() => { (globalThis as any).LanguageModel = FakeLM; calls = []; modelHost.reset(); });
afterEach(() => { delete (globalThis as any).LanguageModel; document.body.innerHTML = ''; });

describe('runs sized to the window (fake model)', () => {
    it('a 20-field schema is read in 3 calls, every one within the room it had', async () => {
        document.body.innerHTML = `<main><h1>Spec sheet</h1>${Object.entries(SINGLE).map(([k, v]) => `<p>${k}: ${v}</p>`).join('')}</main>`;
        const fields = Object.keys(SINGLE).map(n => field(n));
        const outcome = await runPageExtract({ fields, lists: [] }, { page });
        expect(calls).toHaveLength(3);
        expect(calls.every(c => c.fields.length <= MAX_GROUP_FIELDS)).toBe(true);
        for (const c of calls) expect(c.need).toBeLessThanOrEqual(c.available);
        expect(Object.values(outcome.single).filter(v => v.status === 'verified')).toHaveLength(20);
    });

    it('a 12-field list item is read in 2 passes and joined into whole items', async () => {
        document.body.innerHTML = `<main><h1>Results</h1><ul>${ITEMS.map(it => `<li><h3>${it.title}</h3>${Object.entries(it).filter(([k]) => k !== 'title').map(([, v]) => `<p>${v}</p>`).join('')}</li>`).join('')}</ul></main>`;
        const list: SchemaList = { name: 'products', fields: ['title', ...Array.from({ length: 11 }, (_, k) => `x${k}`)].map(n => field(n)) };
        const outcome = await runPageExtract({ fields: [], lists: [list] }, { page });
        const passes = new Set(calls.map(c => c.fields.join()));
        expect(passes.size).toBe(2);
        for (const c of calls) { expect(c.fields[0]).toBe('title'); expect(c.need).toBeLessThanOrEqual(c.available); }
        expect(outcome.lists.products).toHaveLength(6);
        for (const item of outcome.lists.products) expect(Object.values(item).every(v => v.status === 'verified')).toBe(true);
    });
});
