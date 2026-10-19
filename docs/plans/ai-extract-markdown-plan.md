# CrawlPilot: markdown engine, on-device AI Extract, and what comes next

Branch base: `feat/scraper-toolkit` (selector reliability S0–S7 and database v7 done, not yet tried in Chrome).

Three parts:

1. **Markdown engine (M):** one page → markdown module for the whole extension, ported from
   `thenos/packages/markdown`, running on the live DOM.
2. **AI Extract (X):** thenos's `/v1/extract` rebuilt for Chrome's on-device model. The user gives a schema,
   CrawlPilot fills it from one page or many, shows where each value came from, and where it can, turns the
   result into a recipe that runs with no model.
3. **Other improvements (I):** ordered by value.

Recommended order: **I0 (Chrome E2E) → X0 (model host) → M1 → X1 → X2 → M2 → X3 → the rest of §5.** I0 comes first because the
last eight commits changed every message, store and selector shape, and nothing has run in a real browser yet.

---

## 1. Where things stand

| Area | Today | Problem |
|---|---|---|
| Page → markdown | Two separate paths. `MetadataExtractionService.ts` scores the main block and converts it with turndown + `turndown-plugin-gfm`. `readable-extract.ts` (Summarizer, Chat) runs Readability and returns **plain text**, not markdown | Two main-content rules that disagree. Summarizer and Chat lose headings, lists and tables. Turndown flattens `colspan`/`rowspan`, misses lazy images (`data-src`, `srcset`, `<picture>`), keeps relative URLs, and drops `nav`/`header`/`aside` by tag even when they hold content |
| Page text for the model | `ReferencedView.ts`: one `[eN]` line per visible text element, 12k chars | Good for grounding, but it has no structure (headings, table rows, list nesting), so the model can't tell a spec table from a price box. No chunking: a long page is cut |
| AI schema extraction | `AiSchemaDialog` → `extractSession.ts`: one page, one model call, single values only. Answers are grounded (`isGrounded`) and compiled to selectors (`verifyAndCompile`) | No lists ("all products on this page"), no multi-page runs, no structured-data pre-pass, nested schemas flattened, no per-value sources in the saved table, not a recipe type |
| Schema intake | `shared/ai/schemaIntake.ts`: JSON Schema, an example object, or `name: description` lines → a flat `SchemaField[]` | Flat only: `products: [{title, price}]` can't be expressed |

What thenos does that we want (read for behaviour, not ported line for line):

- `markdown/pipeline.py`: clean → main content (prune, rank) → convert → post-process, with a fallback chain
  from strictest to loosest. The first attempt that yields content wins.
- `content/extract/schema.py`: splits the schema into **entity lists** (arrays of objects, read chunk by
  chunk and merged) and **single answers** (read once over all pages). The split comes from the schema; no
  model call is spent on it.
- `content/extract/text.py`: full markdown when it fits, else the pruned rendering, else truncate **and say so**.
- `content/extract/filters.py`: `none | pruning | bm25 | llm`, and every filter fails open.
- `content/extract/model.py`: page text fenced as untrusted data; structured output; a failure is a warning
  code, never an exception. `run.py`: partial failure tolerated, `sources` per JSON pointer.

---

## 2. M — Markdown engine

### 2.1 Shape

One module, `src/content/services/markdown/`, that runs in the page (content script or injected on demand),
so it can use what thenos only approximates from HTML: computed style, layout and visibility.

```
markdown/
  index.ts        toMarkdown(root, options) → MarkdownResult   (the only entry point)
  clean.ts        hidden/never-content nodes, include/exclude selectors, boilerplate names + force-include,
                  image source resolution (lazy attrs, srcset, <picture>, <noscript>), absolute URLs
  main.ts         main-content choice: semantic (<main>, <article>, [role=main]) → density pruning
                  (pruning.py's five signals) → body; floating (position fixed/sticky) dropped unless it
                  holds the h1; fallback chain as pipeline.py
  injection.ts    drop visible text addressed to a model (injection.py's strong/weak signals)
  convert/        own DOM → markdown converter: text+inline, lists (nesting), tables (spans resolved,
                  header detection, layout tables unwrapped), code (language from class), media, forms
  post.ts         tidy (blank lines, escapes), citations (links → [n] + ## References)
  variants.ts     chunks (structure-aware, a cut table repeats its header), outline, BM25 query filter
  memory.ts       site boilerplate memory for multi-page runs (signatures only, per run, in memory)
```

