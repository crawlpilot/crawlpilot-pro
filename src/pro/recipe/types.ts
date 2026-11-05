/**
 * Pro's recipe model (`docs/design/LLD.md` §2): a recipe, its immutable numbered versions and the labels
 * that point at them. A version's `spec` says what to extract and nothing else; run settings, default pages
 * and output live next to it, so the digest means "the same fields".
 */
import type { Chain, Column, DataBinding, ListTarget } from '../../shared/types/database';
import type { ProOp } from './ops';
import type { Shape } from '../../shared/extraction/shape';

export type RecipeKind = 'page' | 'list';
export type LabelName = 'latest' | 'test' | 'live';
export type VersionOrigin = 'built' | 'edited' | 'imported' | 'repaired' | 'restored' | 'pruned';

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
    /** What the crawler workers resolve the recipe by, with `pageType`; from a shared list ("zara"). */
    competitor?: string;
    /** "product", "listing"… */
    pageType?: string;
    /** Which URLs it is for, when several recipes share a competitor and page type. */
    matchRules?: MatchRules;
    createdAt: number;
    updatedAt: number;
}

/** What the crawler workers resolve a recipe by. */
export type Targeting = Pick<ProRecipe, 'competitor' | 'pageType' | 'matchRules'>;

/** The value a field outputs. */
export type FieldType =
    | 'text' | 'number' | 'integer' | 'money' | 'date' | 'url' | 'boolean' | 'enum' | 'list' | 'object' | 'table';

/** URL globs (`*` any run of characters): a URL is the recipe's if it matches an include and no exclude. */
export interface MatchRules {
    include: string[];
    exclude?: string[];
}

/**
 * Where a way came from, for its usage to add up across versions (`wayIds.ts`): the id stays while the way
 * is unchanged, and a changed way is a new one. Neither is part of the digest. Set on save.
 */
export interface WayIdentity {
    id?: string;
    /** The version it first appeared in. */
    addedIn?: number;
}

/** One way of finding a field, tried in order; the first that gives a value wins. */
export type Way = WayIdentity & (
    /** The page's own data: JSON-LD, embedded JSON or state. Its `ops` clean that value only. */
    | { kind: 'data'; binding: DataBinding }
    /** A CSS selector or an XPath. */
    | { kind: 'selector'; selector: string }
    /** The page's markup: a meta tag (`og:title`), or a microdata prop (`offers.price` of a `Product`). Read first. */
    | MarkupWay
);

/** A field read from the page's markup (`src/pro/markup/markup.ts`). */
export interface MarkupWay {
    kind: 'markup';
    source: 'meta' | 'microdata';
    /** The meta tag's property or name; or the itemprop path, dotted through nested items. */
    key: string;
    /** Microdata: the item's type (`Product`), when the page has several. */
    type?: string;
}

export interface Field {
    id: string;
    name: string;
    type: FieldType;
    required?: boolean;
    /** What the element reader reads (`ElementProcessor`: text, text_array, link, image, list, table…). */
    read: string;
    ways: Way[];
    /** Cleanup applied to the winning value, whichever way found it. */
    ops: ProOp[];
    /** A list or table field's frozen columns. */
    columns?: Column[];
    /** The kind of value picked; a healed match must be the same kind. */
    shape?: Shape;
}

/** What an action step does to its target (`docs/plans/pro-data-collection-plan.md`, C1). */
export type ActionKind = 'click' | 'type' | 'choose' | 'select' | 'press' | 'wait' | 'scroll';

/**
 * A step that acts on the page: a click, unless `do` says otherwise. Its ways find the target (for `choose`,
 * the items to choose from). `value` may hold variables, `{zip}`, filled from the job's context.
 * A plain click (no `do`, not optional) runs in the public extractor as before; any other action runs in
 * Pro's step runner, between the fields around it.
 */
export interface Click {
    id: string;
    name: string;
    ways: Way[];
    do?: ActionKind;
    /** type: the text; choose: text the item contains; select: the option's text or value; press: a key. */
    value?: string;
    /** choose: the n-th item (from 0), when there is no value. */
    index?: number;
    /** type: press Enter after typing. */
    enter?: boolean;
    /** Skipped when its target isn't there (a banner, a prompt), instead of failing. */
    optional?: boolean;
    /** wait: for the target to go away (a spinner), instead of to appear. */
    gone?: boolean;
}

/** A recipe's steps that set the browser session up (a location, a store), run once per session. */
export interface SessionSetup {
    steps: Click[];
    /**
     * Interruptions to close whenever they show, on every page: a consent banner, a promo pop-up, an
     * "Is this your location?" prompt. Each is a click on its close control, done only when it is there.
     */
    dismiss?: Click[];
    /** Read on every page: the element whose text must contain `contains` (with variables), or the setup runs again. */
    check?: { ways: Way[]; contains: string };
}

/** A page recipe's steps in run order: a click, then what it reveals, then the next click. */
export type Step = { kind: 'field'; field: Field } | { kind: 'click'; click: Click };

export interface PageRecipeSpec {
    kind: 'page';
    steps: Step[];
    setup?: SessionSetup;
}

export interface ListRecipeSpec {
    kind: 'list';
    lists: ListTarget[];
    pagination: { mode: 'auto' | 'pagination' | 'loadMore'; next?: Chain };
    /** Each item's page, read after the list and joined onto its row. */
    details?: { spec: PageRecipeSpec; urlColumn: string };
    setup?: SessionSetup;
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
    /** The output contract the records are checked against. */
    contract?: import('../../shared/contracts/contract').Contract;
    /** Contract field → recipe field, where set by hand; the rest map by name. */
    mapping?: import('../../shared/contracts/contract').FieldMapping;
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

export type ReviewState = 'approved' | 'rejected';

/** A second person's verdict on a version, kept apart from it: versions never change. */
export interface Review {
    id?: number;
    recipeId: string;
    version: number;
    state: ReviewState;
    by: string;
    at: number;
    /** Why; required to reject. */
    note: string;
}

export interface Sample {
    recipeId: string;
    url: string;
    /** Checked by the backend on a schedule. */
    canary?: boolean;
    addedAt: number;
}
