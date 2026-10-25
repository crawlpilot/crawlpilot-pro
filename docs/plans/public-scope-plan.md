# Public scope: what stays in CrawlPilot now that Pro exists

Status: 2026-10-24. Planned.

CrawlPilot Pro (internal repo `crawlpilot-pro`) takes on recipe authoring for the crawler backend:
- editing recipes;
- versions;
- tests before submitting;
- output contracts;
- submitting recipes and maintaining them.

CrawlPilot stays the public tool for collecting data in the browser: pick what you want, run it, export it.
This plan lists what no longer belongs in the public extension and what stays.

## Doesn't make sense in the public extension

| Feature | Where it is | Why not public | Action |
|---|---|---|---|
| Recipe editing: fields panel, rename, reorder, ops on fields | Planned (recipes plan step 3, roadmap §2) | Pro's core feature | Don't build here |
| Recipe versions (`rev`, `reviseRecipe`) as a feature people see | `db/jobs.ts`, RecipeCard | Versioning is for maintaining recipes, which is Pro work | Keep `rev` internal, show no version UI |
| Export/import `.crawlpilot.json` | Planned (recipes plan step 4) | It is the file Pro gives the backend. Public users export data, not recipes | Don't build here |
| Sample recipes' contract material (`fashion-product.schema.json`, each sample's `contract` and `example`, `scripts/samples/`) | Built | They exist to test contracts and backend recipes | Move to Pro; remove here. The ZARA and UNIQLO recipes themselves stay as ready-made recipes (`recipes-run-on-urls-plan.md`) |
| Output contracts and schema mapping (`shared/contracts/contract.ts`, `SchemaMapDialog`) | Built, in the Data table | They map data to an enterprise schema, which is a Pro and backend concern | Move to Pro; remove the Data table entry |
| "Test on N pages" / dry runs | Roadmap §2 | Only needed before submitting | Don't build here |
| Scheduled runs (`chrome.alarms`) | Roadmap §5 | The backend schedules crawls; in the browser a schedule only works while the browser is open | Drop |
| Recipes roadmap as written (recipes as first-class objects, Page Extractor as recipe editor) | `docs/plans/recipes-roadmap-plan.md` | It describes Pro | Mark it as moved to Pro |

## Stays public (unchanged flows)
- Page Extractor, including Smart detection of page data and the Toolkit Extract tab.
- List Extractor.
- Metadata, contacts, images, markdown, summarizer.
- API Finder and "Get every page".
- Data tables and exports (CSV, JSON, Sheets).
- History.
- **Recipes tab, kept simple.** It is the list of what you ran before, plus "Run again" and "Rename", as it is today, with these bug fixes:
  - the page-rerun fork (`pageSpec` keeps `shape`);
  - `specHash` ignores run settings;
  - the list comes from the recipes store, so old recipes aren't missing;
  - health counts page-run steps;
  - the run dialog's "parallel" switch, which does nothing, is removed.
- **Run on other pages** (paste or upload URLs) and the ZARA and UNIQLO ready-made recipes: decided and built in `recipes-run-on-urls-plan.md`.

## Effect on the approved recipes plan
- **Keep:** step 1 (identity fixes; recipe names from site and kind) and step 2 (list every recipe, health).
- **Keep only the bug fix from step 3:** the run dialog's parallel switch. Running on other pages is optional (above).
- **Drop:** the fields panel, duplicate, export, delete with keep/remove data, and step 4 (import, samples gallery). These move to Pro.
  - Delete stays as it is today: removing the runs.

## Removal steps (after Pro's fork is taken, so nothing is lost)
1. Remove `fashion-product.schema.json`, `scripts/samples/`, and their tests. Keep `src/shared/samples/recipes/*.json`: the ready-made recipes import their name, site, spec and pages.
2. Remove `contracts/contract.ts`, `SchemaMapDialog`, and the Data table's schema entry, plus their tests. Check that knip is clean.
3. Point `recipes-roadmap-plan.md` to Pro.
4. `npm run build`, vitest, e2e, knip.