`MarkdownOptions`: `mode: 'markdown' | 'fit' | 'text'`, `includeLinks`, `includeImages`, `includeTables`,
`citations`, `query?`, `include?/exclude?` selectors, `maxChars?`.
`MarkdownResult`: `markdown`, `title`, `attempt` (which fallback won), `fellBack`, `truncated`, `stats`
(input/output chars, blocks dropped by each stage), `outline`.

### 2.2 Decisions

- **Replace turndown, don't extend it.** Most of the gaps above (spans, lazy images, base URLs, tag-based
  removal) are in its core rules. A DOM walker with one function per block kind is about 600 lines, like
  `thenos_markdown/convert/*`. Remove `turndown`, `turndown-plugin-gfm` and `@types/turndown`.
- **Keep Readability only for article metadata** (byline, excerpt, site name), not as the main-content rule.
  Main content comes from one rule, the same one everywhere.
- **Live DOM advantages:** use `checkVisibility()` / computed style instead of guessing from attributes, and
  read `position` directly for floating chrome. Text the user can't see never reaches the model, which
  also blocks most hidden-text injection.

### 2.3 Who uses it

| Consumer | Today | After |
|---|---|---|
| Metadata Extractor (single + bulk) | own scorer + turndown | `toMarkdown(document, { mode })`; JSON-LD/OG stages stay |
| Summarizer, Chat | Readability plain text | `mode: 'fit'` markdown; the chunker splits on blocks instead of on characters |
| AI Extract (§3) | `ReferencedView` | `fit` markdown with block refs (§3.4) |
| New: "Copy page as markdown" | none | a Toolkit action and a context-menu item; one `.md` per page or JSONL in bulk (covers toolkit §3.11) |

### 2.4 Tests

Run every corpus fixture (`src/test/fixtures/corpus/*.html.gz`: 6 listings, 4 product pages) plus 3 new ones
(an article, a docs page with code and tables, a layout-table page) through it. Pin `report.json`-style golden
output per fixture: title, attempt, block counts by kind, table shapes, that no `nav`/footer text is in `fit`,
and output chars. Unit tests per converter, using thenos's test cases as the source of edge cases.

---

## 3. X — AI Extract (on-device)

### 3.1 What the user does

