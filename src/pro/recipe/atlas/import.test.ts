import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProOps } from '../ops';
import type { Field, PageRecipeSpec } from '../types';
import { bySeq, cssOf, isAtlasExport, readAtlasExport } from './import';
import { javaRegex } from './regex';

const fixture = (name: string) => readFileSync(`src/pro/recipe/atlas/fixtures/${name}.json`, 'utf8');
const specOf = (raw: string) => readAtlasExport(raw).versions[0].spec as PageRecipeSpec;
const fieldsOf = (spec: PageRecipeSpec) => spec.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
const field = (spec: PageRecipeSpec, name: string) => fieldsOf(spec).find(f => f.name === name) as Field;

const exportOf = (attributes: unknown[], more: Record<string, unknown> = {}) =>
    JSON.stringify({ responseObj: { competitorShortName: 'SHOP', attributes, errorPages: [], elements: [], ...more } });
const template = (t: Record<string, unknown>) => ({ extractMethodType: 'CSS_SLCTR', specialFormatting: '.*', asserts: [], assrtXprn: null, ...t });

describe('javaRegex', () => {
    it('moves inline flags out, wherever they are', () => {
        expect(javaRegex('(?i)(?<=(Sold By.))([^\\.]*)', 'is')).toEqual({ pattern: '(?<=(Sold By.))([^\\.]*)', flags: 'is' });
        expect(javaRegex('a(?i)b', '')).toEqual({ pattern: 'ab', flags: 'i' });
    });
    it('reads \\p{…} and drops escapes JavaScript refuses with it', () => {
        const re = javaRegex('\\d+[\\p{Z}\\s]used\\,', '');
        expect(re).toMatchObject({ flags: 'u' });
        if ('error' in re) throw new Error(re.error);
        expect(new RegExp(re.pattern, re.flags).test('2\u00a0used,')).toBe(true);
    });
    it('turns anchors and atomic groups into their nearest equivalent', () => {
        expect(javaRegex('\\Aab\\z', '')).toEqual({ pattern: '^ab$', flags: '' });
        expect(javaRegex('(?>ab)', '')).toEqual({ pattern: '(?:ab)', flags: '' });
    });
    it('says when a pattern does not compile', () => {
        expect(javaRegex('a(b', '')).toHaveProperty('error');
    });
});

describe('cssOf', () => {
    it('quotes attribute values and compares them without case, as Jsoup does', () => {
        expect(cssOf('[id=fresh-merchant-info]')).toBe('[id="fresh-merchant-info" i]');
        expect(cssOf('span[id^="priceblock_"] b')).toBe('span[id^="priceblock_" i] b');
        expect(cssOf('a[href]')).toBe('a[href]');
    });
    it("keeps an apostrophe inside single quotes as part of the value", () => {
        expect(cssOf("img[alt='Sorry! We couldn't find that page. Try searching or go to Amazon's home page.']"))
            .toBe('img[alt="Sorry! We couldn\'t find that page. Try searching or go to Amazon\'s home page." i]');
    });
});

