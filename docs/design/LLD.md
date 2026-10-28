# CrawlPilot Pro: low-level design

Status: 2026-10-25. Draft for slices 2–5. Read [HLD.md](HLD.md) first; code it builds on is in [REFERENCES.md](REFERENCES.md).

## 1. Module layout
Everything Pro-only lives under `src/pro/`. Upstream files only get the hook points in §9.

```
src/pro/
  recipe/
    types.ts          ProRecipe, Version, Label, Field, Sample, Golden, Test… (§2)
    canonical.ts      canonical spec, digest, outputDigest (§4)
    fromPublic.ts     PageSpec/ListSpec + settings → Version parts; the only place that reads public types
    diff.ts           structured diff of two versions (§5)
    file.ts           .crawlpilot.json format 3 write; format 1, 2 and 3 read (§6)
    wayIds.ts         stable way ids, carried across versions (§6)
    targeting.ts      URL match rules and the samples they leave out (§6)
    ready.ts          the "ready to submit" gate (§7.4)
  db/
    schema.ts         database crawlpilot-pro, stores, indexes (§3)
    recipes.ts        repository: recipes, labels, label log
    versions.ts       repository: save (§4.3), get, list, restore
    tests.ts          repository: tests, samples, golden records
  runner/
    testPage.ts       test on this page (§7.1)
    testPages.ts      test on N pages in background tabs (§7.2)
    checks.ts         value checks, contract check, golden compare (§7.3)
  backend/
    types.ts          request/response types (the contract with the backend team)
    client.ts         fetch wrapper: auth, retries, errors (§8)
    auth.ts           chrome.identity sign-in, token cache
    mock.ts           in-memory server for unit tests and e2e
  pages/
    RecipesPage.tsx   library (Pro home)
    EditorPage.tsx    fields panel, clicks, pages, settings
    HistoryPage.tsx   versions, labels, diff, restore
    TestPanel.tsx     this page / N pages, grid, trace
    SubmitDialog.tsx  version, pages, schedule, gate
    CrawlsPanel.tsx   backend crawls and health
  hooks.ts            the functions upstream hook points call (§9)
```

Rules:
- `src/pro/**` may import upstream code. Upstream code imports Pro only through `src/pro/hooks.ts`.
- Only `src/pro/db/*` names an IndexedDB store, which is the same rule upstream follows in `shared/db`.
- Only `fromPublic.ts` reads `PageSpec`, `ListSpec` and `PageElement`, so upstream type changes break in one file.

