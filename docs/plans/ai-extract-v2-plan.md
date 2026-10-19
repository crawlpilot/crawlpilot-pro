# AI Extract v2: JSON Schema in, JSON out, resilient on a small on-device model

Status: A1 and A2b done. Next: A2 (budget and groups). Builds on `ai-extract-markdown-plan.md`, where X0 (model host), M1 (markdown
engine) and X1 (single-page AI Extract) are done; X2 (compile to a recipe) and X3 (many pages) are still open.

## 1. What the user gets

A user gives a schema (fields, a JSON Schema or an example) and gets back **their data from the page,
in their shape, with the proof**. For example:

- **A product page.** They ask for `title, price, brand, materials, dimensions{width,height,depth}, care[]`. They get JSON in exactly that shape.
  - The materials and dimensions sat in closed "Specifications" and "Details" accordions; CrawlPilot opened them before reading.
  - Every value carries its evidence: the markdown of the block it came from (`| Width | 120 cm |`), and a click shows it on the page.
- **A job post.** They ask for `title, company, location, salary{min,max,currency}, requirements[]`. The requirements were under a "Show more" button, which was opened first.
- **A listing page.** They ask for `products[]: {name, price, url, rating}` and get every product on the page, merged across chunks, each with its evidence block.
- **When something can't be found or checked,** the result says so. A guess is never presented as a fact.

What they take away:

- the **JSON** (schema shape, with a `sources` object);
- a **table** (in My data, exportable);
- an **evidence report** in markdown: each value, the page block quoted as markdown, and a link to the page (§3.3).

Each value is easy to trust or correct, because its evidence is right there.

## 1a. Goals

1. **JSON Schema extraction like thenos.** The user's JSON Schema is the contract. The result is JSON in
   exactly that shape (nested objects, arrays, enums, required fields). Every value carries where it came
   from, as a JSON pointer → source.
2. **Markdown-backed.** The model only ever reads the page's markdown: full when it fits, pruned when it
   doesn't, filtered blocks after that, and cut only as a last resort, which the result says. Every value
   points at the markdown block it was read from, and that block is kept as evidence.
3. **Within Gemini Nano's limits.** The model has a small context window (measured per session: a few
   thousand tokens), answers slowly (seconds per call), runs one call at a time, and gets worse as the JSON
   it writes gets longer. Every call is sized to fit, and asks for little.
4. **Resilient.** One failing call never sinks the run. Each failure has a recovery step and is reported
   in plain words. Work done is never thrown away. With no model at all, the flow still returns what the
   page publishes.

## 2. Where it stands

What works today (`sidepanel/services/ai/extractRun.ts`, `shared/ai/*`, `content/services/ai-view/pageView.ts`):

- **Input formats:** lines, an example object, or a JSON Schema. Single answers and top-level lists of
  objects are split as thenos's `split_schema` does.
- **T0:** JSON-LD, microdata and meta tags fill fields with no model.
- **T2 single answers:** one call over the page, or over the BM25-selected blocks when the page overflows,
  plus one retry for required fields.
- **T2 lists:** one call per chunk (at most 6), 20 items per chunk, merged.
- **Grounding:** every model value is checked against the block it cites, then against the whole page.
  Unverified values are never shown as verified.
- **Model handling:** `modelHost` measures each prompt before sending it, relaxes the constraint step by
  step, and maps failures to error codes.

Gaps, against the four goals:

| Goal | Gap today |
|---|---|
| JSON Schema | `schemaIntake` flattens the schema into `SchemaField[]`. **Nested objects become strings**, arrays of strings become one string, **`enum` and `format` are dropped**, and only top-level arrays of objects are lists. The JSON export is flat per list, so it is not the user's shape. There are no per-pointer sources, and no validation of the output against the schema |
| Markdown | The page view is always the **full** markdown (`mode: 'markdown'`); the pruned (`fit`) rendering is never tried. Chunks lose the headings above them, so a chunk starting mid-"Specifications" has no context. The cited blocks aren't kept with the result, so a saved table can't show why a value is what it is |
| Tokens | All missing single fields go in **one call**, however many there are, and long JSON is where a small model fails. Items per list chunk is fixed at 20 whatever the item's width. The list's own region (which the List Extractor can find) isn't used to cut the input. Chars-per-token is sampled on English text, so non-English pages are sized wrong until `too_large` fires |
| Resilience | `model_unavailable` and `session_lost` **throw** and lose the run. `too_large` on a list chunk is a warning, not a retry with a smaller input. There is no cache: a rerun or retry pays for every call again. Results live only in the panel, so closing it loses them. `mergeItems` folds two items that agree on the fields both have filled, which can merge two different products that share only a price |
| No model | Embedded app state (`__NEXT_DATA__`, `__NUXT__`, Apollo) isn't read in T0. Lists without JSON-LD get nothing, though the List Extractor could find them |