describe('readAtlasExport', () => {
    it('reads the fragment Atlas copies, with or without its last brace', () => {
        const raw = exportOf([{ name: 'TITLE', type: 'A', templates: [template({ extractMethod: 'h1' })] }]);
        const fragment = raw.slice(1, -1);
        expect(isAtlasExport(fragment)).toBe(true);
        expect(isAtlasExport(fragment.slice(0, -1))).toBe(true);
        expect(fieldsOf(specOf(fragment.slice(0, -1)))).toHaveLength(1);
        expect(isAtlasExport('{"format":3}')).toBe(false);
    });

    it('turns attribute types into picks and field types', () => {
        const spec = specOf(exportOf([
            { name: 'A', type: 'A', templates: [template({ extractMethod: 'h1' })] },
            { name: 'AFL', type: 'AFL', templates: [template({ extractMethod: 'b', specialFormatting: '\\d+' })] },
            { name: 'AL', type: 'AL', templates: [template({ extractMethod: 'nav a' })] },
            { name: 'ALO', type: 'ALO', templates: [template({ extractMethod: 'li' })] },
            { name: 'COUNT', type: 'A', templates: [template({ extractMethod: 'img', extractMethodType: 'CSS_SLCTR_CNT' })] },
            { name: 'LINK', type: 'A', templates: [template({ extractMethod: 'a', extractMethodType: 'CSS_SLCTR_ATTR', keyElement: 'href' })] },
        ]));
        const [a, afl, al, alo, count, link] = fieldsOf(spec);
        expect(a).toMatchObject({ id: 'a', type: 'text', ways: [{ kind: 'selector', selector: 'h1', read: 'text' }] });
        expect(a.ways[0]).not.toHaveProperty('pick');
        expect(afl.ways[0]).toMatchObject({ pick: 'firstFilled', ops: [{ op: 'regex', pattern: '\\d+', flags: 'is', group: 0 }, { op: 'trim' }] });
        expect(al.ways[0]).toMatchObject({ pick: 'all', ops: [{ op: 'join', sep: ' > ' }] });
        expect(alo).toMatchObject({ type: 'list', read: 'text_array', ways: [{ pick: 'all' }] });
        expect(count.ways[0]).toMatchObject({ read: 'count' });
        expect(link.ways[0]).toMatchObject({ read: 'attr', attr: 'href' });
    });

    it('turns asserts into conditions, AND before OR', () => {
        const asserts = [
            { assrtId: 1, type: 'CSS_SLCTR_CNT', assrt: '#a', assrtFnct: 'GREATER_THAN', assrtValue: '0' },
            { assrtId: 2, type: 'REGEX_CNT', assrt: 'Sold out', assrtFnct: 'EQUAL_TO', assrtValue: '0' },
            { assrtId: 3, type: 'CSS_SLCTR_CNT', assrt: '#c', assrtFnct: 'LESS_THAN', assrtValue: '2' },
        ];
        const way = (assrtXprn: string | null, list = asserts) =>
            fieldsOf(specOf(exportOf([{ name: 'X', type: 'A', templates: [template({ extractMethod: 'b', assrtXprn, asserts: list })] }])))[0].ways[0];
        const a1 = { kind: 'css', selector: '#a', op: 'gt', value: 0 };
        const a2 = { kind: 'regex', pattern: 'Sold out', op: 'eq', value: 0 };
        const a3 = { kind: 'css', selector: '#c', op: 'lt', value: 2 };
        expect(way('ASSERT1 OR ASSERT2 AND ASSERT3').when).toEqual({ kind: 'any', of: [a1, { kind: 'all', of: [a2, a3] }] });
        expect(way('(ASSERT1 OR ASSERT2) AND ASSERT3').when).toEqual({ kind: 'all', of: [{ kind: 'any', of: [a1, a2] }, a3] });
        expect(way(null).when).toEqual(a1);
        expect(way('ASSERT9').when).toEqual({ kind: 'any', of: [] });
        expect(way('ASSERT1', [{ ...asserts[0], assrtValue: 'abc' }]).when).toEqual({ kind: 'any', of: [] });
    });

    it('tries templates by seq, ties and missing seqs in the export\'s order', () => {
        expect(bySeq([{ seq: 4 }, { seq: 1 }, { seq: 2 }, { seq: 4 }, {}, { seq: null }, { seq: 3 }]).map(x => x.i)).toEqual([1, 2, 6, 0, 3, 4, 5]);
        const ways = fieldsOf(specOf(exportOf([{ name: 'X', type: 'A', templates: [
            template({ extractMethod: '.b', seq: 2, uniqueTemplateId: 'X-0' }), template({ extractMethod: '.a', seq: 1, uniqueTemplateId: 'X-1' }),
        ] }])))[0].ways;
        expect(ways.map(w => [w.id, w.kind === 'selector' && w.selector])).toEqual([['X-1', '.a'], ['X-0', '.b']]);
    });

    it('reads NOT and ! before AND, NOR as NOT (… OR …), and the "or equal" and "not" counts', () => {
        const asserts = [
            { assrtId: 1, type: 'CSS_SLCTR_CNT', assrt: '#a', assrtFnct: 'GREATER_THAN', assrtValue: '0' },
            { assrtId: 2, type: 'CSS_SLCTR_CNT', assrt: '#b', assrtFnct: 'greater than or equal to', assrtValue: '2' },
            { assrtId: 3, type: 'CSS_SLCTR_CNT', assrt: '#c', assrtFnct: 'NOT_EQUAL_TO', assrtValue: '1' },
        ];
        const way = (assrtXprn: string) =>
            fieldsOf(specOf(exportOf([{ name: 'X', type: 'A', templates: [template({ extractMethod: 'b', assrtXprn, asserts })] }])))[0].ways[0];
        const a1 = { kind: 'css', selector: '#a', op: 'gt', value: 0 };
        const a2 = { kind: 'css', selector: '#b', op: 'gte', value: 2 };
        const a3 = { kind: 'css', selector: '#c', op: 'ne', value: 1 };
        expect(way('ASSERT1 AND NOT ASSERT2').when).toEqual({ kind: 'all', of: [a1, { kind: 'not', of: a2 }] });
        expect(way('!ASSERT1 || ASSERT3').when).toEqual({ kind: 'any', of: [{ kind: 'not', of: a1 }, a3] });
        expect(way('!(ASSERT1 && ASSERT2)').when).toEqual({ kind: 'not', of: { kind: 'all', of: [a1, a2] } });
        expect(way('ASSERT1 NOR ASSERT2 NOR ASSERT3').when).toEqual({ kind: 'not', of: { kind: 'any', of: [a1, a2, a3] } });
        // OR and NOR mixed without brackets: not guessed, and said so.
        const mixed = readAtlasExport(exportOf([{ name: 'X', type: 'A', templates: [template({ extractMethod: 'b', assrtXprn: 'ASSERT1 OR ASSERT2 NOR ASSERT3', asserts })] }]));
        expect((mixed.versions[0].spec as PageRecipeSpec).steps[0]).toMatchObject({ field: { ways: [{ when: { kind: 'any', of: [] } }] } });
        expect(mixed.notes?.join(' ')).toContain('is not understood; it never holds');
    });

    it('leaves out what it cannot carry over, and says so', () => {
        const r = readAtlasExport(exportOf([
            { name: 'PDP', type: 'HL', templates: [template({ extractMethod: 'a' })] },
            { name: 'J', type: 'A', templates: [template({ extractMethod: 'script', specialFormatting: 'json:$.a' })] },
            { name: 'BAD', type: 'A', templates: [template({ extractMethod: 'b', specialFormatting: 'a(b' })] },
        ]));
        expect(fieldsOf(r.versions[0].spec as PageRecipeSpec)).toHaveLength(0);
        expect(r.notes.join('\n')).toMatch(/HL is not supported[\s\S]*JSON path[\s\S]*does not compile/);
        expect(r.versions[0].note).toContain('- PDP: attribute type HL is not supported');
    });
});

