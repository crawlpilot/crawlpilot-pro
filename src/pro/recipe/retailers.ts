/**
 * The Amazon and Walmart product-page recipes (`recipes/*.crawlpilot.json`), built from their Atlas exports
 * (`atlas/fixtures/`) and then given what Pro adds (`docs/plans/pro-rules-assertions-plan.md`):
 * - sturdier ways first: Walmart's page data (`__NEXT_DATA__`), Amazon's hidden ASIN input;
 * - the delivery location set before reading (a `{zip}` per job), checked on every page;
 * - page rules beyond Atlas's error pages: a sign-in redirect, robot-check wording in the visible text;
 * - value checks: the id's shape, a rating out of 5, a US dollar price, a count of reviews;
 * - the identity check (Walmart's from its `/ip/<name>/<id>` URL), targeting and sample pages.
 * Field names and types stay Atlas's, so the crawler's output keeps the names its consumers read.
 * `recipes.test.ts` checks them against the saved pages (`src/test/fixtures/corpus/pdp-*.html.gz`) and writes the
 * files with `UPDATE_RECIPES=1`.
 */
import type { Condition, PageRule } from '../../shared/types/ways';
import type { DataBinding } from '../../shared/types/database';
import { readAtlasExport } from './atlas/import';
import { outputDigest, specDigest } from './canonical';
import type { ImportedRecipe } from './file';
import { writeRecipeFile } from './file';
import type { Click, Field, PageRecipeSpec, ProRecipe, SessionSetup, ValueCheck, Version, Way } from './types';
import { assignWayIds } from './wayIds';

export interface RetailerRecipe {
    recipe: ProRecipe;
    version: Version;
    samples: string[];
    /** What the Atlas import could not carry over, and what was added: the version's note. */
    note: string;
}

const sel = (selector: string, more: Partial<Extract<Way, { kind: 'selector' }>> = {}): Way => ({ kind: 'selector', selector, ...more });
const text = (pattern: string, flags = 'i'): Condition => ({ kind: 'regex', in: 'text', pattern, flags, op: 'gt', value: 0 });
const nextData = (...path: string[]): Way => {
    const binding: DataBinding = { kind: 'json', label: '__NEXT_DATA__', nth: 0, path: ['props', 'pageProps', 'initialData', 'data', ...path], as: 'text' };
    return { kind: 'data', binding };
};

/** Changes a field by name; a name the export no longer has is an error, so a changed export is noticed. */
function edit(spec: PageRecipeSpec, name: string, f: (field: Field) => Field): PageRecipeSpec {
    if (!spec.steps.some(s => s.kind === 'field' && s.field.name === name)) throw new Error(`The export has no field ${name}.`);
    return { ...spec, steps: spec.steps.map(s => s.kind === 'field' && s.field.name === name ? { kind: 'field', field: f(s.field) } : s) };
}
const firstWays = (...ways: Way[]) => (f: Field): Field => ({ ...f, ways: [...ways, ...f.ways] });
const checks = (...c: ValueCheck[]) => (f: Field): Field => ({ ...f, checks: [...(f.checks ?? []), ...c] });
const required = (f: Field): Field => ({ ...f, required: true });

/** Rules every product page gets, after the export's own: a sign-in page, and robot-check wording a visitor sees. */
const commonRules = (signIn: string, robot: string): PageRule[] => [
    { name: 'Sign-in redirect', status: 'blocked', when: { kind: 'regex', in: 'url', pattern: signIn, flags: 'i', op: 'gt', value: 0 } },
    { name: 'Robot check', status: 'blocked', when: text(robot) },
];

const US_PRICE: ValueCheck = { kind: 'pattern', pattern: '^\\$\\d{1,3}(,\\d{3})*(\\.\\d{2})?$' };
const RATING: ValueCheck = { kind: 'range', min: 0, max: 5 };
const COUNT: ValueCheck = { kind: 'pattern', pattern: '^\\d{1,3}(,?\\d{3})*$' };

const click = (id: string, name: string, ways: Way[], more: Partial<Click> = {}): Click => ({ id, name, ways, ...more });