## 2. Data model
```ts
// src/pro/recipe/types.ts
export type RecipeKind = 'page' | 'list';
export type LabelName = 'latest' | 'test' | 'live';
export type VersionOrigin = 'built' | 'edited' | 'imported' | 'repaired' | 'restored';

export interface ProRecipe {
  id: string;                 // uuid
  name: string;               // "ZARA · product details"
  site: string;               // "zara.com"
  kind: RecipeKind;
  latestVersion: number;      // denormalised for the library
  remoteId?: string;          // backend recipe id after the first submit
  labels: Partial<Record<LabelName, number>>;   // label → version number; no `live` = draft
  health?: RecipeHealth;      // last backend health summary (slice 5)
  createdAt: number;
  updatedAt: number;
}

export interface Version {
  recipeId: string;
  version: number;            // 1, 2, 3… per recipe
  spec: ProSpec;              // what to extract only: no settings, no URLs
  settings: RunSettings;      // pace, waits, viewport
  pages: PageSource;          // default pages
  output: OutputSpec;         // field names, types, contract mapping
  digest: string;             // sha256(canonical(spec))
  outputDigest: string;       // sha256(canonical(output fields: name + type))
  parentVersion?: number;
  parentDigest?: string;
  origin: VersionOrigin;
  note: string;
  author: string;             // signed-in email, or "local" before slice 4
  createdAt: number;
  submittedAt?: number;       // set once; a submitted version is locked for good
}

export type ProSpec =
  | { kind: 'page'; steps: Step[] }                       // fields and clicks, in run order
  | { kind: 'list'; lists: ListTarget[]; pagination: Pagination; details?: { recipe: string; urlField: string } };

export interface Field {
  id: string;
  name: string;
  type: FieldType;            // text | number | integer | money | date | url | boolean | enum | list | object | table
  required?: boolean;
  ways: Way[];                // ordered fallbacks; first that yields a value wins
  ops: ProOp[];               // cleanup on the winning value: the public TransformOps plus splitList, toObject (recipe/ops.ts)
  checks?: Check[];           // slice 3
  shape?: Shape;              // kept from upstream, used by healing
}

export type Way =
  | { kind: 'data'; binding: DataBinding }       // JSON-LD / embedded JSON / state
  | { kind: 'selector'; selector: string }     // CSS or XPath
  | { kind: 'label'; text: string }              // value next to a label (slice 2–3)
  | { kind: 'attr'; selector: string; attr: string }
  | { kind: 'url'; part: 'path' | 'query'; key: string }
  | { kind: 'meta'; name: string };

export type Step = { kind: 'field'; field: Field } | { kind: 'click'; id: string; ways: Way[]; onError?: 'fail' | 'continue' | 'skip' };

export type PageSource =
  | { kind: 'urls'; urls: string[] }
  | { kind: 'sitemap'; sitemap: string; include?: string; exclude?: string }
  | { kind: 'start'; url: string };

export interface LabelMove { recipeId: string; label: LabelName; from?: number; to: number; by: string; at: number; reason: string }
export interface Sample    { recipeId: string; url: string; canary?: boolean; addedAt: number }
export interface Golden    { recipeId: string; version: number; url: string; record: Record<string, unknown>; html: Blob; approvedBy: string; at: number }
export interface TestRun   { id: string; recipeId: string; version: number; kind: 'page' | 'pages'; results: PageResult[]; contract?: ContractReport; passed: boolean; at: number }
export interface PageResult { url: string; record: Record<string, unknown>; steps: FieldTrace[]; error?: string }
export interface FieldTrace { fieldId: string; status: 'ok' | 'data' | 'healed' | 'empty' | 'failed'; wonBy?: number; raw?: unknown; value?: unknown; failedChecks?: string[] }
```

Mapping from public types (in `fromPublic.ts`):
- `PageElement` with `action: 'extract'` becomes a `Field`. Its `data` becomes a `{kind:'data'}` way, which comes first, and each `selectors[i]` becomes a `{kind:'selector'}` way (CSS or XPath).
  - `data.ops` stay inside the binding: they clean only the page-data value. The field's own `ops` start empty and apply to the value whichever way found it.
  - `type` becomes `read` (what the element reader reads), so the round trip is exact. The output `type` is a first guess from `read`, `data.as` and `shape`.
- `PageElement` with `action: 'click'` becomes `{kind:'click'}`, keeping its position in `steps`.
- `PageSpec.settings` moves to `Version.settings`, outside the spec.
- `ListSpec` maps to a list `ProSpec`. Its `details.page` becomes a separate page recipe linked by name (D20).

`toPublic` does the reverse, so that tests can call the upstream `extractPage` unchanged.

## 3. Storage: IndexedDB `crawlpilot-pro`
The database is separate from upstream's `crawl-pilot`.

| Store | Key | Indexes | Notes |
|---|---|---|---|
| `recipes` | `id` | `site`, `updatedAt`, `name` | `labels` live on the record |
| `versions` | `[recipeId, version]` | `recipeId`, `digest`, `createdAt` | write-once (§4.3) |
| `labelLog` | auto | `recipeId`, `at` | every label move |
| `samples` | `[recipeId, url]` | `recipeId` | |
| `tests` | `id` | `[recipeId, version]`, `at` | keep the latest 20 per version |
| `golden` | `[recipeId, version, url]` | `recipeId` | `html` as a Blob; at most 10 per version |
| `drafts` | `recipeId` | | autosave of the open editor; one per recipe |

- Version 1 of the schema creates all of these stores. Later changes add migrations in `schema.ts`, in the same style as upstream's `shared/db/schema.ts`.
- `chrome.storage.session` holds only the auth token, never recipe data.

## 4. Canonical form and digests
### 4.1 Canonical JSON
- Sort keys recursively (the same approach as upstream `specJson`).
- Drop `undefined`, and keep array order.
- Drop field `id`s and click `id`s. They are identity, not meaning.
- Normalise whitespace in selectors.