describe('the AMZ export', () => {
    const r = readAtlasExport(fixture('amz'));
    const spec = r.versions[0].spec as PageRecipeSpec;

    it('is a page recipe for amazon.com with every attribute but the inner-page link', () => {
        expect(r).toMatchObject({ name: 'AMZ product (Atlas)', site: 'amazon.com', kind: 'page', targeting: { competitor: 'amz', pageType: 'product' } });
        expect(fieldsOf(spec)).toHaveLength(62);
        expect(field(spec, 'PDP')).toBeUndefined();
        expect(field(spec, 'IS_PRICE').ways).toHaveLength(24);
    });

    it('reads specifications as name/value rows and the category as link → name', () => {
        expect(field(spec, 'SPECIFICATIONS')).toMatchObject({
            type: 'object',
            ways: [{ selector: '#detailBullets_feature_div .a-list-item', read: 'pairs', pairs: { key: '.a-text-bold', value: 'span:nth-child(2)' } }, {}, {}, {}],
        });
        expect(field(spec, 'CATEGORY').ways[0]).toMatchObject({ read: 'pairs', attr: 'href', pairs: {} });
        expect(field(spec, 'BREADCRUMB').ways[0]).toMatchObject({ pick: 'all', ops: [{ op: 'join', sep: ' > ' }] });
    });

    it('carries Lua cleanups over as they are', () => {
        const ops = field(spec, 'IS_PRICE').ways[0].ops ?? [];
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ op: 'lua' });
        expect(applyProOps('Regular Price $ 1,234 99', ops)).toBe('$1234.99');
    });

    it('turns error pages and captchas into page rules', () => {
        expect(spec.rules?.map(x => `${x.name}:${x.status}`)).toEqual([
            '404:not_found', 'ANONYMITY_ERROR_PAGE:blocked', '503:error', '405:blocked', 'CAPTCHA_TEXT_BOX:blocked', 'CAPTCHA_IMAGE:blocked',
        ]);
        expect(spec.rules?.[4].when).toEqual({ kind: 'css', selector: '#captchacharacters', op: 'gt', value: 0 });
    });

    it('checks the SKU against the URL', () => {
        expect(spec.identity?.field).toBe('SKU');
        const [pattern] = spec.identity?.url ?? [];
        expect(new RegExp(pattern).exec('https://www.amazon.com/Some-Thing/dp/B0ABCDEF12?th=1')?.[0]).toBe('B0ABCDEF12');
    });

    it('notes only the inner-page link and the page actions', () => {
        expect(r.notes).toEqual([
            'PDP: attribute type HL is not supported; left out.',
            'Elements SEARCH_BOX, REGULAR_PRICE_SELECTOR, SEARCH_BUTTON, URL_SECONDARY_SKU, SKU_ELEMENT: page actions and search results are not part of a page recipe; left out.',
        ]);
    });
});

describe('the WMART export', () => {
    const r = readAtlasExport(fixture('wmart'));
    const spec = r.versions[0].spec as PageRecipeSpec;

    it('is a page recipe for walmart.com with every attribute', () => {
        expect(r).toMatchObject({ name: 'WMART product (Atlas)', site: 'walmart.com' });
        expect(fieldsOf(spec)).toHaveLength(48);
        expect(field(spec, 'OL_AVAILABILITY').ways).toHaveLength(37);
        expect(spec.rules?.map(x => `${x.name}:${x.status}`)).toEqual(['404:not_found', 'ANONYMITY_ERROR_PAGE:blocked', '503:error']);
    });

    it('has no identity check: its URL_SKU reads search results', () => {
        expect(spec.identity).toBeUndefined();
        expect(r.notes.join('\n')).toContain('URL_SKU');
    });

    it('every regex compiles and every Lua script runs', () => {
        for (const f of fieldsOf(spec)) for (const w of f.ways) {
            for (const o of w.ops ?? []) if (o.op === 'regex') expect(() => new RegExp(o.pattern, o.flags)).not.toThrow();
            if (w.ops?.some(o => o.op === 'lua')) expect(() => applyProOps('$12.34', w.ops ?? [])).not.toThrow();
        }
    });
});