## 3. Design

### 3.1 The schema: JSON Schema is the source of truth

Every input form becomes one **normalised JSON Schema**:

- lines (`products[]: title, price`) and example objects compile to it;
- presets are written as JSON Schemas;
- the editor can show the schema behind lines or an example ("Show as JSON Schema").

Normalising keeps what shapes the output:

- `$ref`/`$defs` resolved, to a depth limit;
- `type`, `properties`, `required`, `items`, `enum`, `format` (`date`, `date-time`, `uri`, `email`), `minItems`/`maxItems`, and `description`, cut to about 120 characters.

What it can't support is **reported at intake**, never dropped silently: "`oneOf` of objects: read as the
first option", "recursion below depth 4: read as text".

From the schema, `shared/ai/schemaPlan.ts` builds a **plan**:

- **Leaves:** every scalar the model fills, with its JSON pointer (`/address/city`, `/tags`, `/products/*/price`), type, enum, format, required and description. An array of scalars (`tags: string[]`) is one leaf whose value is a list.
- **The split (as thenos):** each top-level array of objects is an **entity list**; everything else is a **single answer**. Nested arrays of objects inside a list item (a product's `variants[]`) are read as a JSON value within the item, limited to depth 2.
- **Groups:** leaves are packed into model calls (§3.2). Siblings under one parent object stay together, so `address.street` and `address.city` are read side by side.

`shared/ai/assemble.ts` puts the answers back together:

- **Assemble:** leaf answers become JSON in the schema's exact shape. Empty optional fields are left out; empty required fields are `null` with a warning.
- **Validate:** a small validator checks type, enum, required, format and min/maxItems. The result is `ok`, or a list of `{ pointer, problem }`.
- **Sources:** `{ "/address/city": { ref: "b41", status: "verified", tier: "t2", url } }`, as thenos's `show_sources` but down to the block.

The model output for a group stays flat and small: `{ "<leaf key>": { value, ref } }`, with leaf keys
like `address__city`. The model never writes the nested shape itself. Nesting is cheap to rebuild in code
and costly for a small model to get right.

**Enums are mapped, then grounded.** The model copies the page text ("Only 3 left in stock") and the
enum value it maps to (`in_stock`). Grounding checks the copied text; the mapped value is validated
against the enum. A new status, `mapped`, means "the page says X, read as Y".

**The table view** flattens the JSON:
- `address.city` becomes its own column;
- an array of scalars is joined with "; ", with the JSON kept;
- an array of objects inside an item is a JSON cell.

The JSON export is the assembled document, exactly in the schema's shape.

### 3.1a Reveal hidden content before reading

Today the markdown engine reads only what is rendered. That keeps hidden text and hidden prompt
injections away from the model, but it also drops collapsed accordions, inactive tabs and clamped
"Read more" text: on product and job pages, often the very fields asked for. A closed `<details>` is
the one case already kept.

Before the view is built, `content/services/reveal/` opens what the user could open themselves. It works
in two layers, safest first.

**1. Read it without clicking (no side effects).**
- **What counts:** content that is in the DOM but hidden by a **disclosure pattern** tied to a visible control:
  - the panel an `aria-expanded="false"` control points at (`aria-controls`);
  - inactive `role="tabpanel"`s of a `role="tablist"`;
  - `[data-state="closed"]` panels (Radix, shadcn);
  - Bootstrap `.collapse:not(.show)`;
  - `<details>` (exists);
  - text clamped by `line-clamp` or a `max-height` with overflow hidden.
- **How it is read:** these subtrees are composed as if open, each under its control's label ("Specifications").
- **What stays out:** generic `display: none` content with no visible control (still excluded: that is where hidden injections live). The injection filter runs on everything revealed.

**2. Click to open, when the content isn't in the DOM until clicked.** This covers lazy accordions, "Show more", "Read full description" and "See all specs".
- **Candidates**, in the main content only (never `nav`, `header`, `footer` or an overlay):
  - `<summary>`;
  - `[aria-expanded="false"]`;
  - unselected `role="tab"`;
  - buttons whose text reads like an expander ("show more", "read more", "see more", "view all", "more details", "specifications", "expand", in the bundled languages).
- **Never clicked:**
  - a link that navigates (an `href` that isn't `#` or javascript), unless it is `role="button"` with an `aria-controls`;
  - submit buttons, or anything in a form;
  - anything whose text or label matches the deny list: add to cart, buy, checkout, subscribe, sign in, log in, delete, remove, accept, follow, like, share, vote, report;
  - anything that opened a dialog or changed the URL earlier in this reveal.
- **How it clicks:**
  1. Click one candidate, then wait for the DOM to settle (no mutations for 300 ms, at most 1.5 s).
  2. Keep what appeared.
  3. Stop at **20 clicks or 6 seconds**.
  4. If the URL changes or a new tab opens, stop at once and report it.
- **Tabs:** each tab is selected in turn, and its panel is captured right after (only one is visible at a time). Every panel lands in the view under its tab's name.
- **Putting the page back:** the page is restored afterwards. What was opened is closed, and the tab that was selected is selected again, so the user's page looks as it did. A "Leave opened" option skips this.

**What the rest of the pipeline sees.**
- **Refs:** revealed blocks get refs like any other block, so grounding, evidence and highlighting work.
- **Show on page:** for a revealed block, this first re-opens its section (the reveal remembers which control opened it).
- **Evidence:** it records the path, "opened *Specifications* → `| Width | 120 cm |`".
- **Recipes:** compiling to a recipe (X2) adds the same opens as the Page Extractor's click steps, which it already supports, so reruns open them too.

**The report** is shown above the result: "Opened 3 sections (Specifications, Details, Shipping) and read 2
tabs before reading the page." Anything skipped as unsafe is listed under the warnings.

**Shared by every markdown reader.** The reveal runs inside the content script, right before
`toMarkdown`. So it applies the same way to:

- **AI Extract** (`ai-view/pageView.ts`) and the **Page assistant**, on the open page.
- **The metadata extractor** ("Article text & details", `metadata/MetadataExtractionService.ts`):
  - on one page;
  - in **bulk runs**, where `metadataJob` sends `CMD_EXTRACT_METADATA` to a background tab per URL, and the reveal runs in that tab before the article markdown is taken.

In bulk runs:

- **Setting:** a new `MetadataExtractOptions.reveal: 'off' | 'read' | 'open'`, default `'open'`, set in the run's settings ("Open hidden sections before reading").
  - `'read'` only reads disclosure panels already in the page, with no clicks.
  - Reruns keep the setting.
- **Budget:** clicks cost time on every page, so the per-page cap is **10 clicks or 4 seconds**, counted inside the page's load timeout.
- **Restore:** not needed in tabs the run opened itself (they are closed). It still happens when the run reads the user's own tab.
- **Report:** each row records what was opened in a hidden `_revealed` field ("Specifications, Details · 2 tabs"), and the run summary counts pages where sections were opened or clicks were skipped as unsafe.

The markdown engine's own rule doesn't change: what isn't revealed and isn't rendered stays out.

### 3.2 Fitting Gemini Nano: smaller asks, narrower input

All sizes are **measured** with `modelHost.room` / `measureContextUsage`, never guessed. The rules:

1. **Budget per call.** The budget is the session window, minus the system prompt, minus the constraint,
   minus the output reserve. The **output reserve comes from the plan**: per leaf, an estimate by type
   (number 8, enum 6, short text 30, URL 40, plus about 6 for the ref). The input gets what is left.
2. **Few fields per call.** A group holds at most **8 leaves** and at most about 300 output tokens. A
   schema with 20 single fields makes 3 calls. Each call gets its own input chosen for those fields
   (BM25 over the group's names and descriptions), so the model reads more of what matters.
3. **Lists size their chunks to their items.** `itemsPerChunk = floor(outputBudget / itemCost)`, with a
   minimum of 5 and a maximum of 20. The input chunk shrinks as the reserve grows.
   - A wide item (more than 8 leaves) is read in **column passes**: pass 1 gets each item's ref plus its identifying leaves (name, URL, id); pass 2 gets the other leaves for the same chunk, keyed by ref.
   - The passes are joined on the ref.
4. **Narrow the input before the model reads it**, each step failing open as thenos's filters do (an empty result keeps the text it had, with a warning):
   - **List region:** when the List Extractor's detector finds the repeated container, only that container's markdown is read for the list. Navigation, filters and footer are gone before the first call, often a large share of the page on listing pages.
   - **Pruned markdown** (`fit`) when the full markdown doesn't fit (§3.3).
   - **BM25 blocks** for single answers, each block keeping the headings above it.
5. **Measure tokens per page.** Chars-per-token is measured on a sample **of this page's markdown**, not on English filler, so Japanese or German pages are sized right the first time.
6. **Hard caps, always reported.**
   - At most 8 chunks per page, and at most 40 calls per page.
   - Hitting a cap is a `page_truncated` / `call_cap` warning listing which fields or lists it affected. Hitting it is never silent.

### 3.3 Markdown-backed, as thenos

- **Choosing the input text** (thenos `text.py` `page_text_of`), per call:
  1. the full markdown when it fits;
  2. else the `fit` rendering (navigation and page furniture pruned);
  3. else BM25-filtered blocks;
  4. else the first part, with `page_truncated`.

  The page view carries **both renderings** (full and fit), with block refs in both, so moving down the chain costs no new view.
- **Section chunks with context** (thenos `chunk_markdown`, extended):
  - Chunks are built from whole blocks (exists), and a long table repeats its header row (exists).
  - **New:** each chunk starts with its **heading trail** (`# Acme X-200 › ## Specifications`), so a chunk that starts mid-section still knows what it is about.
  - **New, lists only:** chunks **overlap by one block**, so an item cut at a chunk edge is seen whole once. The merge removes the duplicate (§3.4).
- **Block refs stay the backbone.** A ` [bN]` per leaf block ties every value to a live element. That one link drives grounding, highlighting on the page, and compiling to selectors (X2).
- **Evidence is kept.** The cited block's markdown is stored with the result: `_evidence[pointer] = "…| Weight | 1.2 kg | [b41]"`, up to about 300 characters each.
  - The data viewer shows it as "Why this value" on a cell.
  - The JSON view shows it beside each pointer. This is thenos CT4's "evidence per page".
- **Markdown as an output.** A "Page markdown" option saves the page's `fit` markdown in the row (one column), so the text the values came from goes with the data.
- **The evidence report (markdown).** One document per run, downloadable as `.md` and copyable. For each JSON pointer it gives:
  - the value;
  - its status (verified, from page data, mapped, not on page);
  - the evidence block quoted as markdown, with "opened *Specifications*" when it was revealed;
  - a link to the page.

  Values with no evidence are listed at the end, with why. The user can paste it into a ticket, a doc or a review, and anyone can check every value without CrawlPilot.

### 3.4 Resilience: every failure has a next step

**Per call**, a recovery ladder. Each step runs at most once per call, and what happened becomes a
warning code:

| Failure | Recovery |
|---|---|
| `too_large` | Split the input in half (by blocks) and run both halves, up to 2 levels; for a group, also split the fields in half |
| `invalid_output` / `unsatisfiable` | Relax the constraint (exists), then halve the group's fields |
| `schema_unsupported` | Relax (exists); a feature Chrome can't enforce is noted once per run |
| `timeout` | One retry with the input cut to 60% |
| `session_lost` / `model_unavailable` mid-run | Prepare the model again once and continue; if it is still gone, **stop calling and keep what was read**. The run ends `partial`, never thrown away |
| `aborted` | Stop now; results so far are kept and shown |

**Per run**, thenos's rule: partial failure is tolerated. A call that fails is a warning (`chunk_unread`,
`group_unread`). The run fails only if nothing at all could be read. Results return in the shape
`{ data, sources, evidence, warnings, status: 'ok' | 'partial' | 'failed' }`.

**Validate, then repair once.** After assembly, the validator's problems become **one repair call**:
- it covers only the failing leaves (a wrong type, a value not in the enum, a required field left empty);
- its input is the blocks most about those leaves, with the failing value quoted.

What still fails is left as `null` (or the invalid text, marked `invalid`) with a warning. There is no second repair.

**Grounding is the gatekeeper** (exists). It is extended to:
- numbers and dates, grounded on their source text before they are normalised;
- enums, which ground on the copied text (§3.1).

**Merging lists safely.**
- Items are merged across chunks only when they agree on an **identity leaf**: a URL, an id, or a name/title, either one the schema marks or one guessed from the leaf names.
- Without an identity leaf, only exact duplicates are merged.
- This fixes the "two products sharing a price" merge.

**A cache.** Each call's answer is stored, keyed on
`hash(model input text + group plan + instructions + model availability state)`:
- in memory for the session;
- in IndexedDB for a day.

Retrying after a failure, changing one field, or rerunning the same page re-asks only what changed. Sampling is deterministic (`exact`), so a cached answer is the answer.

**Progress survives the panel.**
- Partial results are written to the `jobs` store as each group or chunk finishes. Closing and reopening the panel shows them, with "Continue" to run the rest.
- Running with the panel closed (an offscreen document hosting the model) stays in X3.

### 3.5 Without the model

- **T0 gains embedded state:**
  - Recon already finds `__NEXT_DATA__`, `__NUXT__`, Apollo and `window.__INITIAL_STATE__`. Their JSON is searched for keys matching the leaf names, synonyms and types, and the value's path becomes the source.
  - Many shops render prices and stock from exactly this JSON.
- **Lists from the List Extractor (T1 by name):**
  - With no model and no JSON-LD list, the list region's detected columns are mapped to the list's leaves by name, type and sample values (toolkit §3.8 matching).
  - The result is labelled "matched by name, not read by AI".
- **The screen says what it did.** For example: "No on-device AI on this computer: 6 of 9 fields filled from the page's own data."

### 3.6 Screen changes (AI Extract page)

1. **Schema:** three tabs, *Fields* (lines), *JSON Schema* and *Example*, all compiling to the same schema.
   - Intake problems are listed under the editor, before running.
   - A small summary shows what the run will cost: "9 fields · 1 list · about 4 model calls".
2. **Run:** progress by step ("Reading products: part 3 of 5", "Checking 24 values"), and a Stop that keeps results.
3. **Result:** two tabs, **Table** and **JSON**.
   - Both mark each value: verified, from page data, mapped, found elsewhere, not on page, invalid.
   - Clicking a value highlights it on the page and shows its evidence block.
   - Warnings are listed in plain words, grouped.
   - **Fill the gaps** re-asks only the empty or invalid leaves.
4. **Evidence:** an **Evidence** tab renders the evidence report (§3.3): every value next to the markdown block it came from. It has Copy and Download `.md`.
5. **Revealed:** a line above the result says what was opened before reading, with a "Show what was opened" toggle on the page.
6. **Save:** the table (with `_sources` and `_evidence` hidden from exports by default) and a **JSON** download in the schema's shape, with sources as a sibling `sources` object, as thenos returns them.

## 4. Code layout

```
shared/ai/schemaNormalize.ts   any input → normalised JSON Schema + intake problems   (replaces most of schemaIntake)
shared/ai/schemaPlan.ts        leaves, split, groups, output-cost estimates
shared/ai/assemble.ts          leaf answers → JSON in shape; validator; sources/evidence by pointer
shared/ai/extractPrompt.ts     prompts and constraints per group / list chunk / column pass / repair (extended)
shared/ai/merge.ts             identity-aware list merge (changed)
shared/ai/structured.ts        + embedded app state (T0)
shared/markdown/chunks.ts      + heading trail, + one-block overlap option
content/services/reveal/       read disclosure panels without clicking; safe expander clicks; tabs; restore
content/services/ai-view/      view carries full + fit renderings with refs; list-region view
shared/ai/evidenceReport.ts    the run as a markdown evidence report
sidepanel/services/ai/
  extractRun.ts                orchestration: plan → T0 → groups/chunks with the recovery ladder → validate → repair → ground → assemble
  callCache.ts                 memory + IndexedDB cache of call answers
  budget.ts                    per-call budget from the plan and the measured window
```

## 5. Steps

Each step ships on its own, keeps the e2e suite green and adds its tests.

| Step | What | Done when |
|---|---|---|
| **A1 Schema core** | `schemaNormalize`, `schemaPlan`, `assemble`, validator; lines, example and presets compile to JSON Schema; JSON export in the schema's shape with per-pointer sources | Nested object, array of scalars, enum and required round-trip on 12 unit schemas; the existing intake tests still pass through the new path |
| **A2 Budget and groups** | Output reserve from the plan; leaf groups of ≤ 8; list items per chunk from item cost; column passes for wide items; per-page chars-per-token | With a fake model, a 20-field schema runs as 3 calls each within budget; a 12-leaf list item runs in 2 passes; no call exceeds the measured room |
| **A2b Reveal** | §3.1a: no-click disclosure reading, safe expander with deny list and caps, tab capture, restore, report; wired into every `toMarkdown` caller: AI Extract, Page assistant, and the metadata extractor on one page and in bulk runs (`reveal` option, per-page cap, `_revealed`) | New fixtures for: Bootstrap collapse, ARIA accordion, Radix `data-state`, tabs, a line-clamped description, a lazy "Show more" that fetches its content on click, an "Add to cart" button and a navigating link. Every hidden field is read; the cart button and the link are never clicked; the page is restored (e2e in Chromium). A bulk metadata run over the accordion fixtures returns the revealed text in its markdown, with `reveal: 'off'` it doesn't, and each row's `_revealed` is filled |
| **A3 Markdown input** | Full → fit → BM25 → truncate chooser; heading trail; list overlap; list-region view; evidence stored | On the corpus, single answers read `fit` on every page where full overflows; listing pages read only the list region; every value has evidence |
| **A4 Resilience** | Recovery ladder, partial runs, validate-then-repair, identity-aware merge, call cache, progress saved to `jobs` | A fault-injecting fake model (`too_large`, `invalid_output`, `session_lost` at chosen calls) ends every run `ok` or `partial` with the right warnings and no lost values; a rerun of the same page makes 0 model calls |
| **A5 No-model path** | Embedded state in T0; T1 by name from the List Extractor | On the 4 product pages with the model off, price, title and availability fill from page data; on 2 listings, a list comes back matched by name |
| **A6 Screen** | Schema tabs and intake problems, cost summary, Table / JSON / Evidence results with statuses, the revealed line, Fill the gaps, JSON and `.md` evidence downloads | Kit view and screenshots in light and dark; e2e: JSON Schema in → JSON out in the same shape on a product fixture (with the fake model) |

Then **X2** (compile the run to a recipe that reruns with no model) and **X3** (many pages, panel
closed), as already planned, on top of this.

## 6. Tests

- **Unit:** normalising each input form; plan leaves and groups; assembling and validating (nested,
  arrays, enum, required, format); output-cost estimates; identity merge; heading-trail chunks; cache keys.
- **Fake-model corpus run** (exists, extended): answers from the fixtures' known values. Fault injection
  covers every recovery path, and an assertion checks no call goes over budget.
- **Real-model eval** (manual, Chrome with Gemini Nano, `docs/evals/ai-extract.md`):
  - 4 product pages, 3 listings, 1 article, 1 non-English page.
  - Report per leaf: precision, recall, and unverified shown as verified (must be 0).
  - Report calls and seconds per page, against the current flow.

## 7. Risks and decisions

- **Window sizes differ by Chrome version and device.** Everything is measured, so this costs speed,
  not correctness. The eval records the window seen.
- **Nano and enums.** If mapping to enums proves weak in the eval, fall back to grounding the text and
  mapping it to the enum in code (synonyms, then the closest match), with `mapped` marking the guess.
- **Column passes cost an extra call per chunk.** They are used only for items over 8 leaves; most
  schemas never need them.
- **The cache must not serve a stale page.** The key includes the model's input text, so a changed page
  misses the cache. The day-long IndexedDB entry is a speed-up, never a source of truth.
- **Clicking on someone's page has risks.** The deny list, the caps, the main-content-only rule, the URL-change stop and restore keep it safe. A site whose "expand" button does something else is the case the deny list can't know; the report lists every click, and the user can turn the clicks off ("Read only what's shown").
- **Revealed hidden text is a prompt-injection channel.** Only panels tied to a visible control are revealed, the injection filter runs on them, and grounding still has the final say on every value.
- **Decision for you:** should "Page markdown" be saved with every AI Extract row by default (larger
  tables, full evidence), or only when asked? The plan assumes **only when asked**.

## 8. Progress

| Step | State | Notes |
|---|---|---|
| A1 | **Done** | See the details below |
| A2b | **Done** | See the details below |
| A2, A3–A6 | Open | |

What A1 built:

- **`schemaNormalize.ts`.** Lines, examples and JSON Schemas all become one normalised JSON Schema.
  - Lines now take dotted names (`dimensions.width`) and lists of values (`tags[]: …` with no fields under it).
  - Examples keep nesting, and take list item keys from the first three items.
  - JSON Schemas get `$ref`s resolved, unions made one type, and `enum`/`format` kept.
  - Simplifications are reported as problems, and the AI Extract page shows them under the schema.
- **`schemaPlan.ts`.** Leaves have flat keys, pointers and labels. The schema is split thenos-style, and a root array is one list.
  - The pipeline's `SchemaField` gains `label`, `enum` and `many`.
  - The model is told the allowed enum values, the nesting and how to list several values.
- **`assemble.ts`.** Rebuilds the shape, matches enum spelling, types numbers and splits multiple values. It also validates by pointer (type, enum, required, format, item counts) and keys sources by pointer.
- **The JSON outputs.**
  - `outcomeJson` returns the schema's shape.
  - `outcomeDocument` returns `{ url, data, sources, problems, warnings }`. The page offers "Copy JSON" and "JSON with sources".
- **Table columns** show `size.width`.
- **T0** matches a nested field by its own name too.

Tests: `schemaCore.test.ts` (13) and `extractTables.test.ts` (2). The intake tests now go through the new path, and the fake-model corpus run passes unchanged.

What A2b built (`content/services/reveal/`):

- **`disclosure.ts`, reading with no click.**
  - It reads panels behind a visible control: `aria-controls`, tabs (both directions), labelled regions and Bootstrap collapses.
  - Navigation, header and footer menus stay closed. Hidden text with no control, and empty panels, stay out.
  - `compose` reads the panels as if open. Inside a panel, only what hides itself (`display`, `hidden`) stays out. A tab panel is read under its tab's name.
- **`expand.ts`, clicking.**
  - What it clicks: lazy toggles, lazy tabs (cloned while open, appended through `toMarkdown`'s new `extra` option) and expander buttons ("Show more", "Read full description", "Specifications"…).
  - What it skips: a panel already in the page; anything outside the main content, in a filter sidebar, or in a form; menus (`aria-haspopup`); links to other pages; and action words (cart, buy, sign in, subscribe, accept, delete…). "Load more" is pagination and is never clicked.
  - How it clicks: one click at a time, waiting for the page to settle, up to 3 rounds.
  - When it stops: when the click or time budget runs out, or the URL changes. A dialog that opens is closed with Escape and that control is skipped.
  - Afterwards, `restore` closes the toggles and reselects the original tab.
- **`index.ts`.** `revealForReading('off' | 'read' | 'open', budget)` returns the markdown options, a report (`read`, `opened`, `tabs`, `skipped`, `clicks`, `stopped`) and `restore`. Budgets: 20 clicks / 6 s in the panel, 10 / 4 s per page in bulk.
- **Wired in.**
  - `AI_PAGE_VIEW` (AI Extract and the Page assistant): optional `reveal`, default `open`, and `view.revealed`.
  - `CMD_EXTRACT_METADATA` (one page and every page of a bulk run): `MetadataExtractOptions.reveal` (default `open`) and `result.revealed`, kept as `_revealed` on the row.
  - The "many pages" article step has the "Open hidden sections first" switch.
  - AI Extract shows "Opened before reading: …" and lists the controls it didn't click.
- **Tests:**
  - `reveal.test.ts` (7, jsdom).
  - `e2e/reveal.spec.ts` (3) on `e2e/site/hidden-sections.html`. That page has a Bootstrap collapse, an ARIA accordion, a Radix region, a lazy accordion, an inactive tab, a lazy tab, "Show more", clamped text, an "Add to cart" button, a link away, a filter sidebar, and hidden text with no control.
  - Results: every hidden fact is read; nothing unsafe is clicked; the hidden text stays out; the page is restored; `reveal: 'off'` reads only what is shown.
- **Not done yet:** "Show on page" for a value read from a closed section doesn't re-open the section first. The evidence path ("opened *Specifications*") comes with A3's evidence.
