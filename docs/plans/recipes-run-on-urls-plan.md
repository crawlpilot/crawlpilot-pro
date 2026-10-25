# Recipes: ZARA and UNIQLO ready-made, run on the pages you choose

Status: 2026-10-25. Built.

One slice: the Recipes tab gets two ready-made recipes (ZARA and UNIQLO product details), and running any page or list recipe asks which pages to run it on instead of reusing the pages of its last job.

## Context
- **The Recipes tab is built from jobs.** `recipeEntries(jobs)` in `components/history/recipes.ts` groups the newest 100 jobs by recipe. A recipe with no run never shows, which is why the samples in `src/shared/samples/recipes/*.json` can't appear.
- **Run is a rerun of the last job.** `RecipeCard` → `RerunDialog(job)` → `useJobRerun.rerun(job, options)`, which reads `job.input.urls`. There is no way to give it other pages.
- **A page rerun forks the recipe.** `pageSpec()` drops an element's `shape` when it has no `value`. The samples' fields are page-data fields (shape, no value), so running one would save a second recipe instead of a run of the first.
- **The recipe is named by its first run.** `JobRunner.createJob` calls `saveRecipe(job.name || buildInitialName(urls), spec)`. A ready-made recipe has to be saved under its own name before it runs.
- **The rerun dialog's "parallel" switch does nothing.** Concurrency is all that matters.

## Decision against the public/Pro split
`public-scope-plan.md` moves `src/shared/samples/` to Pro and leaves "run on other pages" optional. This plan keeps **ZARA and UNIQLO as ready-made recipes in the public extension** and builds **run on other pages**. Only `name`, `site`, `spec` and `checked_on` ship. `contract`, `example`, `built_with`, the schema file and `scripts/samples/` stay Pro material, as that plan says. Update `public-scope-plan.md` when this lands.

## 1. Fix the fork on rerun
In `src/shared/recipes/spec.ts`, `pageSpec()` keeps an element's existing `shape` when there is no `value`.
- Test: for each ready-made spec, `specHash(pageSpec(...pageRunInput(spec)))` equals `specHash(spec)`.

## 2. Recipes from the recipes store
- `db.jobs.listRecipes()` in `src/shared/db/jobs.ts` returns every recipe (newest `updatedAt` first).
- `recipeEntries(recipes, jobs)` makes one entry per recipe. A recipe with no runs gets `runs: 0`, no `last`, and no health chip; the card says "Not run yet" and hides "Open data".
- `HistoryPage` loads both and passes them in. `RecipeEntry.last` becomes optional; `site` falls back to the recipe's own URL when there is no job (see 3).

## 3. Ready-made recipes
- `src/shared/recipes/readyMade.ts` imports the two JSON files and exports `READY_MADE: { key, name, site, spec, pages }[]` (`pages` = `checked_on`). Nothing else from the files is used.
- The Recipes tab shows a **Ready-made** group above the user's recipes: one card each with the name, site and field count, and **Run**.
- A ready-made card is hidden once a recipe with the same spec hash is in the store: from then on it is one of the user's recipes, with its runs and health.
- **Run** opens the Run dialog (4) with `pages` prefilled. Start calls `db.jobs.saveRecipe(name, spec)` first, so the recipe keeps its name ("ZARA · product details"), then runs. The run's own `saveRecipe` finds it by hash (thanks to 1).

## 4. Run dialog: which pages
`RerunDialog` becomes `RunDialog({ recipe, job?, pages })`, used by recipe cards, data cards and job details.
- **Pages:**
  - Page recipes: a list of URLs, one per line, editable. Prefilled with the last job's URLs, or the ready-made `pages`. "Add this page" adds the open tab; "Upload CSV" adds the first-column URLs. Move the CSV/text parsing out of `page-extractor/wizard/Step1Urls.tsx` into `shared/utils/urls.ts` (`urlsFromText`), used by both.
  - List recipes: one start page (a URL field), prefilled with the last job's first URL. Max pages and "Only new" stay as they are.
  - Contacts and API recipes: unchanged (they keep the job's inputs).
- Start is disabled until there is at least one valid `http(s)` URL.
- The dead "parallel" switch is removed. "Pages at once" (concurrency) shows for page recipes with more than one URL.
- `RerunOptions` gets `urls: string[]` and loses `parallel`.

## 5. Running with the given pages
In `src/sidepanel/hooks/useJobRerun.ts`:
- `rerun(spec, options, job?)`: the URLs come from `options.urls`; `job` is only needed for "Only new" (its table).
- **Page recipes** go straight to `startBulkExtraction(options.urls, …)`. The bulk runner opens its own tabs, so the active tab is no longer navigated to the first URL.
- **List recipes** navigate the active tab to the start page, as today, and run there.

## Out of scope
- Editing a recipe's fields, export/import files, more sites, a ready-made list recipe, schedules.
- Saving a recipe's default pages: the dialog remembers nothing beyond prefilling from the last job.

## Verification
- **Vitest:**
  - The rerun fork: hash unchanged for both ready-made specs (1).
  - `recipeEntries` includes a recipe with no jobs (`runs: 0`) and still groups runs as before.
  - `urlsFromText`: lines, CSV columns, quotes, duplicates, non-http lines dropped.
  - `READY_MADE` specs are page specs whose elements all have a name.
- **Playwright (`e2e/`):**
  - Recipes tab shows ZARA and UNIQLO under Ready-made with no runs in the database.
  - Run a page recipe on two pasted local pages (`e2e/site/json-product.html` and a copy): one recipe, one new job, one table with two rows, and the recipe card now shows one run.
  - Rerun an existing page recipe on a different URL: same recipe, new job with the new URL in `input.urls`.
  - Rerun a list recipe with a different start page.
- `tsc`, knip, vitest and `npm run build` pass.