1. Opens **AI Extract** (a home tile; the Page Extractor's AI dialog becomes an entry into it).
2. Describes the output: a preset, a JSON Schema, an example object, or lines. Nesting is now supported:
   `products[]: title, price, url` or a schema with an array of objects.
3. Optionally adds a prompt ("only in-stock items", "prices in USD").
4. Picks the scope: **this page**, **these URLs** (pasted, or from Site Discovery), or **this list + its
   pagination** (reuses the List Extractor's container and Next button).
5. Gets a table, or a JSON document for single answers. Each value is marked *verified*, *relocated*,
   *from structured data* or *unverified*, and clicking it highlights where it came from.
6. Saves it as a recipe. When every field compiled to selectors (§3.6), reruns use no model.

### 3.2 Pipeline

```
schema ─ split ─┬─ single answers ─┐
                └─ entity lists ───┤
page ─ T0 structured data ─────────┤  (JSON-LD, microdata, OG, embedded state: no model)
     ─ T1 column mapping ──────────┤  (List Extractor's detected columns → schema fields: tiny prompt)
     ─ T2 model over markdown ─────┘  (only for fields T0/T1 left empty)
                                    → ground → normalise → validate → merge → sources → (compile)
```

- **Split** (`shared/ai/schema.ts`, after `schema.py`): top-level arrays of objects are entity lists, the
  rest are single answers. `SchemaField` gets `children?: SchemaField[]` and `list?: true`. Depth limit 2.
- **T0, structured data first.** Read JSON-LD (`Product`, `Offer`, `AggregateRating`, `Article`,
  `JobPosting`, `LocalBusiness`, `BreadcrumbList`, `ItemList`), microdata, OG, and the embedded state that
  Recon already finds (`__NEXT_DATA__`, `__NUXT__`). Match fields by name/type/description synonyms. A hit
  costs nothing and is exact. On product pages this alone often fills title, price, currency, brand, SKU,
  rating and availability.
- **T1, column mapping for lists.** When the scope is a list, the List Extractor's detection (exact on 6/6
  corpus pages) already gives rows and columns. Give the model the column names and 3 sample values each,
  and ask for a `field → column | null` map under `responseConstraint`. One short call, and the result is
  a normal list recipe with renamed columns: deterministic, paginates, needs no model on rerun. Fall back
  to name/type matching (toolkit §3.8) when the model is unavailable.
- **T2, the model reads the page** for whatever is still missing:
  - Single answers: one call over the `fit` markdown (BM25-filtered by the field names and descriptions
    when it overflows), with block refs.
  - Entity lists: the markdown is cut into structure-aware chunks; each chunk is one call
    (`session.clone()` of a session that already holds the system prompt). Items are merged across chunks
    and pages: exact duplicates dropped, items that agree on every field both have filled folded together
    (`merge_entities`).
- **Ground** every value against the block it cites (`isGrounded`, existing), then anywhere on the page
  (*relocated*), else *unverified*. Unverified values are shown but never called verified, and are excluded
  when compiling. Numbers and dates are grounded on their source text before normalisation.
- **Normalise and validate** with the existing `shared/transforms` (money, number, date, rating, URL),
  then check against the schema (type, enum, required). A required field that is empty or invalid triggers
  **one** retry for just those fields, with the failing block quoted. Then stop.

### 3.3 Fitting Gemini Nano

The full rules are in §3.9. In short:

| Constraint | Handling |
|---|---|
| Small context window | Measure, don't guess: `session.contextWindow` minus what `measureContextUsage(prompt, { responseConstraint })` reports, with an answer reserve. Never a fixed 12k, never a chars-per-token constant (§3.9.3) |
| Slow (seconds per call), one model | Calls run one at a time. T0/T1 first so T2 runs only when needed. Progress shows "chunk 3/7 · page 2/20". Hard cap per page (default 6 chunks, the summarizer's `MAX_CHUNKS`); hitting it is a `truncated` warning, never silent |
| Weak at long JSON | Ask for at most ~10 fields per call (split wider schemas into field groups); entity-list chunks ask for at most ~20 items |
| Not every JSON Schema feature is supported | The schema compiler sends a supported subset, checked once at intake (§3.9.4). No unconstrained fallback |
| Not installed / downloading | Existing availability and download-progress UI. T0 and T1-by-name still run, so the screen is useful with no model |
| Page text is untrusted | Fenced as data, a system prompt saying instructions inside are not to be followed, `injection.ts` (§2.1), and grounding: a value the page doesn't contain is never verified |

**Where the model runs.** In a window context, never the service worker. The spec makes the API
unavailable in workers and leaves extension service workers outside its scope (§3.9.1). Single-page work
runs in the side panel. Multi-page runs need a window that outlives the panel; §3.9.1 has the options and
the check to run first.

### 3.4 The view the model reads

`ReferencedView` becomes a thin layer over the markdown engine. Each block the converter writes (a heading,
a paragraph, a list item, a table row) gets a ref and keeps its element:

```
## Specifications            [b12]
| Brand | Acme |             [b13]
| Model | X-200 |            [b14]
- In stock, ships tomorrow   [b15]
```

The model keeps the structure (headings, table rows), and grounding and selector compilation still work
per element. Refs are only issued for blocks inside the budget.

### 3.5 Output and storage

- **Table:** list results become rows (one per entity), single answers one row per page. Columns come from
  the schema with its types (`Column.type` from the field type), so export and typed views work unchanged.
- **Sources:** each row stores `_sources: { [field]: { url, ref?, selector?, tier: 't0'|'t1'|'t2', status } }`
  in `Row.data` under a reserved key. The data viewer shows the status as a cell badge and hides `_sources`
  from exports by default. `rowKey` gets `_sources` added to `NOT_IDENTITY`.
- **Nested values:** an array of objects inside an entity becomes a JSON cell (the data viewer already
  renders JSON). Export as JSON keeps the schema's shape exactly; CSV flattens with `a.b` columns.
- **Single answers across pages:** JSON export returns one object (thenos's "answer over numbered sources").
  Also kept as rows per page so nothing is lost.

### 3.6 Compiling to a recipe

The point of running the model once and then never again:

- **Detail pages:** grounded T2 fields → `elementChain` (existing `verifyAndCompile`), T0 fields → a
  `structured` reader (a JSON-LD path such as `Product.offers.price`). This makes a `PageSpec` with
  `PageElement`s, and the Page Extractor runs it over many URLs.
- **Lists:** T1 is already a `ListSpec`. For T2 lists, ground 2–3 sampled items, find their common item
  ancestor with `listLocators`, and compile each field relative to the item (`elementCandidates` scoped
  to the item). Accept only if the compiled list reproduces ≥80% of the model's items on this page.
- **What can't compile** (a value assembled from several places, or a summarised field) stays a model
  field. The recipe records it: `spec.ai = { schema, prompt, modelFields: string[] }`. A rerun calls the
  model only for those fields, and the job card says "needs on-device AI".
- **Recipe type:** no new spec kind. An AI Extract recipe is a `ListSpec`/`PageSpec` plus optional `ai`
  and `structured` readers. Reruns, history, heal and revisions all work as they do today. `specHash`
  includes `ai`.

### 3.7 Code layout

```
shared/ai/schema.ts            split, nested SchemaField, JSON Schema ⇄ fields, responseConstraint builder
shared/ai/structured.ts        T0: JSON-LD/microdata/OG/embedded-state readers + field matcher
shared/ai/merge.ts             entity merge across chunks/pages, sources
shared/ai/extractPrompt.ts     prompts (single, list chunk, column map, retry), parser (exists, extended)
content/services/ai-view/      block-ref view over the markdown engine; ground + compile (exists, extended)
sidepanel/services/ai/
  modelHost.ts                 one session owner: availability, quota, clone, serial queue, abort
  extractRun.ts                the pipeline for one page; multi-page through JobRunner
sidepanel/pages/AiExtractPage.tsx  + components/ai-extract/*
```

`extractSession.ts` and the Page Extractor's `AiSchemaDialog` become callers of `extractRun.ts`.

### 3.8 Tests

- Unit: split, merge, T0 matcher (fixtures' JSON-LD), prompt/parse round trips, budget math.
- **Model-free corpus run:** a fake model that answers from the fixture's known values (`pdp-targets.json`,
  corpus targets) checks the whole pipeline (grounding, compile, merge, sources, storage) in Vitest.
- **Real-model eval** (manual, in Chrome, `docs/evals/ai-extract.md`): 4 product pages + 3 listings
  + 1 article. Report field precision, recall, unverified-shown-as-verified (must be 0), compile rate and
  seconds per page. Run it before each release.

### 3.9 Model reliability: working within the Prompt API as documented

Sources: [Prompt API](https://developer.chrome.com/docs/ai/prompt-api),
[Prompt API in extensions](https://developer.chrome.com/docs/extensions/ai/prompt-api),
[spec explainer](https://github.com/webmachinelearning/prompt-api/blob/main/README.md),
[structured output](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api),
[session management](https://developer.chrome.com/docs/ai/session-management),
[get started](https://developer.chrome.com/docs/ai/get-started). Read in October 2026. Re-read these before
each phase: the API is still moving, and names were renamed in 2026.

Every model call in the extension (AI Extract, Chat, Summarizer's Prompt fallback, AI columns) goes through
one module, `sidepanel/services/ai/modelHost.ts`. Nothing else touches `LanguageModel`.

#### 3.9.1 Facts the design rests on

| Fact (from the docs) | Consequence |
|---|---|
| The entry point is the global `LanguageModel`. The `"aiLanguageModelOriginTrial"` permission has expired | Use `self.LanguageModel` only. Delete the `chrome.aiOriginTrial` / `window.ai` lookups |
| `inputUsage`/`inputQuota`/`measureInputUsage()`/`onquotaoverflow` were renamed `contextUsage`/`contextWindow`/`measureContextUsage()`/`oncontextoverflow`. The old names are deprecated in extensions and "will be removed" | Use the new names only, with no fallback (the build-pace rule: no legacy fallbacks). Gate on `'contextWindow' in session`. The Summarizer API keeps its own `inputQuota`/`measureInputUsage`; those stay |
| `availability()` must get the **same options** as `create()`/`prompt()` (`expectedInputs`, `expectedOutputs` with `languages`), or it can say `available` for a session that then fails | One `MODEL_OPTIONS` constant, passed to both |
| Text languages: `en`, `ja`, `es`, `de`, `fr` (Chrome 149+). An unsupported one raises `NotSupportedError` | Detect the page language (LanguageDetector, or `<html lang>`). An unsupported page language is still sent as input but labelled "outside the model's languages, expect lower accuracy". Output language is always `en` (the keys are the user's schema anyway) |
| `create()` while `downloadable`/`downloading` needs **user activation**; when `available` it doesn't | Create sessions only from a click handler when not `available`. Background runs check `available` up front and refuse otherwise, with the reason |
| Hardware: >4 GB VRAM GPU, or 16 GB RAM + 4 cores; 22 GB free disk. The model is **removed** if free space drops under 10 GB; `chrome://on-device-internals` shows the state | `availability()` is re-checked at the start of every run, never cached across runs. `unavailable` shows the requirements and the internals page |
| Download failures reject with `NetworkError`; progress is `downloadprogress` with `loaded` 0..1 (`total` always 1; 0 and 1 always fire) | Drop the `{loaded,total}` bytes branch in `progressFraction`. Show the progress and offer a retry on `NetworkError` |
| Not available in workers; extension service workers are outside the spec. Available to top-level windows | Never call the model from `background/`. Multi-page runs use a window context that outlives the panel: (a) an offscreen document, if `LanguageModel` is exposed there, or (b) a pinned extension "runner" tab. **Check (a) in Chrome before X3**: `typeof LanguageModel` and one `availability()` from an offscreen page. Fall back to (b) |
| On overflow the oldest prompt/response pairs are evicted (the system prompt never is) and `contextoverflow` fires. If eviction can't make room, `QuotaExceededError` (`requested`, `contextWindow`) and nothing is evicted. An abort doesn't restore evicted messages | Extraction calls never share history: each runs in a fresh `clone()` of a base session that holds only the system prompt. Overflow can't silently drop instructions or earlier chunks. In Chat, `contextoverflow` shows "older messages were forgotten" |
| `responseConstraint` takes JSON Schema (or a RegExp). The schema **counts against the context** unless `omitResponseConstraintInput: true`, in which case the prompt must describe the format. Unsupported schema features → `NotSupportedError`. Output that can't satisfy the schema → `SyntaxError` | Schema compiler (§3.9.4). Large schemas use `omitResponseConstraintInput` + a short format line. Each error name has its own handling (§3.9.5) |
| Extensions: `temperature` and `topK` must be given **together or not at all**; `LanguageModel.params()` gives defaults and maxima. Negative temperature or `topK < 1` throws; the web-only `samplingMode` doesn't apply | Extraction and column mapping: `{ temperature: 0, topK: 1 }` (deterministic, copy-not-create), with values clamped to `params()`. Chat keeps the defaults. Tune in the eval (§3.8); if a value loops or truncates, raise it there, not per call |
| Sessions cost memory; the model unloads when no session is alive; creating one is slow. `destroy()` aborts pending work | `modelHost` keeps **one** base session warm while an AI screen or run is open, clones it per call, destroys every clone in `finally`, and destroys the base after 2 minutes idle or when the run ends |
| `append()` pre-processes input without generating, and rejects if the input can't fit | Not used for extraction (clones stay single-turn). Chat uses it to seed the document instead of the fake assistant turn in `createChatSession` |

#### 3.9.2 The `modelHost` contract

```ts
modelHost.status(): Promise<ModelStatus>            // availability(MODEL_OPTIONS) + reason + params()
modelHost.prepare(onProgress): Promise<void>        // from a click: create the base session (download if needed)
modelHost.run<T>(call: ModelCall<T>, signal): Promise<CallResult<T>>
interface ModelCall<T> {
  system: 'extract' | 'map' | 'retry' | 'chat';     // picks the base session (one per system prompt)
  prompt: string;
  schema?: object;                                  // compiled (§3.9.4)
  parse(raw: string): T;                            // throws on invalid → counted as invalid_output
  timeoutMs?: number;                               // default 60 s per call
}
type CallResult<T> = { ok: true; value: T; usage: number } | { ok: false; code: CallError; detail?: string };
```

- **Serial queue.** One call runs at a time across the extension. The model shares one device, and parallel
  calls only make each slower. Chat may cut ahead of a background run between calls.
- **A call never throws** (thenos `model.py`'s rule). It returns a code, and the caller decides
  (skip the chunk, warn, stop the run). Codes: `aborted`, `timeout`, `too_large`, `schema_unsupported`,
  `unsatisfiable`, `invalid_output`, `unsupported_language`, `model_unavailable`, `session_lost`, `failed`.
- **Timeouts** use `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])` on `prompt()`. A timeout
  destroys that clone only, and the base session stays.
- **Usage is recorded per call** (`contextUsage` of the clone after the answer) and summed per job
  (`Job.stats.modelTokens`, `modelCalls`, `modelFailures`), so runs can be compared over time.

#### 3.9.3 Fitting the context window

For each call:

1. `available = contextWindow − base.contextUsage` (the system prompt is already in the base).
2. Build the prompt for the planned chunk, then `need = await clone.measureContextUsage(prompt, { responseConstraint })`.
3. `need + answerReserve ≤ available` → send. `answerReserve` = the schema's worst-case output: fields × a
   per-type allowance, × `maxItems` for lists, measured once per schema from a filled sample object.
4. Too big → split the chunk at its middle block boundary and measure again (at most 3 halvings). A single
   block still too big (a giant table) is split between rows with its header repeated (§2.1 `chunks`).
5. Only the first chunk of a page is measured from scratch. Later chunks start from the chars-per-token
   ratio measured on this page and are re-measured before sending, so planning is cheap and sending is exact.

A `QuotaExceededError` despite this (the estimate drifted) is handled once: halve and retry. Then the
chunk is skipped with `too_large`.

#### 3.9.4 Compiling the user's schema for `responseConstraint`

The user's JSON Schema is input, not something to hand to the model as-is:

- Resolve `$ref`/`$defs`. Drop annotations the model doesn't need (`$schema`, `examples`, `title`,
  `format`, `default`) but keep each property's `description` (it's guidance the model reads) unless
  `omitResponseConstraintInput` is on.
- Keep `type`, `properties`, `required`, `items`, `enum`, `additionalProperties: false`, and `maxItems`.
  Every list gets a `maxItems` (default 20 per chunk), because unbounded arrays are how small models run
  away. Map `oneOf`/`anyOf` of primitives to a string plus later normalisation.
- Wrap each leaf as `{ value, ref }` for grounding (as `buildResponseSchema` does today), with `ref` given a
  `pattern: "^(b\\d+)?$"` so it can only be a block ref or empty.
- **Preflight at intake:** run `measureContextUsage('', { responseConstraint })` once. A `NotSupportedError`
  there names the feature. Simplify (drop `pattern`, then `enum`, then flatten depth 2 → 1) and tell the
  user what was relaxed. Schemas never fail mid-run for a reason detectable up front.
- Schemas whose constraint alone uses over 25% of the window switch to `omitResponseConstraintInput: true`
  with a one-line format description plus a filled example object in the prompt.

#### 3.9.5 Errors, by name

| Error (`err.name`) | Meaning (docs) | What `modelHost` does |
|---|---|---|
| `AbortError` | The user stopped, the run was cancelled, or the session was destroyed | `aborted` (or `timeout` if our timer fired). No message to the user |
| `QuotaExceededError` | Input can't fit even after eviction; at `create()`, the initial prompts are too big | Halve and retry once (§3.9.3), else `too_large` |
| `NotSupportedError` | A schema feature, language or modality isn't supported | Schema → `schema_unsupported` (preflight should have caught it). Language → `unsupported_language` |
| `SyntaxError` | Output can't satisfy the schema, or a misplaced `prefix` | `unsatisfiable`. Retry once with the constraint relaxed one step (§3.9.4 order); never retry unconstrained |
| `TypeError` / `RangeError` | Our bug: system message not first, bad constraint, temperature/topK alone or out of range | `failed`, logged with the call. Counted by the corpus test so it can't ship |
| `NetworkError` | The model download failed | `model_unavailable` + a "retry download" action |
| Anything else (not documented, for example the model removed after a disk-space drop) | Unknown, possibly a lost session | Re-check `availability()`. If `available`, recreate the base session and retry the call once (`session_lost`); otherwise `model_unavailable`, and the run pauses |
| JSON that parses but fails our validation | The model filled the shape wrongly | `invalid_output`. The caller may run the one targeted retry (§3.2) |

Two rules on top:

- **Never fall back to an unconstrained prompt.** Today `extractSession.ts` re-prompts without the
  schema on *any* error, timeouts and quota errors included. That turns a clear failure into free text that
  the tolerant parser half-reads. Constrained output exists in every Chrome we support (§6).
- **Retries are bounded:** at most 1 retry per call and 1 targeted retry per required field. A run where
  more than half the calls fail stops with the most common code ("the model kept running out of room: try
  fewer fields") instead of producing a table of blanks.

#### 3.9.6 Runs that stay up

- **Resume:** a multi-page AI run records the last finished page in `RunRecovery` (`shared/storage.ts`).
  On restart it continues from the next page; the model state never needs restoring, because each call
  is self-contained.
- **Pause on model loss:** `model_unavailable` mid-run pauses the job (status `stopped`, reason
  "on-device model unavailable"). Pages already read stay saved, and Resume starts from the next one.
- **Degrade, don't fail:** without the model, T0 (structured data) and name-based column mapping still
  run. The table marks model-only fields "needs on-device AI" rather than leaving them blank.
- **Thermal and battery:** calls are serial, with a short gap after each long one (default 250 ms), so a
  20-page run doesn't hold the GPU at 100%. A run can be paused from the job card.

#### 3.9.7 Fixes to existing code (do in X0)

| Where | Today | Fix |
|---|---|---|
| `promptSession.ts` `getLanguageModel` | `chrome.aiOriginTrial` / `window.ai` first | `self.LanguageModel` only |
| `promptSession.ts` `docCharBudget` | `inputQuota` × 4 chars/token × 0.6 | `contextWindow`/`contextUsage` + `measureContextUsage` (§3.9.3) |
| `promptSession.ts` `getPromptAvailability` | `availability()` without options | `availability(MODEL_OPTIONS)` |
| `promptSession.ts` `progressFraction` | Handles a `{loaded,total}` bytes shape | `e.loaded` only |
| `extractSession.ts` | Fresh `create()` per extraction; catch-all retry without the schema; one 90 s timer for all | `modelHost.run` with a clone, error codes, and a timeout per call |
| `useChatSession.ts` | Seeds the document with a fabricated assistant turn; `QuotaExceededError` handled, `contextoverflow` not | Seed with `append()`; listen for `contextoverflow` and tell the user |
| `useSummaryEngine.ts` Prompt fallback | `LanguageModel.create()` per chunk | Clones of one base session through `modelHost` |
| Sessions in general | Created without `temperature`/`topK` | Extraction pins both (§3.9.1); Chat uses the defaults |
| `manifest.json` | No `minimum_chrome_version` | Set it to the floor chosen in §6 |
| Types | `any` everywhere | `@types/dom-chromium-ai` (named in the structured-output docs) as a dev dependency |

#### 3.9.8 Tests for this

- `modelHost` against a fake `LanguageModel` that can be told to throw each error name, overflow, stall,
  or return schema-violating JSON. Each row of §3.9.5 gets a test, and the queue, clone/destroy and idle
  teardown get their own.
- Budget: the fake reports `measureContextUsage` as chars/3.7. Pages from the corpus never produce a
  `QuotaExceededError` and never send a chunk under 50% of the budget (no needless splitting).
- Schema compiler: the preflight simplification order, `maxItems` defaults, and `$ref` resolution, on
  the presets and on 3 realistic user schemas.

---

## 4. Phases

| Phase | Scope | Done when |
|---|---|---|
| **I0 Chrome E2E** | Playwright + `--load-extension` harness over the local corpus fixtures (served by a static server): list pick → paginate → save, Page Extractor bulk with a click step, rerun of a v5-migrated job | The 4 checks from the v7 report pass in CI-able headless Chrome; any break found is fixed |
| **X0 Model host** | §3.9: `modelHost`, schema compiler, budget by measurement, error codes, existing-code fixes (§3.9.7), Chat/Summarizer moved onto it | Every §3.9.5 row has a passing fake-model test; no file outside `modelHost.ts` names `LanguageModel`; Chat, Summarizer and the AI dialog work in Chrome with the model available, downloading and unavailable |
| **M1 Engine** | §2.1–2.2, Metadata Extractor switched over, turndown removed | Golden output pinned for 13 fixtures; tables with spans and lazy images correct; `fit` holds no nav/footer text on the 10 corpus pages |
| **X1 Single page** | Split + nested intake, T0, T2 for single answers and lists on one page, grounding, sources, table output; `AiSchemaDialog` moved onto it | Fake-model corpus run passes; real eval: ≥90% precision on product fields, 0 unverified shown as verified |
| **X2 Compile + lists** | T1 column mapping, list compile, `ai`/`structured` in specs, rerun without the model | On the 6 listings a retail schema maps via T1 with no required field missing, and paginates with no model call; compiled detail recipes rerun on the 4 PDPs with identical values |
| **M2 Consumers** | Summarizer/Chat on `fit` markdown, block chunking, "Copy as markdown", bulk `.md`/JSONL, citations, BM25 "only about X" | Summarizer output keeps headings and tables; bulk markdown over 20 URLs writes one file each |
| **X3 Many pages** | Offscreen model host, multi-page AI runs in `JobRunner`, boilerplate memory, single-answer-over-sources | 20 product URLs extract with the panel closed; stop/resume works; per-page warnings recorded |

---

## 5. I — Other improvements and features

Ordered by value for someone who scrapes for a living. Open toolkit items are marked (T§).

| # | Item | Why | Size |
|---|---|---|---|
| I0 | **Chrome E2E harness** (above) | Every recent change has only run in jsdom | M |
| I1 | **Fingerprints + heal on miss** (T§3.5, G5) | Store a structural fingerprint per field at pick time; when a chain misses on rerun, relocate by shape and offer the new selector as a revision. Heal for item selectors already exists, so extend it to fields and Next | M |
| I2 | **Shadow DOM + same-origin iframes** (G7) | Picker, resolver and markdown go into open shadow roots, and into frames through `allFrames` on demand. Many retail and widget-heavy pages need it | M |
| I3 | **Portable recipes + code export** (T§3.7, G8) | The v6/v7 typed `spec` makes this cheap: a versioned `.crawlpilot.json` import/export, plus Playwright (TS/Python) and Scrapy code from a spec. Lets users take a recipe out of the extension | S–M |
| I4 | **AI columns in the data table** | "Add column from prompt" ("category", "is this refurbished?", "extract the size"): runs the on-device model per row over that row's cells, serially, with progress; results are typed and cached per row key. Reuses `modelHost` | M |
| I5 | **Translate / detect language for a column** | Chrome's Translator + LanguageDetector APIs, on-device. Cheap and useful for cross-border catalogues | S |
| I6 | **Change monitor** (T§3.10) | Scheduled reruns (`chrome.alarms` is already a permission), diff by row key (already stored), notify on rules ("price dropped"). Needs I0/I1 so scheduled runs don't fail silently | M |
| I7 | **Ask your table** | Natural language → filter/sort/group spec (constrained output) applied to the AG Grid model. The model never sees all rows, only the column list and samples | S |
| I8 | **Image-aware AI** | The Prompt API's image input (where available): read a price or spec printed in an image, check a product photo matches the title. Behind an availability check | S |
| I9 | **Typed fields in review steps** (T§3.4 remainder) | Type detection exists in the data viewer only; show and fix types in List/Page Extractor Step 3 before the run | S |
| I10 | **Session export** (T§3.12) | Playwright `storageState` / cookie header for the current site; optional `cookies` permission through the banner | S |
| I11 | **i18n for new screens** | Lab, Recon, API Finder, AI Extract are English only; the locales exist | S |

Not worth doing now: a cloud LLM option (against the non-goals), proxy or anti-bot features (store policy),
a visual workflow builder (recipes plus reruns cover it).

---

## 6. Open decisions

1. **Where the model runs for background runs** (§3.9.1): the service worker is ruled out by the spec.
   Check offscreen documents in Chrome before X3; otherwise use a pinned runner tab. `modelHost` is
   written to run in any window context, so this only changes who hosts it.
2. **Minimum Chrome version:** the new `contextWindow`/`measureContextUsage` names and the five-language
   models are recent (Chrome 149 per the docs). Recommended: `minimum_chrome_version` for the whole
   extension stays as it is, and the AI screens feature-detect (`'contextWindow' in session`,
   `measureContextUsage`) and show "update Chrome" otherwise. The deterministic extractors keep working
   on older Chrome.
3. **Removing turndown:** recommended (§2.2). The alternative is extending it with ~6 custom rules, which
   still leaves the spans and URL issues.
4. **AI Extract as its own page vs. a mode of the Page/List Extractors:** recommended as its own page that
   *outputs* Page/List recipes, so the extractors stay deterministic and the AI path stays optional.

## 7. Non-goals

- Any server or cloud model. Everything runs on-device; with the model unavailable, T0 and name-based
  mapping still work, and saved recipes never need the model unless a field couldn't compile.
- Showing an ungrounded value as verified.
- Evading bot protection.

## 8. Progress

| Item | State | Notes |
|---|---|---|
| I0 | **Done** | `npm run e2e`: Playwright loads `dist/` (with `<all_urls>` granted) into Chromium. 7 tests: load, list pick on Amazon/Walmart (exact items), 3-page pagination, bulk with a click step, every-page-fails → `failed`, v5 → v7 migration + Runs page. Found and fixed: popup bounds rejected on small screens (every interactive bulk page failed); an all-failed run reported as completed. Not covered: the Connect permission prompt, rerunning a migrated job |
| X0 | **Done** | `modelHost.ts` owns `LanguageModel`: availability with `MODEL_OPTIONS`, activation check, warm base + clone per call, serial queue, measure-before-send, error codes, one recovery on undocumented failures, idle teardown. `shared/ai/constraint.ts` compiles and relaxes schemas. Extraction (preflight + one relaxed retry, no unconstrained fallback), Summarizer fallback (measured chunks, streamed final) and Chat (`append` seed, `contextoverflow` notice, suggestions via `runOn`) moved onto it; `promptSession.ts` deleted. 30 new tests against a fake Prompt API. `samplingMode` used where Chrome exposes it, else `temperature: 0, topK: 1`. Not yet run against the real model: Chromium for Testing has none |
| M1 | **Done** | `content/services/markdown/`: compose (live page → detached copy: rendered only, `currentSrc`, absolute URLs, fixed/sticky marked, open shadow roots with slots) → boilerplate (keeps the block holding the `h1`) → floating + density pruning in `fit` (repeated items under 600 chars kept whole: thenos's pruner dropped product cards) → injection filter (weak signals only in blocks ≤ 500 chars: a product description was a false positive) → own converter → tidy. Metadata Extractor switched; its scorer and turndown removed. Corpus: 12 pages × 2 modes pinned in `src/test/corpus/markdown-report.json` + `markdown/*.md`; new fixtures `article-wikipedia`, `docs-mdn`. E2E checks the live-only behaviour in Chromium |
| M2 | Open | Summarizer/Chat still use `readable-extract.ts` (Readability text) |
| X1, X2, X3 | Open | Single-page, single-value extraction exists (`extractSession.ts`) and is the starting point |
