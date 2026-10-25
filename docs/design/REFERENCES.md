# CrawlPilot Pro: references

The code, docs and outside material that the [HLD](HLD.md) and [LLD](LLD.md) build on. Paths are relative to the
repo root. Code outside `src/pro/` comes from the public repo: read it here, and fix it upstream.

## 1. Pro docs
| Doc | What it holds |
|---|---|
| [docs/plans/pro-plan.md](../plans/pro-plan.md) | What Pro is, its decisions and the five slices |
| [docs/plans/recipe-improvements-plan.md](../plans/recipe-improvements-plan.md) | 26 recipe features (A1–E26), each mapped to a slice |
| [docs/design/HLD.md](HLD.md) | Context, building blocks, flows, decisions, risks |
| [docs/design/LLD.md](LLD.md) | Modules, data model, storage, algorithms, backend client, hook points |
| [docs/UPSTREAM.md](../UPSTREAM.md) | Syncing with the public repo, and the upstream files Pro changes |
| [src/pro/README.md](../../src/pro/README.md) | The rule for where Pro code lives |

## 2. Public code Pro reuses
### Recipe model and identity
| Path | What Pro uses it for |
|---|---|
| `src/shared/types/database.ts` | `PageSpec`, `ListSpec`, `PageElement`, `DataBinding`, `Recipe`: the input to `fromPublic.ts` |
| `src/shared/recipes/spec.ts` | `pageSpec`, `listSpec`, `chainOf` (at most 3 stable selectors), `specJson` (canonical key order, the pattern for `canonical.ts`). Pro's digest replaces `specHash` (D4) |
| `src/shared/recipes/readyMade.ts` | How the public extension loads sample recipes (format 1) |
| `src/shared/samples/recipes/uniqlo-product.json`, `zara-product.json` | Format 1 fixtures, imported as the first Pro recipes |
| `src/shared/samples/fashion-product.schema.json` | The output contract the samples point to |
| `scripts/samples/build-recipe.mjs`, `validate-recipe.mjs` | How the samples were built and checked |
| `src/shared/utils/hash.ts` | The 32-bit hash behind `specHash`, which Pro does not use for digests |

### Reading a page
| Path | What Pro uses it for |
|---|---|
| `src/content/services/page/extractPage.ts` | Runs a page recipe's steps in order; returns the record and a `PageStep` per element. Every Pro test runs through it |
| `src/content/services/page/processors/ElementProcessor.ts` | Reads one element: data binding first, then selectors |
| `src/content/services/page/dataBinding.ts` | Reads JSON-LD, embedded JSON and state for a `DataBinding` (the `data` way) |
| `src/content/services/page/reveal.ts` | Clicks and waits to reveal lazy sections (click steps) |
| `src/shared/pageJson/path.ts` | Paths into page JSON (`offers.price`, `images[*].url`) |
| `src/shared/listing/stepStats.ts` | `StepResult`: the ok, data, healed, empty statuses behind `FieldTrace` |
| `src/content/services/extraction/fields/health.ts` | Checks on a list field and heal by meaning: the model for health and repair (slice 5) |
| `src/shared/extraction/shape.ts` | `Shape`: the kind of value a field holds, which a healed match must keep |

### Selectors
| Path | What Pro uses it for |
|---|---|
| `src/shared/selectors/stability.ts` | `isUnstableClass`, `isHashClass`, `isStableId`, `isVolatileSelector`: the rules behind "fragile" |
| `src/shared/selectors/grade.ts` | `gradeSelector` (Strong, Fragile or Broken, with the reason) and `selectorFamily`: the strength badge and the "2 kinds of way" rule |
| `src/shared/selectors/resolve.ts` | Resolving CSS and XPath ways |

### Cleanup, types and contracts
| Path | What Pro uses it for |
|---|---|
| `src/shared/transforms/chain.ts` | `TransformOp` and `OP_LABELS`, the cleanup ops Pro extends (B9) |
| `src/shared/transforms/detect.ts` | `detectType`: proposes a field's type from sample values (B5) |
| `src/shared/transforms/parsers.ts` | Money, number and date parsers for the typed fields |
| `src/sidepanel/components/ui/ColumnCleanDialog.tsx` | The ops chips UI reused in the fields panel |
| `src/shared/contracts/contract.ts` | `Contract`, `ContractField`, `checkContract`, `ContractReport`: the contract check before submit |

