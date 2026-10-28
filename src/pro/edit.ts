/**
 * Building and editing recipes in the public Page and List Extractors (`docs/design/LLD.md` §9). The Recipes
 * screen starts a session (a new recipe of a kind, or a version to edit); the extractor takes it when it
 * opens (the same hand-off as `services/pageDataDraft.ts`) and its last step saves a version instead of
 * running. Opened from Home, without a session, the extractors run as they do in the public extension.
 */
import { listRunInput, listSpec, pageSpec, type RunElement } from '../shared/recipes/spec';
import type { ListPick, PaginationMode } from '../shared/types/extraction';
import { pro } from './db';
import { fromListSpec, fromPageSpec, toListSpec, toPageSpec } from './recipe/fromPublic';
import type { PageSource, ProRecipe, RecipeKind, RunSettings, Version, VersionDraft } from './recipe/types';
import { currentUser } from './identity';

/** A recipe being built (no version yet) or edited (from `version`). */
export interface ProEdit {
    kind: RecipeKind;
    recipe?: ProRecipe;
    version?: Version;
}

let pending: ProEdit | null = null;

export function setProEdit(edit: ProEdit) {
    pending = edit;
}

/** The session, once, for the extractor of its kind; another extractor leaves it. */
export function takeProEdit(kind: RecipeKind): ProEdit | null {
    if (pending?.kind !== kind) return null;
    const out = pending;
    pending = null;
    return out;
}

const urlsOf = (pages: PageSource): string[] =>
    pages.kind === 'urls' ? pages.urls : pages.kind === 'start' ? [pages.url] : [];

/** The site a recipe is for: the first page's host without `www.`. */
export function siteOfUrl(url: string | undefined): string {
    try { return new URL(url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** What the Page Extractor loads for an edit: the version's elements, its pages and its run settings. */
export function pageEditInput(version: Version): { elements: RunElement[]; urls: string[]; settings: RunSettings } {
    if (version.spec.kind !== 'page') throw new Error('Not a page recipe');
    const elements = toPageSpec(version.spec, version.settings).elements.map(e => ({ ...e }));
    return { elements, urls: urlsOf(version.pages), settings: version.settings };
}

/** What the List Extractor loads for an edit: its lists, pagination and start page. */
export function listEditInput(version: Version): { picks: ListPick[]; mode: PaginationMode; next: string[]; url?: string } {
    if (version.spec.kind !== 'list') throw new Error('Not a list recipe');
    const { picks, pagination } = listRunInput(toListSpec(version.spec, version.settings));
    return { picks, mode: pagination.mode, next: pagination.next, url: urlsOf(version.pages)[0] };
}

/** Saves a draft: version N+1 of the edited recipe, or version 1 of a new one (its pages become samples). */
async function saveDraft(edit: ProEdit, name: string, draft: VersionDraft, note: string, origin: 'edited' | 'repaired' | 'pruned' = 'edited'): Promise<{ recipe: ProRecipe; version: Version }> {
    const by = { note: note.trim(), author: await currentUser() };
    if (edit.recipe && edit.version) {
        const version = await pro.versions.save(edit.recipe.id, edit.version.version, draft, { ...by, origin });
        return { recipe: (await pro.recipes.get(edit.recipe.id))!, version };
    }
    const urls = urlsOf(draft.pages);
    const recipe = await pro.recipes.create({ name: name.trim(), site: siteOfUrl(urls[0]), kind: edit.kind });
    const version = await pro.versions.save(recipe.id, 0, draft, { ...by, origin: 'built' });
    if (urls.length > 0) await pro.samples.add(recipe.id, urls);
    return { recipe: (await pro.recipes.get(recipe.id))!, version };
}

export function savePageVersion(edit: ProEdit, input: { name: string; elements: RunElement[]; urls: string[]; settings: RunSettings; note: string }) {
    const { spec, settings } = fromPageSpec(pageSpec(input.elements, input.settings));
    const draft: VersionDraft = { spec, settings, pages: { kind: 'urls', urls: input.urls }, output: edit.version?.output ?? {} };
    return saveDraft(edit, input.name, draft, input.note);
}

export function saveListVersion(edit: ProEdit, input: { name: string; picks: ListPick[]; mode: PaginationMode; next: string[]; url?: string; note: string }) {
    const speed = edit.version?.settings.paginationSpeed as 'fast' | 'normal' | 'slow' | undefined;
    const { spec, settings } = fromListSpec(listSpec(input.picks, { mode: input.mode, next: input.next, ...(speed ? { speed } : {}) }));
    const pages: PageSource = input.url ? { kind: 'start', url: input.url } : { kind: 'urls', urls: [] };
    const draft: VersionDraft = { spec, settings: { ...edit.version?.settings, ...settings }, pages, output: edit.version?.output ?? {} };
    return saveDraft(edit, input.name, draft, input.note);
}

/** Saves an edited spec and output as the next version; settings and pages stay the base version's. */
export function saveSpecVersion(recipe: ProRecipe, base: Version, spec: VersionDraft['spec'], output: VersionDraft['output'], note: string, origin: 'edited' | 'repaired' | 'pruned' = 'edited') {
    const { settings, pages } = base;
    return saveDraft({ kind: recipe.kind, recipe, version: base }, '', { spec, settings, pages, output }, note, origin);
}
