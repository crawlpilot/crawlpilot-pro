/**
 * A3 (docs/plans/ai-extract-v2-plan.md §3.3): what each call reads (full → fit → BM25 blocks → first
 * part), heading trails and overlap in chunks, and the evidence kept for every value: its block as
 * markdown, the hidden section it was read from, and the markdown evidence report.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../../../shared/markdown/chunks';
import { relevantBlocks } from '../../../shared/ai/merge';
import { evidenceOf, runPageExtract, type PageAccess } from './extractRun';
import { evidenceReport } from './evidenceReport';
import { outcomeDocument } from './extractTables';
import { modelHost } from './modelHost';
import { buildPageView, ground } from '../../../content/services/ai-view/pageView';
import { revealForReading } from '../../../content/services/reveal';
import { parseSchemaInput } from '../../../shared/ai/schemaIntake';
import type { PageView } from '../../../shared/ai/page';

describe('chunks for a small model', () => {
    const md = ['# Acme X-200 [b1]', 'Intro text here. [b2]', '## Specifications [b3]', 'Weight is 1.2 kg. [b4]', 'Width is 30 cm. [b5]', 'Height is 20 cm. [b6]'].join('\n\n');

    it('a chunk that starts mid-section starts with its heading trail, refs dropped', () => {
        const chunks = chunkMarkdown(md, 60, { trail: true });
        const later = chunks.find(c => c.includes('Height is'))!;
        expect(later.startsWith('(Section: Acme X-200 › Specifications)')).toBe(true);
        expect(chunks.every(c => c.length <= 60 + 40)).toBe(true);
        // Off by default: the page view's chunks are unchanged.
        expect(chunkMarkdown(md, 60).some(c => c.startsWith('(Section'))).toBe(false);
    });

    it('list chunks overlap by one block, so an item cut at the edge is seen whole once', () => {
        const items = Array.from({ length: 6 }, (_, i) => `- Item ${i} costs $${i}0 [b${i + 1}]`).join('\n\n');
        const chunks = chunkMarkdown(items, 70, { overlap: 1 });
        for (let i = 1; i < chunks.length; i++) {
            const prev = chunks[i - 1].split('\n\n');
            expect(chunks[i].split('\n\n')[0]).toBe(prev[prev.length - 1]);
        }
    });

    it('BM25 says when nothing matched, so the caller can fall back', () => {
        expect(relevantBlocks([md], 'weight', 80)).toMatchObject({ matched: true });
        expect(relevantBlocks([md], 'warranty', 80).matched).toBe(false);
    });
});

describe('evidence', () => {
    it('a table row keeps its header; refs are dropped; long text is cut around the value', () => {
        const md = '| Spec | Value |\n| --- | --- |\n| Width | 180 cm | [b4]\n| Weight | 30 kg | [b5]';
        expect(evidenceOf(md, 'b5', '30 kg')).toBe('| Spec | Value |\n| --- | --- |\n| Weight | 30 kg |');
        const long = `${'Lorem ipsum dolor. '.repeat(40)}The warranty is ten years. ${'More text here. '.repeat(40)} [b9]`;
        const cut = evidenceOf(long, 'b9', 'ten years');
        expect(cut).toContain('The warranty is ten years.');
        expect(cut.length).toBeLessThanOrEqual(302);
        expect(cut.startsWith('…') && cut.endsWith('…')).toBe(true);
        expect(evidenceOf(long, 'b99', 'x')).toBe('');
    });
});

// ── Runs with a fake model that answers from the known values it can see ──

let prompts: string[] = [];
let known: Record<string, string> = {};
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
        const page = text.slice(text.indexOf('<page>') + 6, text.indexOf('</page>'));
        prompts.push(page);
        return JSON.stringify(Object.fromEntries(Object.keys(opts.responseConstraint.properties).map(k => {
            const v = known[k];
            const line = v ? page.split('\n').find(l => l.includes(v)) : undefined;
            const ref = line?.match(/\[(b\d+)\]/)?.[1];
            return [k, ref ? { value: v, ref } : { value: '', ref: '' }];
        })));
    }
    destroy() { /* nothing held */ }
}

beforeEach(() => { (globalThis as any).LanguageModel = FakeLM; prompts = []; modelHost.reset(); });
afterEach(() => { delete (globalThis as any).LanguageModel; document.body.innerHTML = ''; });

