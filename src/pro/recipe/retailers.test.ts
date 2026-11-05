/**
 * The Amazon and Walmart recipes (`retailers.ts`): valid, read back from their files unchanged, and reading the
 * saved product pages. `UPDATE_RECIPES=1 npx vitest run src/pro/recipe/retailers.test.ts` writes `recipes/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPage } from '../../content/services/page/extractPage';
import { pageRequest, readPageResult, type PageStepReply, type RuleHit } from '../runner/readPage';
import { seedOf } from '../backend/mockServer';
import { problems } from './editSpec';
import { readRecipeFile } from './file';
import { amazonProduct, fileOf, walmartProduct, type RetailerRecipe } from './retailers';
import type { PageRecipeSpec } from './types';

const fixture = (name: string) => readFileSync(`src/pro/recipe/atlas/fixtures/${name}.json`, 'utf8');

/** The saved page in the document, as the page's script would see it (its scripts not run). */
function load(capture: string) {
    const html = gunzipSync(readFileSync(`src/test/fixtures/corpus/${capture}.html.gz`)).toString('utf8');
    document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
}

async function read(r: RetailerRecipe, capture: string, url: string) {
    load(capture);
    const spec = r.version.spec as PageRecipeSpec;
    const req = pageRequest(spec, r.version.settings);
    const out = await extractPage(req.elements as never, { ...req.config, waitMs: 0 } as never) as unknown as { item?: Record<string, unknown>; steps?: PageStepReply[]; rule?: RuleHit };
    const page = readPageResult(spec, url, out.item ?? {}, out.steps, out.rule);
    return { page, field: (name: string) => page.fields.find(f => f.name === name)! };
}

const RECIPES = [
    ['amazon-product', () => amazonProduct(fixture('amz'))],
    ['walmart-product', () => walmartProduct(fixture('wmart'))],
] as const;

beforeAll(() => { Element.prototype.scrollIntoView = () => undefined; });

describe.each(RECIPES)('%s', (file, make) => {
    it('is valid, and its file reads back as it is', async () => {
        const r = await make();
        expect(problems(r.version.spec as PageRecipeSpec)).toEqual([]);
        const text = fileOf(r);
        const back = readRecipeFile(text);
        expect(back.versions[0]).toMatchObject({ spec: r.version.spec, digest: r.version.digest });
        expect(back.targeting).toEqual({ competitor: r.recipe.competitor, pageType: 'product', matchRules: r.recipe.matchRules });
        const path = `recipes/${file}.crawlpilot.json`;
        if (process.env.UPDATE_RECIPES) {
            mkdirSync('recipes', { recursive: true });
            writeFileSync(path, text);
        }
        // The committed file is what this builds: rebuild it with UPDATE_RECIPES=1 after a change.
        expect(existsSync(path) && readFileSync(path, 'utf8')).toBe(text);
    });

    it('seeds the local recipe store as it is (`MOCK_SEED=recipes/…`)', async () => {
        const r = await make();
        expect(seedOf(JSON.parse(fileOf(r)))).toEqual({
            name: r.recipe.name, site: r.recipe.site, competitor: r.recipe.competitor, pageType: 'product', matchRules: r.recipe.matchRules, spec: r.version.spec,
        });
    });
});

// A saved product page is up to 1.2 MB of markup: parsing it in jsdom takes seconds on a CI runner.
describe('on the saved product pages', { timeout: 60_000 }, () => {
    it('Amazon: the ASIN from the hidden input, title, brand, rating and reviews, every check passing', async () => {
        const { page, field } = await read(await amazonProduct(fixture('amz')), 'pdp-amazon', 'https://www.amazon.com/dp/B0HJCRV1J6');
        expect(page.rule).toBeUndefined();
        expect(page.mismatch).toBeUndefined();
        expect(field('SKU')).toMatchObject({ value: 'B0HJCRV1J6', ok: true });
        expect(field('PRODUCT_TITLE').value).toMatch(/^Lenovo 15\.6" FHD Essential Laptop/);
        expect(field('BRAND').value).toBe('Lenovo');
        expect(field('RATING')).toMatchObject({ value: '4.5', ok: true });
        expect(field('REVIEWS')).toMatchObject({ value: '1,308', ok: true });
        // Saved from outside the US, the page has no buy box: no price, and nothing fails for it.
        expect(field('IS_PRICE').filled).toBe(false);
        expect(page.fields.filter(f => !f.ok).map(f => `${f.name}: ${f.problem}`)).toEqual([]);
    });

    it('Amazon: another ASIN in the URL is another product', async () => {
        const { page } = await read(await amazonProduct(fixture('amz')), 'pdp-amazon', 'https://www.amazon.com/dp/B000000000');
        expect(page.mismatch).toEqual({ expected: 'B000000000', found: 'B0HJCRV1J6' });
    });

    it('Walmart: title, SKU, brand, UPC, price, rating and reviews from the page data, every check passing', async () => {
        const url = 'https://www.walmart.com/ip/EG-4-BURNER-GRILL/17070020028';
        const { page, field } = await read(await walmartProduct(fixture('wmart')), 'pdp-walmart', url);
        expect(page.rule).toBeUndefined();
        expect(page.mismatch).toBeUndefined();
        expect(field('PRODUCT_TITLE').value).toBe('Expert Grill 4-Burner Propane Gas Grill with Side Shelves and Wheels, Stainless Steel');
        expect(field('SKU')).toMatchObject({ value: '17070020028', ok: true });
        expect(field('BRAND').value).toBe('Expert Grill');
        expect(field('UPC')).toMatchObject({ value: '044376300333', ok: true });
        expect(field('IS_PRICE')).toMatchObject({ value: '$194.00', ok: true });
        expect(field('RATING')).toMatchObject({ value: '4.2', ok: true });
        expect(field('REVIEWS')).toMatchObject({ value: '6968', ok: true });
        expect(field('MODEL_NUMBER').value).toBe('EX5704430716002');
        expect(page.fields.filter(f => !f.ok).map(f => `${f.name}: ${f.problem}`)).toEqual([]);
    });

    it('Walmart: another id in the /ip/ URL is another product', async () => {
        const { page } = await read(await walmartProduct(fixture('wmart')), 'pdp-walmart', 'https://www.walmart.com/ip/Other-Grill/555');
        expect(page.mismatch).toEqual({ expected: '555', found: '17070020028' });
    });
});