/** Amazon's "Deliver to" ZIP: open the popover, type the ZIP, apply, close; then the header shows it. */
const AMAZON_SETUP: SessionSetup = {
    dismiss: [
        click('d-location-toaster', 'Location prompt', [sel('.glow-toaster-button-dismiss input'), sel("input[data-action-type='DISMISS']")]),
        click('d-cookies', 'Cookie banner', [sel('#sp-cc-rejectall-link')]),
    ],
    steps: [
        click('s-open', 'Open Deliver to', [sel('#nav-global-location-popover-link'), sel('#glow-ingress-block')]),
        click('s-zip', 'Type ZIP', [sel('#GLUXZipUpdateInput')], { do: 'type', value: '{zip}' }),
        click('s-apply', 'Apply', [sel('#GLUXZipUpdate input'), sel('#GLUXZipUpdate')]),
        click('s-done', 'Continue', [sel('#GLUXConfirmClose'), sel("button[name='glowDoneButton']"), sel('.a-popover-footer input.a-button-input')], { optional: true }),
    ],
    check: { contains: '{zip}', ways: [sel('#glow-ingress-line2'), sel('#nav-global-location-popover-link')] },
};

/**
 * Walmart's shipping ZIP: the "Change shipping address" control (seen on the saved page), then the dialog's ZIP box
 * and Save. The dialog is not on the saved page, so its selectors are the likely ones, several each; the check (the
 * page says it ships to the ZIP) fails a session they don't set, rather than reading the wrong location.
 */
const WALMART_SETUP: SessionSetup = {
    steps: [
        click('s-open', 'Change shipping address', [sel('[aria-label$="Change shipping address"]'), sel('button:contains(Ships to)')]),
        click('s-zip', 'Type ZIP', [sel('input[autocomplete="postal-code"]'), sel('input[name*="zip" i]'), sel('input[aria-label*="ZIP" i]')], { do: 'type', value: '{zip}' }),
        click('s-save', 'Save', [sel('[role="dialog"] button:contains(Save)'), sel('button[type="submit"]:contains(Save)')]),
    ],
    check: { contains: '{zip}', ways: [sel('div[data-testid="fulfillment-zone-2"]'), sel('[aria-label$="Change shipping address"]')] },
};

async function build(o: {
    fixture: string; name: string; site: string; competitor: string; pageType: string; include: string[];
    samples: string[]; adapt: (spec: PageRecipeSpec) => PageRecipeSpec; added: string[];
}): Promise<RetailerRecipe> {
    const imported: ImportedRecipe = readAtlasExport(o.fixture);
    const first = imported.versions[0];
    let n = 0;
    const spec = assignWayIds(o.adapt(first.spec as PageRecipeSpec), 1, undefined, () => `${o.competitor}-w${++n}`);
    const note = [`From the ${o.competitor} Atlas export, with what Pro adds.`, ...o.added.map(a => `Added: ${a}`), ...(imported.notes ?? []).map(n => `Not carried over: ${n}`)].join('\n');
    const recipe: ProRecipe = {
        id: o.competitor, name: o.name, site: o.site, kind: 'page', latestVersion: 1, labels: { latest: 1 },
        competitor: o.competitor, pageType: o.pageType, matchRules: { include: o.include }, createdAt: 0, updatedAt: 0,
    };
    const version: Version = {
        recipeId: recipe.id, version: 1, spec, settings: first.settings, pages: { kind: 'urls', urls: o.samples }, output: first.output,
        digest: await specDigest(spec), outputDigest: await outputDigest(spec), origin: 'imported', note, author: 'recipes', createdAt: 0,
    };
    return { recipe, version, samples: o.samples, note };
}

