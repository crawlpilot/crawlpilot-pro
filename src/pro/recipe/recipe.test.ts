import { describe, expect, it } from 'vitest';
import uniqlo from '../../shared/samples/recipes/uniqlo-product.json';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { PageSpec } from '../../shared/types/database';
import { canonicalJson, outputDigest, outputFields, specDigest } from './canonical';
import { fromPageSpec, toPageSpec } from './fromPublic';
import { readRecipeFile, RecipeFileError, writeRecipeFile } from './file';
import type { PageRecipeSpec, ProRecipe, Version } from './types';

const SAMPLES = [['uniqlo', uniqlo], ['zara', zara]] as const;

describe('fromPublic', () => {
    it.each(SAMPLES)('%s: reads every element as a step and runs back unchanged', (_, file) => {
        const pub = file.spec as unknown as PageSpec;
        const { spec, settings } = fromPageSpec(pub);
        expect(spec.steps).toHaveLength(pub.elements.length);
        expect(settings).toEqual(pub.settings);
        expect(toPageSpec(spec, settings)).toEqual(pub);
    });

    it('puts page data before selectors and guesses the output type', () => {
        const { spec } = fromPageSpec(zara.spec as unknown as PageSpec);
        const field = (name: string) => spec.steps.flatMap(s => s.kind === 'field' && s.field.name === name ? [s.field] : [])[0];
        expect(field('title').ways[0].kind).toBe('data');
        expect(field('images').type).toBe('list');
        expect(field('product_url').type).toBe('url');
        expect(field('product_specifications').type).toBe('object');
        expect(field('origin').ways.every(w => w.kind === 'selector')).toBe(true);
        expect(spec.steps.filter(s => s.kind === 'click')).toHaveLength(1);
    });
});

describe('digests', () => {
    const { spec } = fromPageSpec(zara.spec as unknown as PageSpec);

    it('ignore key order, ids and selector whitespace', async () => {
        const shuffled = JSON.parse(JSON.stringify(spec), (_k, v) =>
            v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v) as PageRecipeSpec;
        for (const s of shuffled.steps) {
            if (s.kind === 'field') s.field.id = 'other';
            for (const w of s.kind === 'field' ? s.field.ways : s.click.ways) if (w.kind === 'selector') w.selector = `  ${w.selector}  `;
        }
        expect(canonicalJson(shuffled)).toBe(canonicalJson(spec));
        expect(await specDigest(shuffled)).toBe(await specDigest(spec));
    });

    it('change with a selector, and the output digest only with names, types and required', async () => {
        const edited = structuredClone(spec);
        const origin = edited.steps.find(s => s.kind === 'field' && s.field.name === 'origin')!;
        if (origin.kind === 'field') origin.field.ways.push({ kind: 'selector', selector: '.origin' });
        expect(await specDigest(edited)).not.toBe(await specDigest(spec));
        expect(await outputDigest(edited)).toBe(await outputDigest(spec));

        if (origin.kind === 'field') origin.field.name = 'country_of_origin';
        expect(await outputDigest(edited)).not.toBe(await outputDigest(spec));
        expect(outputFields(spec)).toContainEqual(['origin', 'text', false]);
    });
});

describe('recipe file', () => {
    it('reads format 1 as one version with its samples, pages and contract', () => {
        const file = readRecipeFile(JSON.stringify(uniqlo));
        expect(file).toMatchObject({ name: uniqlo.name, site: 'uniqlo.com', kind: 'page' });
        expect(file.samples).toEqual([uniqlo.built_on, ...uniqlo.checked_on]);
        expect(file.versions).toHaveLength(1);
        expect(file.versions[0].pages).toEqual({ kind: 'urls', urls: file.samples });
        expect(file.versions[0].output).toEqual({ contract: 'fashion-product.schema.json' });
        expect(file.versions[0].settings).toEqual(uniqlo.spec.settings);
    });

    it('writes format 2 and reads it back', async () => {
        const v1 = readRecipeFile(JSON.stringify(zara)).versions[0];
        const recipe: ProRecipe = { id: 'r1', name: zara.name, site: zara.site, kind: 'page', latestVersion: 1, labels: { latest: 1, live: 1 }, createdAt: 1, updatedAt: 1 };
        const version: Version = {
            recipeId: 'r1', version: 1, spec: v1.spec, settings: v1.settings, pages: v1.pages, output: v1.output,
            digest: await specDigest(v1.spec), outputDigest: await outputDigest(v1.spec), origin: 'imported', note: 'first', author: 'me', createdAt: 0,
        };
        const raw = writeRecipeFile(recipe, [version], [{ recipeId: 'r1', url: zara.built_on, canary: true, addedAt: 0 }]);
        const json = JSON.parse(raw);
        expect(json).toMatchObject({ format: 2, labels: { latest: 1, live: 1 }, samples: [{ url: zara.built_on, canary: true }] });
        expect(json.versions[0]).not.toHaveProperty('recipeId');

        const back = readRecipeFile(raw);
        expect(back).toMatchObject({ name: zara.name, site: zara.site, kind: 'page', samples: [zara.built_on] });
        expect(back.versions[0]).toMatchObject({ spec: v1.spec, settings: v1.settings, pages: v1.pages, note: 'first', digest: version.digest });
    });

    it('names the path of what is wrong', () => {
        expect(() => readRecipeFile('nope')).toThrow(RecipeFileError);
        expect(() => readRecipeFile(JSON.stringify({ ...zara, site: '' }))).toThrow('$.site: expected text');
        expect(() => readRecipeFile(JSON.stringify({ ...zara, spec: { kind: 'metadata' } }))).toThrow('$.spec.kind');
        expect(() => readRecipeFile(JSON.stringify({ format: 2, recipe: { name: 'a', site: 'b', kind: 'page' }, versions: [] }))).toThrow('$.versions');
        expect(() => readRecipeFile(JSON.stringify({ format: 3 }))).toThrow('unknown format 3');
    });
});