/** A page view built by hand: the full markdown, and optionally a pruned one. */
function stubPage(full: string, fit?: string): PageAccess {
    const view: PageView = { url: 'https://shop.test/p', title: 'P', chunks: [full], truncated: false, structured: { entities: [], meta: {} }, ...(fit ? { fit } : {}) };
    return {
        view: async () => view,
        ground: async reqs => reqs.map(r => {
            const line = full.split('\n').find(l => l.includes(r.value));
            const ref = line?.match(/\[(b\d+)\]/)?.[1];
            return { key: r.key, status: ref ? 'verified' : 'not_on_page', type: 'text', selectors: [], matchCount: 0, ...(ref ? { ref } : {}) };
        }),
    };
}

const filler = (n: number, from = 100) => Array.from({ length: n }, (_, i) => `Menu link number ${i} goes somewhere else on the site. [b${from + i}]`).join('\n\n');

describe('what each call reads', () => {
    it('full when it fits, else fit, else the blocks about its fields, else the first part with a warning', async () => {
        known = { weight: '1.2 kg' };
        const body = 'Weight: 1.2 kg [b1]';
        const fields = [{ name: 'weight', type: 'string' as const }];

        let outcome = await runPageExtract({ fields, lists: [] }, { page: stubPage(body) });
        expect(outcome.reads).toEqual([{ for: ['weight'], input: 'full' }]);

        const long = `${filler(400)}\n\n${body}`;
        outcome = await runPageExtract({ fields, lists: [] }, { page: stubPage(long, body) });
        expect(outcome.reads?.[0].input).toBe('fit');
        expect(outcome.single.weight.status).toBe('verified');

        outcome = await runPageExtract({ fields, lists: [] }, { page: stubPage(long) });
        expect(outcome.reads?.[0].input).toBe('relevant');
        expect(prompts.at(-1)).toContain('Weight: 1.2 kg');
        expect(outcome.single.weight.status).toBe('verified');

        known = { colour: 'Red' };
        outcome = await runPageExtract({ fields: [{ name: 'colour', type: 'string' }], lists: [] }, { page: stubPage(long) });
        expect(outcome.reads?.[0].input).toBe('truncated');
        expect(outcome.warnings.join(' ')).toMatch(/only its first part was read/);
    });
});

describe('evidence from hidden sections, and the report', () => {
    it('a value read from a closed accordion carries its block and the section name', async () => {
        document.body.innerHTML = `<main><h1>Oak Dining Table</h1><p>Price: $899</p>
            <button type="button" aria-expanded="false" aria-controls="materials">Materials</button>
            <div id="materials" hidden><p>Solid European oak with a natural oil finish.</p></div>
            <table><tr><th>Width</th><td>180 cm</td></tr><tr><th>Height</th><td>75 cm</td></tr></table></main>`;
        const revealed = await revealForReading('read', undefined, document, false);
        const page: PageAccess = {
            view: async (c, m) => ({ ...buildPageView(c, m, { live: false, markdown: revealed.markdownOptions }), revealed: revealed.report }),
            ground: async r => ground(r),
        };
        known = { price: '$899', material: 'Solid European oak', width: '180 cm', brand: 'Acme' };
        const intake = parseSchemaInput('price: price\nmaterial: what it is made of\nwidth: width\nbrand: brand');
        const outcome = await runPageExtract(intake, { page });

        expect(outcome.single.material).toMatchObject({ status: 'verified', section: 'Materials', evidence: 'Solid European oak with a natural oil finish.' });
        expect(outcome.single.price.evidence).toBe('Price: $899');
        expect(outcome.single.width.evidence).toContain('180 cm');
        expect(outcome.single.price.section).toBeUndefined();

        // Kept with the JSON's sources, by pointer.
        expect(outcomeDocument(outcome, intake).sources['/material']).toMatchObject({ section: 'Materials', evidence: expect.stringContaining('oak') });

        const report = evidenceReport(outcome, intake, new Date('2026-10-19T10:00:00Z'));
        expect(report).toContain('# Evidence: ');
        expect(report).toContain('## `/material` material');
        expect(report).toContain('> Solid European oak with a natural oil finish.');
        expect(report).toContain('From the hidden section *Materials* (closed on the page, read without opening it).');
        expect(report).toMatch(/## Not found\n\n- `\/brand` brand: not found on the page/);
        expect(report).toContain('Hidden sections read: Materials');
    });
});