### Running in the background
| Path | What Pro uses it for |
|---|---|
| `src/background/runs/TabPool.ts` | Pooled background tabs used by test on N pages |
| `src/background/runs/bulkJob.ts` | How a page recipe is run over many URLs: the model for `testPages.ts`, which writes no tables |
| `src/background/runs/JobRunner.ts` | Run lifecycle, progress and stop: the model for cancelling a test |
| `src/background/index.ts` | Where message handlers are registered (Pro hook, slice 3) |
| `src/shared/messages.ts` | Typed messages (`send`, `sendToActiveTab`, `on`), `CMD_EXTRACT_PAGE_BACKGROUND`, `SHOW_SELECTION_HIGHLIGHTS`, `TEST_SELECTOR`, `LAB_EVAL` |

### Storage
| Path | What Pro uses it for |
|---|---|
| `src/shared/db/schema.ts` | The style Pro's `db/schema.ts` follows: store table, indexes, versioned upgrades |
| `src/shared/db/idb.ts` | The IndexedDB open and reconnect helper |
| `data_architecture.md` | How the public extension stores tables and rows |

### Side panel and UI
| Path | What Pro uses it for |
|---|---|
| `src/sidepanel/App.tsx` | View routing: Pro adds its routes here (hook) |
| `src/sidepanel/pages/PageExtractorPage.tsx`, `ListExtractorPage.tsx` | Where picking happens: the "Save version" hook |
| `src/sidepanel/components/history/RecipeCard.tsx`, `recipes.ts` | The public Recipes list: the starting point for the Pro library row |
| `src/sidepanel/ui/*` | The UI kit (Button, Card, Dialog, Chip, Segmented, Stepper…) |
| `src/sidepanel/theme/` | Tokens and colour mode |

### Tests and tooling
| Path | What Pro uses it for |
|---|---|
| `e2e/harness.ts` | Playwright fixtures: the built extension, its ID, the local site server, `Panel` |
| `e2e/site/json-product.html` | The local product page for the Pro e2e flow |
| `src/test/setup.ts`, `fake-indexeddb` | Vitest setup for the store tests |
| `.github/workflows/ci.yml` | The CI that Pro keeps (type check, vitest, build, e2e) |
| `DEVELOPMENT.md` | Setup and loading the unpacked extension |

## 3. Public plans worth reading first
| Plan (`docs/plans/`) | Why it matters to Pro |
|---|---|
| `public-scope-plan.md` | What stays out of the public extension: why Pro exists |
| `recipes-roadmap-plan.md` | The public recipe history; settings moving out of the spec |
| `recipes-run-on-urls-plan.md` | Rerunning a recipe on URLs: the basis for `PageSource` |
| `page-extractor-background-plan.md` | Background page runs and step results (P1, P5) |
| `generic-list-selectors-plan.md` | Field checks and heal (§4, §5): the basis for health and repair |
| `selector-reliability-plan.md` | Selector stability rules and grades |
| `structured-columns-plan.md` | Columns that carry their readers: list fields |
| `api-recipes-plan.md` | API recipes: a later Pro kind |

## 4. External references
| Topic | Reference |
|---|---|
| Chrome extension manifest `key` and stable IDs | https://developer.chrome.com/docs/extensions/reference/manifest/key |
| `chrome.identity` and `launchWebAuthFlow` | https://developer.chrome.com/docs/extensions/reference/api/identity |
| Force-installing extensions by policy | https://chromeenterprise.google/policies/#ExtensionInstallForcelist |
| Side panel API | https://developer.chrome.com/docs/extensions/reference/api/sidePanel |
| IndexedDB transactions | https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction |
| Web Crypto `digest` (SHA-256) | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest |
| JSON-LD / schema.org Product | https://schema.org/Product |
| Idempotency keys for POST | https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ |

## 5. Design reference only (no code, no format)
**Thenos** (`../thenos`, a separate local repo). It is the source of the ideas in `recipe-improvements-plan.md`: locked versions with digests, labels, fallbacks of different kinds, strength badges, golden records, health and repair proposals. Pro rebuilds each idea in its own terms. Nothing is imported, ported or exported.
