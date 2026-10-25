# Recipes roadmap: recipes that stand on their own

**Moved to CrawlPilot Pro** (internal repo `crawlpilot-pro`, see its `docs/plans/pro-plan.md`); kept here for reference. What stays public is in `public-scope-plan.md`.

Saved for later (2026-10-24). The first step, recipe improvements inside the Recipes screen only (identity and names, all recipes listed, fields panel, run on other pages, duplicate, delete, export/import, samples), is being built separately; this roadmap covers the larger changes to the Page Extractor, jobs and the recipe model.

## Context
Today a recipe is only ever a side effect of a run.
- **Created only by a run.** `db.jobs.saveRecipe` is called solely from `JobRunner.createJob` and `useExtractionProcess`, immediately followed by a job.
- **Named after its first run.** For example "zara.com · 1 URL", and the name never changes.
- **Can't be opened again.**
  - Its fields can't be edited.
  - It can't be run on other pages: a rerun reuses `job.input.urls`.
  - It can't be deleted except by deleting all its runs.
  - It can't be duplicated, exported or imported.
- **The Page Extractor wizard is memory-only.** Navigating away or closing the panel loses every picked field.
  - Fields get tag names ("span").
  - There is no way to test fields before a full run, and no reordering.
- **Recipe identity is fragile.**
  - Run settings and the viewport size are part of the spec, so the same fields picked in another window size become a new recipe.
  - A page rerun likely forks the recipe, because `pageSpec()` drops `shape` when there is no `value`.
  - The Recipes tab only shows recipes from the newest 100 jobs.
  - The rerun dialog's "parallel" switch does nothing.

The samples we just built (`src/shared/samples/recipes/*.json`) show the gap clearly: there is no way to load them into the extension and run them on your own pages.

**Goal:**
1. Recipes are first-class objects with their own lifecycle: create, save, edit, test, run on any pages, duplicate, share and delete.
2. Jobs are runs of a recipe.
3. The Page Extractor becomes the recipe editor.

## 1. Recipe model: what to extract, apart from how and where it ran
In `src/shared/types/database.ts` and `src/shared/db/schema.ts` (DB_VERSION 8 migration):
- **`Recipe.spec` is extraction only.**
  - Page recipes: elements (fields and clicks, in order).
  - List recipes: lists, pagination, details.
  - No run settings, viewport or URLs.
  - `specHash` covers only this, so the same fields picked anywhere are one recipe.
- **New fields on `Recipe`:**
  - `settings`: the run settings last used (pace, waits, list output, viewport), moved out of `PageSpec.settings`. A change no longer forks the recipe.
  - `pages`: where it runs by default. One of: the URLs list, a saved table's link column, a sitemap filter, or a start page (lists).
  - `site` and `kind`, for grouping and display.
  - `output`: renames, removed, merges, typed and mapping, moved here from `Table.view` so every run shapes data the same way. `carryColumnSetup` is deleted.
  - `deletedAt` is not needed; delete is a real delete (below).
- **Names describe the recipe, not a run.** A recipe gets a name from its site and kind, for example "zara.com · product details" or "uniqlo.com · list", unless the user names it. Jobs keep their own names ("zara.com · 12 pages").
- **Fix the fork on rerun.** `pageSpec()` keeps an element's existing `shape` when there is no `value` (`src/shared/recipes/spec.ts`).
- **Migration:** move `settings` out of page specs, recompute hashes, merge recipes that become identical (re-point their jobs), and backfill `pages` from each recipe's last job.
- **DB API** in `src/shared/db/jobs.ts`, in recipes terms:
  - `saveRecipe(name, spec, extras)`
  - `updateRecipe(id, patch)`: name, settings, pages, output; a spec change bumps `rev`
  - `duplicateRecipe`
  - `deleteRecipe(id, { keepData })`
  - `listRecipes()`: from the recipes store, not from jobs

## 2. The Page Extractor as the recipe editor
In `src/sidepanel/pages/PageExtractorPage.tsx`, its `wizard/*` steps and `useBulkExtraction.ts`:
- **Drafts survive.** The wizard's elements, pages and settings are saved to `chrome.storage.session`, keyed by view, on every change. Opening the Page Extractor restores the draft. "Start over" clears it.
- **Open a recipe to edit it.**
  - "Edit" on a recipe opens the Page Extractor with its elements, pages and settings loaded through a recipe draft (the same pattern as `takeDetailsDraft`/`takePageDataDraft`).
  - A header shows "Editing recipe *name*", and the page opens on the recipe's first page.
  - Saving calls `updateRecipe` (rev+1). "Save as a new recipe" calls `duplicateRecipe` and then saves.
- **Save without running.** A "Save recipe" button on the fields and review steps. Running is a separate action.
- **Test before running.** A "Test on this page" action reads every field on the open page, using the run's own `extractPage` (`src/content/services/page/extractPage.ts`, through `CMD_EXTRACT_PAGE_BACKGROUND` or a new `PAGE_TEST` message).
  - Each field row shows its current value, or "not found", plus the step status (ok, data, healed, empty).
  - The test runs the clicks too.
  - "Test on 3 pages" does a small background run without saving data, using the same runner with a `dryRun` flag that skips saving a table.
