/**
 * The recipe file, `.crawlpilot.json` (`docs/design/LLD.md` §6). Format 1 is the public samples' file:
 * one public spec and where it was built and checked. Format 2 is Pro's: a recipe with its versions.
 * Format 3, the one written, adds what the crawler workers resolve a recipe by (competitor, page type,
 * match rules) and each way's stable id; a format 2 file's ways get their ids when its versions are saved.
 * Importing never overwrites: format 1 becomes version 1 of a new recipe, and a format 2 file adds the
 * versions whose digest the recipe doesn't have yet.
 */
import type { ListSpec, PageSpec } from '../../shared/types/database';
import { fromListSpec, fromPageSpec } from './fromPublic';
import { resolveContract } from './contract';
import type { LabelName, MatchRules, PageSource, ProRecipe, RecipeKind, Sample, Targeting, Version, VersionDraft } from './types';

export class RecipeFileError extends Error {
    constructor(readonly path: string, message: string) {
        super(`${path}: ${message}`);
    }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function need<T>(ok: boolean, path: string, message: string, value: T): T {
    if (!ok) throw new RecipeFileError(path, message);
    return value;
}

const text = (o: Json, key: string, path: string) =>
    need(typeof o[key] === 'string' && (o[key] as string).trim() !== '', `${path}.${key}`, 'expected text', o[key] as string);

/** What a file brings in: the recipe's identity, its versions in order (oldest first) and its sample pages. */
export interface ImportedRecipe {
    name: string;
    site: string;
    kind: RecipeKind;
    /** Empty for formats 1 and 2. */
    targeting: Targeting;
    versions: (VersionDraft & { note: string; digest?: string })[];
    samples: string[];
}

export function readRecipeFile(raw: string): ImportedRecipe {
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new RecipeFileError('$', 'not JSON'); }
    if (!isObject(json)) throw new RecipeFileError('$', 'expected an object');
    if (json.format === 2 || json.format === 3) return readVersioned(json);
    if (json.format === undefined || json.format === 1) return readFormat1(json);
    throw new RecipeFileError('$.format', `unknown format ${String(json.format)}`);
}

function readFormat1(json: Json): ImportedRecipe {
    const name = text(json, 'name', '$');
    const site = text(json, 'site', '$');
    const spec = need(isObject(json.spec), '$.spec', 'expected an object', json.spec as Json);
    const kind = need(spec.kind === 'page' || spec.kind === 'list', '$.spec.kind', 'expected "page" or "list"', spec.kind as RecipeKind);
    if (kind === 'page') need(Array.isArray(spec.elements), '$.spec.elements', 'expected a list', null);
    else need(Array.isArray(spec.lists), '$.spec.lists', 'expected a list', null);
    const converted = kind === 'page' ? fromPageSpec(spec as unknown as PageSpec) : fromListSpec(spec as unknown as ListSpec);
    const builtOn = typeof json.built_on === 'string' ? [json.built_on] : [];
    const checkedOn = Array.isArray(json.checked_on) ? json.checked_on.filter((u): u is string => typeof u === 'string') : [];
    const samples = [...new Set([...builtOn, ...checkedOn])];
    const pages: PageSource = { kind: 'urls', urls: samples };
    return {
        name, site, kind, samples, targeting: {},
        versions: [{
            ...converted, pages,
            output: typeof json.contract === 'string' && resolveContract(json.contract) ? { contract: resolveContract(json.contract) } : {},
            note: `Imported from ${name} (format 1)`,
        }],
    };
}

function readVersioned(json: Json): ImportedRecipe {
    const recipe = need(isObject(json.recipe), '$.recipe', 'expected an object', json.recipe as Json);
    const kind = need(recipe.kind === 'page' || recipe.kind === 'list', '$.recipe.kind', 'expected "page" or "list"', recipe.kind as RecipeKind);
    const list = need(Array.isArray(json.versions) && json.versions.length > 0, '$.versions', 'expected at least one version', json.versions as unknown[]);
    const versions = list.map((v, i) => {
        const path = `$.versions[${i}]`;
        need(isObject(v), path, 'expected an object', null);
        const o = v as Json;
        const spec = need(isObject(o.spec) && o.spec.kind === kind, `${path}.spec`, `expected a ${kind} spec`, o.spec as VersionDraft['spec']);
        need(typeof o.version === 'number', `${path}.version`, 'expected a number', null);
        return {
            order: o.version as number,
            spec,
            settings: isObject(o.settings) ? o.settings : {},
            pages: need(isObject(o.pages), `${path}.pages`, 'expected an object', o.pages as PageSource),
            output: isObject(o.output) ? o.output : {},
            note: typeof o.note === 'string' ? o.note : '',
            ...(typeof o.digest === 'string' ? { digest: o.digest } : {}),
        };
    }).sort((a, b) => a.order - b.order).map(({ order: _, ...v }) => v);
    const samples = Array.isArray(json.samples)
        ? json.samples.flatMap(s => isObject(s) && typeof s.url === 'string' ? [s.url] : [])
        : [];
    return { name: text(recipe, 'name', '$.recipe'), site: text(recipe, 'site', '$.recipe'), kind, targeting: readTargeting(recipe), versions, samples };
}

function readTargeting(recipe: Json): Targeting {
    const globs = (v: unknown, path: string) =>
        need(Array.isArray(v) && v.every(g => typeof g === 'string'), path, 'expected a list of text', v as string[]);
    let matchRules: MatchRules | undefined;
    if (recipe.matchRules !== undefined) {
        const rules = need(isObject(recipe.matchRules), '$.recipe.matchRules', 'expected an object', recipe.matchRules as Json);
        matchRules = {
            include: globs(rules.include, '$.recipe.matchRules.include'),
            ...(rules.exclude !== undefined ? { exclude: globs(rules.exclude, '$.recipe.matchRules.exclude') } : {}),
        };
    }
    return {
        ...(typeof recipe.competitor === 'string' ? { competitor: recipe.competitor } : {}),
        ...(typeof recipe.pageType === 'string' ? { pageType: recipe.pageType } : {}),
        ...(matchRules ? { matchRules } : {}),
    };
}

/** A recipe as a format 3 file: all its versions, or only the ones given. */
export function writeRecipeFile(recipe: ProRecipe, versions: Version[], samples: Sample[]): string {
    const labels: Partial<Record<LabelName, number>> = {};
    for (const [label, v] of Object.entries(recipe.labels) as [LabelName, number][]) if (versions.some(x => x.version === v)) labels[label] = v;
    return JSON.stringify({
        format: 3,
        recipe: {
            name: recipe.name, site: recipe.site, kind: recipe.kind,
            ...(recipe.competitor ? { competitor: recipe.competitor } : {}),
            ...(recipe.pageType ? { pageType: recipe.pageType } : {}),
            ...(recipe.matchRules ? { matchRules: recipe.matchRules } : {}),
        },
        labels,
        samples: samples.map(s => ({ url: s.url, ...(s.canary ? { canary: true } : {}) })),
        versions: [...versions].sort((a, b) => a.version - b.version).map(({ recipeId: _, ...v }) => ({
            ...v, createdAt: new Date(v.createdAt).toISOString(),
            ...(v.submittedAt ? { submittedAt: new Date(v.submittedAt).toISOString() } : {}),
        })),
    }, null, 2) + '\n';
}