export function amazonProduct(fixture: string): Promise<RetailerRecipe> {
    return build({
        fixture, name: 'Amazon product page', site: 'amazon.com', competitor: 'amazon', pageType: 'product',
        include: ['https://www.amazon.com/*dp/*', 'https://www.amazon.com/gp/product/*'],
        samples: ['https://www.amazon.com/dp/B0HJCRV1J6'],
        added: [
            'the delivery ZIP ({zip}) set before reading, checked in the header on every page',
            'SKU read from the hidden ASIN input and the title widget first (the add-to-cart form is missing when there is no buy box)',
            'page rules: a sign-in redirect, robot-check wording',
            'checks: SKU is an ASIN, prices in US dollars, rating 0–5, review count',
            'PRODUCT_TITLE and SKU required',
        ],
        adapt: spec => {
            let s: PageRecipeSpec = { ...spec, setup: AMAZON_SETUP, rules: [...(spec.rules ?? []), ...commonRules('/ap/signin', "Sorry, we just need to make sure you're not a robot|Enter the characters you see below")] };
            s = edit(s, 'SKU', f => checks({ kind: 'pattern', pattern: '^[A-Z0-9]{10}$' })(required(firstWays(
                sel('#ASIN', { read: 'attr', attr: 'value' }),
                sel('[data-csa-c-content-id="title"]', { read: 'attr', attr: 'data-csa-c-asin' }),
            )(f))));
            s = edit(s, 'PRODUCT_TITLE', required);
            for (const price of ['IS_PRICE', 'WAS_PRICE', 'DEAL_PRICE']) s = edit(s, price, checks(US_PRICE));
            s = edit(s, 'RATING', checks(RATING));
            s = edit(s, 'REVIEWS', checks(COUNT));
            return s;
        },
    });
}

export function walmartProduct(fixture: string): Promise<RetailerRecipe> {
    const product = (...path: string[]) => nextData('product', ...path);
    return build({
        fixture, name: 'Walmart product page', site: 'walmart.com', competitor: 'walmart', pageType: 'product',
        include: ['https://www.walmart.com/ip/*'],
        samples: ['https://www.walmart.com/ip/EG-4-BURNER-GRILL/17070020028'],
        added: [
            'the shipping ZIP ({zip}) set before reading, checked on every page (the dialog\'s selectors are not on the saved page: test them live)',
            'the page\'s data (__NEXT_DATA__) read first for the title, SKU, brand, UPC, model, price, was price, rating, reviews and description',
            'the identity check: SKU against the id in the /ip/ URL',
            'page rules: a sign-in redirect, robot-check wording',
            'checks: SKU and UPC are numbers, prices in US dollars, rating 0–5, review count',
            'PRODUCT_TITLE and SKU required',
        ],
        adapt: spec => {
            let s: PageRecipeSpec = {
                ...spec, setup: WALMART_SETUP,
                rules: [...(spec.rules ?? []), ...commonRules('/account/login', 'Robot or human\\?|Press & Hold to confirm you are')],
                identity: { field: 'SKU', url: ['(?<=/ip/(?:[^/?#]+/)?)\\d+(?=[/?#]|$)'] },
            };
            s = edit(s, 'PRODUCT_TITLE', f => required(firstWays(product('name'))(f)));
            s = edit(s, 'SKU', f => checks({ kind: 'pattern', pattern: '^\\d+$' })(required(firstWays(product('usItemId'))(f))));
            s = edit(s, 'BRAND', firstWays(product('brand')));
            s = edit(s, 'UPC', f => checks({ kind: 'pattern', pattern: '^\\d{12,14}$' })(firstWays(product('upc'))(f)));
            s = edit(s, 'MODEL_NUMBER', firstWays(product('model')));
            s = edit(s, 'IS_PRICE', f => checks(US_PRICE)(firstWays(product('priceInfo', 'currentPrice', 'priceString'))(f)));
            s = edit(s, 'WAS_PRICE', f => checks(US_PRICE)(firstWays(product('priceInfo', 'wasPrice', 'priceString'))(f)));
            s = edit(s, 'RATING', f => checks(RATING)(firstWays(product('averageRating'))(f)));
            s = edit(s, 'REVIEWS', f => checks(COUNT)(firstWays(product('numberOfReviews'))(f)));
            s = edit(s, 'PRODUCT_DESCRIPTION', firstWays(product('shortDescription')));
            return s;
        },
    });
}

/** The recipe as its `.crawlpilot.json` file. */
export const fileOf = (r: RetailerRecipe) => `${JSON.stringify(JSON.parse(writeRecipeFile(r.recipe, [r.version], r.samples.map((url, i) => ({ recipeId: r.recipe.id, url, addedAt: i })))), null, 2)}\n`;