- **Order and names.**
  - Fields and clicks can be moved up and down, because a click must come before what it reveals.
  - Default field names come from the field's label or heading, or its page-data key, instead of the tag name (`DetailSelectionStrategy` L107).
- **Cleanup steps on any field.** A field carries `ops: TransformOp[]` (`src/shared/transforms/chain.ts`).
  - Applied in `ElementProcessor` for page fields, as `readBinding` already does for data fields.
  - Edited with the existing `ColumnCleanDialog` chip UI, with a before → after preview from the test.
  - New simple ops:
    - `splitList`: lines or a separator to a list (composition as a list).
    - `toObject`: "Name: value" lines to an object (UNIQLO "- Sheer: Not Sheer…" to `product_specifications`).
  - The existing `regex`/`replace` strip prefixes ("Product ID: ").

## 3. Recipes screen: everything you can do with a recipe
In `src/sidepanel/pages/HistoryPage.tsx`, `components/history/RecipeCard.tsx`, `recipes.ts` and `RerunDialog.tsx`:
- **The list comes from `listRecipes()`**, so all recipes are shown, each with its runs (jobs by the `recipeId` index).
- **Health** also counts page-run `stats.steps` (failing fields) in `healthOf`.
- **Card actions:**
  - **Run:** opens the Run dialog, below.
  - **Edit:** opens the Page or List Extractor (section 2).
  - **Open data**
  - **Duplicate**
  - **Export:** downloads one `.crawlpilot.json`.
  - **Delete:** asks whether to keep or remove its data.
  - **Rename**
  - **Site settings**
- **Run dialog** (replaces `RerunDialog`):
  - **Pages:** "Its pages" (the saved `pages`) or new pages from the same sources as the wizard's step 1. That means this page, paste or upload a list, a saved table's links, or the site's sitemap, reusing `Step1Urls`, `DataSourceSelector` and `SiteDiscoveryDialog`.
  - Run settings, prefilled from `Recipe.settings`.
  - "Only new" for lists.
  - The "parallel" switch that does nothing is removed; concurrency stays.
  - `useJobRerun` takes `(recipe, pages, settings)` instead of `(job, …)`.
- **Import and samples.**
  - "Import recipe" reads a `.crawlpilot.json` file and checks its format version and spec kind.
  - "Start from a sample" lists `src/shared/samples/recipes/*.json` (UNIQLO and ZARA product pages, more to come), each showing its fields, an example record, and "Use this recipe", which imports it and opens Run with its `checked_on` pages.
  - The export format is the sample format: name, site, spec, settings, pages, plus an optional `example`.

## 4. Jobs
- A job shows the recipe it ran (name and revision) and links to it. Job details offer "Edit recipe" and "Run again" (the Run dialog with this job's pages).
- Deleting a job keeps its recipe. Removing a data card deletes only that run's table and job. The recipe is deleted only from the recipe card.
- The run name defaults to "*recipe name* · *N* pages". A name typed in the Run dialog names the run only.
- Data tables use the recipe's `output` setup, so columns look the same across runs.

## 5. Later (separate step, after 1–4)
- **Schedules:** "Run every day/week" on a recipe, using `chrome.alarms` with the recipe's pages and "only new". It needs the browser open, which the UI says plainly.

## Order
1. Model and migration, identity fixes, recipes DB API, `listRecipes` on the Recipes tab. Small and unblocks everything.
2. Run on any pages (Run dialog), delete, duplicate, rename, plus job and recipe links.
3. Page Extractor as editor: drafts, Edit and Save, save without running, reorder, better default names.
4. Test on this page / 3 pages, plus field cleanup ops (`splitList`, `toObject`).
5. Export/import, plus the samples gallery.
6. (Later) schedules.

The List Extractor gets Edit and Save via the same recipe-draft hand-off in step 3: picks and pagination load into `useSelectorManager`.

## Verification
- **Vitest:**
  - Spec hash is unchanged by settings or viewport.
  - A page rerun keeps the same recipe (the `shape` fix).
  - The v7→v8 migration moves settings out, merges duplicates and re-points jobs (fake-indexeddb).
  - `updateRecipe` bumps rev only on spec change. `deleteRecipe` with keepData and without.
  - `splitList` and `toObject` ops. Export → import round trip for both sample recipes.
- **Playwright (`e2e/`):**
  - Pick fields on `e2e/site/json-product.html`, save the recipe without running, leave and come back (the draft is restored), then edit (rename a field, reorder), save, and check rev 2.
  - Test on this page shows values per field.
  - Run the recipe from the Recipes tab on two new pages (pasted list); one recipe with two runs, each with its table.
  - Import a sample recipe; it appears and runs on a local copy page.
  - Delete a run keeps the recipe. Delete the recipe with "remove data" removes its tables.
- Rebuild the UNIQLO and ZARA samples with `scripts/samples/build-recipe.mjs`, using Save instead of a run, then run them from the Recipes tab.
- `npm run build`, `tsc`, knip and CI pass.