### 4.2 Digests
- `digest = sha256(canonical(spec))`, hex, using `crypto.subtle.digest`. The spec contains no settings or URLs, so a change to the pace or the pages does not change the digest.
- `outputDigest = sha256(canonical(fields.map(f => [f.name, f.type, !!f.required])))`, in the order of the fields.
- The public `specHash` is not used. It is 32-bit and includes the settings (D4).

### 4.3 Saving a version
`saveVersion(recipeId, baseVersion, draft, note)` runs in a single `readwrite` transaction over `recipes` and `versions`:
1. Read the recipe. If `recipe.latestVersion !== baseVersion`, reject with `StaleBase { latest }`. The UI offers to reload and never overwrites.
2. Compute `digest`. If it equals the base version's digest and the settings, pages and output are unchanged, reject with `NoChange`.
3. Write the version with `N = latestVersion + 1`, `parentVersion = baseVersion`, `parentDigest`, `origin` and `note`.
4. Set `recipe.latestVersion = N` and `labels.latest = N`, add a `labelLog` row, and update `updatedAt`.
5. Delete the draft.

A version is never updated afterwards. The repository has no update function, and a unit test checks that the `versions` store is only ever added to.

### 4.4 Restore
"Restore version k" calls `saveVersion` with version k's content as the draft and `origin: 'restored'`, so restoring always produces a new version.

## 5. Diff
`diff(a: Version, b: Version): VersionDiff`
- Fields are matched by `name`. Rename detection: a removed and an added field with the same ways, or with the same first way, count as a rename.
- For each matched field, compare `type`, `required`, `ways` (list diff by value, including order moves), `ops` and `checks`.
- Steps: clicks inserted, removed or moved, by position relative to fields.
- Lists: container and item ways, pagination mode and next control.
- Top level: `settings` and `pages` (shallow), and `outputChanged = a.outputDigest !== b.outputDigest`.

The output is `{ fields: { added, removed, renamed, changed: {name, parts[]}[] }, steps, pagination, settings, pages, outputChanged }`. The Save version dialog uses the same diff to show "what changed" against the base version.

## 6. Recipe file `.crawlpilot.json` (format 3)
```jsonc
{
  "format": 3,
  "recipe": {
    "name": "ZARA · product details", "site": "zara.com", "kind": "page",
    // What the crawler workers resolve the recipe by; match rules only when several recipes share the pair.
    "competitor": "zara", "pageType": "product",
    "matchRules": { "include": ["https://www.zara.com/*-p*.html*"], "exclude": ["*/kids/*"] }
  },
  "labels": { "live": 3, "latest": 4 },
  "samples": [{ "url": "https://…", "canary": true }],
  "requirements": { "js": true, "paceMs": 2000, "signIn": false, "locale": "en-IN" },  // slice 4
  "versions": [
    { "version": 3, "digest": "…", "outputDigest": "…", "parentDigest": "…", "origin": "edited",
      "note": "price from JSON-LD first", "author": "…", "createdAt": "2026-…",
      "spec": { … }, "settings": { … }, "pages": { … }, "output": { … } }
  ]
}
```
- **Format 3** adds the recipe's competitor, page type and match rules, and an `id` and `addedIn` on every way in the spec: `{ "id": "…", "addedIn": 2, "kind": "selector", "selector": ".price" }`. Neither is part of the digest.
- **Way ids** (`wayIds.ts`) are given on save. A way keeps its id while it reads the same under the same field or click (fields match by id, then by name); a way without one takes the id of the same way in the base version; anything else, an edited selector included, is a new way first seen in the version saved. The crawler reports usage per way id, so usage adds up across versions.
- **Match rules** (`targeting.ts`) are URL globs: `*` is any run of characters, the rest literal, matched against the whole URL, case aside. A URL is the recipe's when it matches an include and no exclude.
- **Export** writes the whole recipe, or a single version (`versions` then has one entry). Golden HTML is left out unless asked for.
- **Import formats 2 and 3:** if the recipe exists (same `name` and `site`), versions with an unknown digest are added as new numbers with `origin: 'imported'`. It never overwrites.
- **Import format 1** (the public samples): `spec` (a public `PageSpec`) goes through `fromPublic`; `built_on` and `checked_on` become samples; `contract` becomes `output.contract`. The result is version 1 with `origin: 'imported'`.
- **Validation:** a hand-written type guard in `file.ts`, with readable errors that give the JSON path. There is no schema library.

