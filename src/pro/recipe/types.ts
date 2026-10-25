/**
 * Pro's recipe model (`docs/design/LLD.md` §2): a recipe, its immutable numbered versions and the labels
 * that point at them. A version's `spec` says what to extract and nothing else; run settings, default pages
 * and output live next to it, so the digest means "the same fields".
 */
import type { Chain, Column, DataBinding, ListTarget } from '../../shared/types/database';
import type { TransformOp } from '../../shared/transforms/chain';
import type { Shape } from '../../shared/extraction/shape';

export type RecipeKind = 'page' | 'list';
export type LabelName = 'latest' | 'test' | 'live';
export type VersionOrigin = 'built' | 'edited' | 'imported' | 'repaired' | 'restored';

export interface ProRecipe {
    id: string;
    name: string;
    /** The site's host without `www.` ("zara.com"). */
    site: string;
    kind: RecipeKind;
    /** The newest version's number (0 before the first save). */
    latestVersion: number;
    /** The backend's id for this recipe, after the first submit. */
    remoteId?: string;
    /** Label → version number. No `live` means a draft. */
    labels: Partial<Record<LabelName, number>>;
    createdAt: number;
    updatedAt: number;
}

/** The value a field outputs. */
export type FieldType =
    | 'text' | 'number' | 'integer' | 'money' | 'date' | 'url' | 'boolean' | 'enum' | 'list' | 'object' | 'table';

/** One way of finding a field, tried in order; the first that gives a value wins. */
export type Way =
    /** The page's own data: JSON-LD, embedded JSON or state. Its `ops` clean that value only. */
    | { kind: 'data'; binding: DataBinding }
    /** A CSS selector or an XPath. */
    | { kind: 'selector'; selector: string };

export interface Field {
    id: string;
    name: string;
    type: FieldType;
    required?: boolean;
    /** What the element reader reads (`ElementProcessor`: text, text_array, link, image, list, table…). */
    read: string;
    ways: Way[];
    /** Cleanup applied to the winning value, whichever way found it. */
    ops: TransformOp[];
    /** A list or table field's frozen columns. */
    columns?: Column[];
    /** The kind of value picked; a healed match must be the same kind. */
    shape?: Shape;
}

export interface Click {
    id: string;
    name: string;
    ways: Way[];
}

/** A page recipe's steps in run order: a click, then what it reveals, then the next click. */
export type Step = { kind: 'field'; field: Field } | { kind: 'click'; click: Click };

export interface PageRecipeSpec {
    kind: 'page';
    steps: Step[];
}

export interface ListRecipeSpec {
    kind: 'list';
    lists: ListTarget[];
    pagination: { mode: 'auto' | 'pagination' | 'loadMore'; next?: Chain };
    /** Each item's page, read after the list and joined onto its row. */
    details?: { spec: PageRecipeSpec; urlColumn: string };
}

export type ProSpec = PageRecipeSpec | ListRecipeSpec;

/** Pace, waits and viewport: how to run, not what to read. */
export type RunSettings = Record<string, unknown>;

/** The pages a crawl reads by default. */
export type PageSource =
    | { kind: 'urls'; urls: string[] }
    | { kind: 'sitemap'; sitemap: string; include?: string; exclude?: string }
    | { kind: 'start'; url: string };

export interface OutputSpec {
    /** The output contract the records are checked against (its id or file name). */
    contract?: string;
}

/** A saved version. Never changed once written. */
export interface Version {
    recipeId: string;
    version: number;
    spec: ProSpec;
    settings: RunSettings;
    pages: PageSource;
    output: OutputSpec;
    /** sha256 of the canonical spec. */
    digest: string;
    /** sha256 of the output's field names, types and required flags: equal means consumers are safe. */
    outputDigest: string;
    parentVersion?: number;
    parentDigest?: string;
    origin: VersionOrigin;
    note: string;
    author: string;
    createdAt: number;
    /** Set once, on submit; a submitted version is locked for good. */
    submittedAt?: number;
}

/** What a save writes: a version without its number, digests or lineage. */
export type VersionDraft = Pick<Version, 'spec' | 'settings' | 'pages' | 'output'>;

export interface LabelMove {
    id?: number;
    recipeId: string;
    label: LabelName;
    from?: number;
    to: number;
    by: string;
    at: number;
    reason: string;
}

export interface Sample {
    recipeId: string;
    url: string;
    /** Checked by the backend on a schedule. */
    canary?: boolean;
    addedAt: number;
}