## 7. Tests and checks
### 7.1 Test on this page
1. `toPublic(version)` gives elements and config.
2. `sendToActiveTab('CMD_EXTRACT_PAGE_BACKGROUND' …)`, or a new `PRO_TEST_PAGE` message that calls `extractPage` with full traces.
3. Map the returned `PageStep`s to `FieldTrace`s.
4. Run checks (§7.3), store a `TestRun` of kind `page`, and highlight each field on the page (`SHOW_SELECTION_HIGHLIGHTS`).

### 7.2 Test on N pages
- Built (`runner/testPages.ts`). It runs from the side panel, not the service worker, so no upstream background hook is needed.
- It reads the recipe's first 5 sample pages, one at a time and the recipe's pace apart. Each page opens in a background tab (`active: false`); Pro waits for the load and for the content script to answer, runs the page test (§7.1), and closes the tab.
- It writes no job, table or rows: one `TestRun` of kind `pages`, under the tested spec's digest.
- Still to do: cancel, and clicks in tabs that never become visible (the public runner's parked window).

### 7.3 Checks
- **Value checks** (slice 3): `notEmpty`, `pattern`, `range`, `oneOf`, `uniqueInList`, `compare(a op b)` and `waysAgree`. Each has a severity of `warn` or `error`.
- **Contract** (built, `recipe/contract.ts`): `output.contract` is a public `Contract`, from a preset, the bundled sample schema, or a pasted JSON Schema (`parseSchemaInput`). The tested records (each field's cleaned value) are mapped with `autoMap`, overridden by `output.mapping`, then `shapeRows` + `checkContract`. Unmapped required fields and fields under their floor are readiness reasons.
- **Golden:** field-by-field equality against the approved record, after cleanup. The output lists `{field, expected, got}`.
- **Baseline:** the fill share per field across the test pages, stored on the version at submit time (`output.baseline`).

### 7.4 Ready to submit (`ready.ts`)
A version is ready only if all of these hold:
- the latest `TestRun` for the version has `kind: 'pages'`, at least 3 pages, and no page error;
- every `required` field has a value on all tested pages;
- the contract report passes, if the version has a contract;
- no check with `error` severity failed;
- the golden compare passes, where golden records exist;
- every required field has at least 2 ways of 2 different kinds (B6 rule, enforced from slice 3).

The function returns `{ ready: boolean, reasons: string[] }`. The Submit dialog shows the reasons.

The recipe has its own gate, apart from any version (`targeting.ts`, `targetingReasons`): a competitor and a page type are set, because the crawler workers find a recipe by them, and the match rules, if any, cover every sample page. History shows it in the Crawler targeting card, the Submit dialog shows it and keeps Submit off, and `submitVersion` refuses without it.

## 8. Backend client
Proposed contract; the backend team owns it. Base URL is a Pro setting. All calls send `Authorization: Bearer <token>`.

| Call | Request | Response |
|---|---|---|
| `POST /recipes` | `{ name, site, kind }` | `{ id }` |
| `POST /recipes/{id}/versions` | `.crawlpilot.json` with one version; header `Idempotency-Key: <digest>` | `{ version, accepted: boolean, errors? }` |
| `POST /recipes/{id}/crawls` | `{ version, pages, schedule: 'once' \| 'daily' \| 'weekly' }` | `{ crawlId }` |
| `GET /crawls/{id}` | none | `{ status, pagesDone, pagesFailed, fields: { name, fill, fallbackShare, failedChecks }[], samples: Record[] }` |
| `POST /recipes/{id}/labels/live` | `{ version, reason }` | `{ live }` |
| `POST /recipes/{id}/pause`, `/resume` | none | `{ status }` |

- **Built so far** (`backend/client.ts`, `mock.ts`, `submit.ts`, `settings.ts`): the calls above, retries and error kinds as described, the submit flow with the readiness gate, crawl refresh. Until the identity provider is chosen, the address and an access token are set in the Backend dialog (address in `chrome.storage.local`, token in `chrome.storage.session`). The e2e tests serve `mock.ts` on a local port (`e2e/pro.ts`).
- **Auth, later** (`auth.ts`): `chrome.identity.launchWebAuthFlow` against the identity provider. The redirect URL is `https://gpehmmoohclacmpomaekjklfncabiiip.chromiumapp.org/`, which works because the extension ID is fixed. The token is cached in `chrome.storage.session`, and on a 401 Pro signs in again once.
- **Retries:** up to 3 tries with exponential backoff (0.5s, 1s, 2s) on network errors, 429 and 5xx. Never on other 4xx errors.
- **Errors** are mapped to `BackendError { kind: 'auth' | 'invalid' | 'conflict' | 'unavailable', message, details }`, which the UI shows as is.
- **Mock** (`mock.ts`): the same interface held in memory. Vitest uses it directly. Playwright runs it as a local HTTP server in the e2e harness.

## 9. Hook points in upstream files
Every hook is a few lines and is listed in `docs/UPSTREAM.md`.

| File | Hook | Slice |
|---|---|---|
| `src/sidepanel/App.tsx` | Pro routes (`recipes`, `editor`, `history`, `crawls`); default view → `recipes` | 2 |
| `src/sidepanel/pages/PageExtractorPage.tsx` | In a recipe session (`pro/edit.takeProEdit`, set by Recipes: build new or edit), load the version and end with Save version (`PageSave`) instead of the run. Without a session it runs as in public | 2 |
| `src/sidepanel/pages/ListExtractorPage.tsx` | Same for lists (`ListSave`); the one-click run is hidden in a session | 2 |
| `src/shared/messages.ts` | `PRO_TEST_PAGE`, `PRO_TEST_PAGES_START/PROGRESS/DONE` | 3 |
| `src/background/index.ts` | Register Pro message handlers (`pro/runner`) | 3 |
| `manifest.json` | `identity` permission | 4 |

## 10. UI
Screens are routes in the side panel, built from the upstream UI kit (`src/sidepanel/ui`) and its tokens.
- **Recipes (home):** a search box, filters (site, label, health), and a row per recipe showing name, site icon, `live vN` / `latest vN` badges, last test, and health. Actions: Open, New from this page, Import.
- **Editor** (`pages/EditorPage.tsx`, built): a page recipe's latest version without the page. Each field: name, type, required, move, remove; its selectors moved, removed or added (page data stays first); cleanup steps (`recipe/ops.ts`, own editor rather than `ColumnCleanDialog`, which needs table values) tried on a typed value. A sticky bar lists the changes (the version diff) and saves the next version. Re-pick on page opens the extractor. List recipes are edited by re-picking. Still to come: flash and test each way on the page, autosave.
- **History:** versions newest first with notes and labels; select two to compare with the diff; Restore; Move label (with a reason).
- **Test panel:** This page / N pages, a grid of fields × pages, and a trace for each cell.
- **Submit dialog:** version, pages, schedule, the gate's reasons, Confirm.
- **Crawls panel:** crawl status, counts, fill per field against the baseline, and sample records.

## 11. Testing
- **Vitest (`src/pro/**/*.test.ts`, with `fake-indexeddb`):**
  - `saveVersion`: numbering, stale base, no change, immutability;
  - digests, including that settings don't change `digest` and a rename changes `outputDigest`;
  - diff cases;
  - format 1 import of both samples, a format 3 round trip, and format 2 still read;
  - `ready.ts` reasons;
  - the backend client against the mock (retry, 401, idempotency).
- **Playwright (`e2e/pro-*.spec.ts`, reusing `e2e/harness.ts` and the local site):**
  - build on `e2e/site/json-product.html` and save v1;
  - edit and save v2, then compare 1↔2;
  - test on this page, then on 3 pages;
  - submit to the mock and see the crawl.
- **Every upstream merge:** the full suite (`docs/UPSTREAM.md`).

## 12. Slice 2 task list
1. `recipe/types.ts`, `recipe/canonical.ts` and their tests.
2. `db/schema.ts`, `db/versions.ts` (`saveVersion`), `db/recipes.ts` and their tests.
3. `recipe/fromPublic.ts`, `recipe/file.ts` (import format 1), with tests on the UNIQLO and ZARA samples.
4. `pages/RecipesPage.tsx` as the home route, plus an import button.
5. The extractor hooks: Save version and load version.
6. `recipe/diff.ts` with tests, then `pages/HistoryPage.tsx`.
7. `pages/EditorPage.tsx`, the fields panel.
8. The e2e flow: build v1 → edit v2 → compare.
