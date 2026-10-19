# Page assistant (was "Summarize & ask"): a brief and answers you can trust

Status: plan, 2026-10-19. Decided:
- **Name:** "Page assistant".
- **Saved briefs:** one "Briefs" table for every kind of page.
- **Pages:** the current tab only. Comparing tabs (A6) is dropped.

## Today

`TextSummarizerPage` reads the page with Readability. Then:
- the Summarizer API writes a summary, with type (key points / TL;DR / teaser / headline) and length options;
- the Prompt API answers follow-up questions in a chat, with three suggested questions after each answer.

**What's wrong with it:**
- **It's generic.** A product page, a job posting and a news article get the same bullet summary. Chrome's own "Gemini in Chrome" does the same thing, so CrawlPilot adds nothing.
- **Answers can't be checked.** The model may invent a price or a date, and the user can't see where an answer came from.
- **It's a dead end.** An answer is text in a chat bubble. CrawlPilot is a data tool, yet nothing here becomes a table, a saved record or a run.
- **English-centric.** The model reads and writes only en/ja/es/de/fr. A Hindi or Korean page fails or gives a poor summary.
- **Text only.** Charts, infographics, product photos and tables drawn as images are ignored, though the model can read images.
- **One page at a time.** Most decisions (which product, which job, which article to trust) need several pages side by side.

## What Chrome's on-device AI can do

From developer.chrome.com/docs/ai (built-in APIs, Prompt API, Translator API), read 2026-10-19. Everything runs on the device: **the page never leaves the computer**. That is the feature's main promise.

| API | Status in extensions | What we use it for |
|---|---|---|
| **Prompt API** (`LanguageModel`, Gemini Nano) | Stable since Chrome 138 | The brief, answers, tables, comparisons |
| ↳ structured output (`responseConstraint`, a JSON Schema) | Stable | A brief and an answer with citations, as reliable JSON (`modelHost` already compiles schemas) |
| ↳ image input (`{ type: 'image', value }`: `<img>`, canvas, `ImageBitmap`, `Blob`) | Stable (`expectedInputs: image`) | Asking about charts, photos and screenshots |
| ↳ audio input | Stable, needs a GPU | Not in this plan; possibly voice questions later |
| ↳ `clone()`, `append()`, `contextUsage`/`contextWindow`, `QuotaExceededError` | Stable | Warm sessions, attaching an image before the question, staying inside the small context (`modelHost` already does this) |
| **Summarizer API** | Stable since 138 | A fallback when the Prompt API can't run |
| **Translator API** (39 languages, models downloaded per language pair) | Stable since 138 | Reading any-language pages, and answering in the user's language |
| **Language Detector API** | Stable since 138 | Deciding when to translate |
| Writer / Rewriter / Proofreader | Developer trial (behind a flag) | Not used: users can't turn on flags |

**Limits we design around:**
- **Small context window:** thousands of tokens, not a whole long page. `modelHost` measures it; long pages are split into chunks first (`chunking.ts`).
- **One call at a time.**
- **The model's own languages are only en, ja, es, de, fr.**
- **Hardware:** a GPU with more than 4 GB of memory (or 16 GB of RAM and 4 cores), and 22 GB of free disk space.
- **Mistakes:** the model gets things wrong, so every claim has to be checkable.

**"Nano Banana" is not in Chrome.** It is Google's cloud image-generation model (Gemini 2.5 Flash Image). Chrome's built-in model is Gemini Nano, which reads images but doesn't create them. This plan uses only Gemini Nano, so it stays on-device and private.

## The idea

A **page assistant** that knows what kind of page it is on, says what matters for that kind of page, shows where each claim comes from, and turns answers into data:

1. **A brief, not a summary.** It answers the questions people have on that kind of page.
2. **Every claim cites the page.** Click a claim and the page scrolls to the sentence, highlighted. Claims the page doesn't support are marked, never presented as fact.
3. **Answers become data.** "Make it a table", "Save", "Run this on 50 pages" link into CrawlPilot's own tools.
4. **Any language, and images.** Always the current tab.

## The features

### A1. A brief for this kind of page

The kind of page comes from `classifyPageType` (article, forum, product, listing, documentation, …). A job posting is detected from `JobPosting` JSON-LD or its wording, and for "other" the model picks the kind. Each kind has its own brief: a small JSON Schema the model fills, shown as a card.

| Kind | What the brief answers |
|---|---|
| **Article / news** | Gist in one sentence · key points · who / what / when / where · numbers and claims (each cited) · what the article doesn't say or whose view it is |
| **Product** | What it is · price and deals · key specs · what reviewers like and dislike · who it's for / not for · watch-outs (returns, shipping, third-party seller) |
| **Listing / search results** | What's listed and how many · price range · stand-outs (cheapest, best rated, most reviewed) · "Pick these as a list" (into the List Extractor) |
| **Job posting** | Role and level · location, remote or hybrid · pay (if stated) · must-haves vs nice-to-haves · what the job really involves · red flags (vague pay, unrealistic asks) |
| **Documentation** | What it's for · prerequisites · steps · the main code snippet · gotchas and versions |
| **Forum / reviews / Q&A** | The question · the consensus · disagreements · the most useful answer (cited) |
| **Other** | Gist · key points · notable facts |

- **Style:** the user can still switch to a plain summary (the Summarizer's types and lengths), but the brief is the default.
- **Length:** a brief is short, about what fits on one side-panel screen.
- **Long pages:** the brief is built from the chunk summaries the map pass already makes.

### A2. Answers you can check

- **Citations:** the model reads the page as AI Extract's page view, markdown with a `[bN]` label after each block. Every brief point and every chat answer comes back as `{ text, cites: ["b12", …] }` (structured output).
- **The check:** `ground` checks each cited block against what the claim says, as AI Extract checks values (numbers and names must be in the cited text). A claim gets:
  - **✓ on the page:** found in the cited block;
  - **found elsewhere:** found in another block, which is shown instead;
  - **not on the page:** greyed and marked; never presented as fact.
- **Show on page:** clicking a claim scrolls the page to the cited block and highlights it, using the CSS Custom Highlight API so the page's own DOM isn't changed. This is a new content-script message, `AI_SHOW`.
- **The model may say it doesn't know.** The schema has `answerable: boolean`, and "The page doesn't say" is a normal answer, not a failure.
- **Suggested questions per kind.** For example, on a product page: "Is it in stock?", "What do 1-star reviews say?", "What's included in the box?". After each answer, the next three are generated, as today.

### A3. Answers become data

- **"As a table"** on any answer that holds several items (specs, prices, steps, people, dates). The model returns rows and columns (a schema made for the answer), and every cell is checked like a claim.
- **The table can be:**
  - **saved to My data** (`db.tables.save`, source `ai`), next to the user's runs;
  - **copied as CSV or Markdown;**
  - **opened in AI Extract** with the schema filled in, so it can be re-run or turned into selectors (AI Extract already compiles grounded values to selectors).
- **Next steps for each kind of page:**
  - **Listing:** "Extract all N items", which starts the List Extractor with the list picked.
  - **Product:** "Track these fields on many product pages", which starts the Page Extractor with those fields.
- **Save the brief:** the brief card is saved as a record (URL, kind, fields and citations), so briefs of many pages become one dataset.

### A4. Any language

- **Detect:** Language Detector on the page text.
- **Read:** if the language isn't one the model reads (en/ja/es/de/fr), the page's chunks are translated to English with the Translator before the brief. The brief notes "Read from Korean".
- **Answer:** in the user's language, which is the extension's language setting or the browser's.
  - The model writes directly in en/ja/es/de/fr.
  - Any other of the Translator's 39 languages (Hindi, Arabic, Chinese, …) gets the English answer translated, and the citations still point at the original page.
- **Downloads:** each translation model is downloaded once, needs a click (user activation), and shows its progress, like the model download today.

### A5. Ask about what you see (images)

- **Ask about an image:** a picker mode where clicking an image on the page attaches it to the next question. The content script draws it to a canvas, or the extension fetches it as a `Blob` if the page blocks that.
- **Ask about this screen:** `chrome.tabs.captureVisibleTab` takes the visible part of the page as the image. This covers canvas charts, video frames and text drawn as images.
- **What it's for:**
  - "What does this chart show?";
  - "Turn this table image into rows" (then A3: a table, saved);
  - "Does this jacket have a hood?";
  - "Read the ingredients on this label".
- **Model setup:** a session with `expectedInputs: [{ type: 'image' }, { type: 'text' }]`. The image is `append()`ed before the question, so the model starts reading it at once.
- **The check:** answers about an image can't be checked against the page text. They are marked "from the image".

### A6. Compare tabs: dropped

The assistant works on the current tab only (decided 2026-10-19).

### A7. Later

- **What changed:** a saved brief for a URL is compared with today's brief: "Price dropped from $129 to $99", "Two new reviews mention battery".
- **"Does it fit me?":** needs the user saves once in Settings (diet, location, budget, skills). A product, recipe or job brief then ends with a one-line verdict with reasons. These needs stay on the device, like everything else.

## How it looks

```
┌ Page assistant ──────────────────────────────┐
│ Product · walmart.com · read on this device  │
│ ┌ Brief ────────────────────────────────────┐ │
│ │ 24V kids' ATV with music and LED lights   │ │
│ │ $158.89, a flash deal                ✓ ↗  │ │
│ │ Top speed 3 mph · Ages 3–8 · 66 lb max ✓ ↗│ │
│ │ Reviewers like: easy setup ✓ ↗            │ │
│ │ Watch out: sold by a third party ✓ ↗      │ │
│ │ [As a table] [Save] [Track on many pages] │ │
│ └───────────────────────────────────────────┘ │
│ Ask: [Is it in stock?] [What's in the box?]  │
│      [What do 1-star reviews say?]           │
│ ┌─────────────────────────────────────────┐   │
│ │ Ask about this page…             [🖼]   │   │
│ └─────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
```

- **✓** checked on the page.
- **↗** show on the page.
- **🖼** ask about an image or the screen.

## How it's built

- **The model:**
  - **calls:** all go through `modelHost` (warm base sessions, a clone per call, measured prompts, error codes);
  - **images:** need a session created with image input. `modelHost` gets a second set of model options for these, so text calls stay as they are.
- **New services (`src/sidepanel/services/ai/`):**
  - `brief.ts`: the page kinds, a schema and prompt for each kind, and building the brief, from chunk summaries for long pages;
  - `cite.ts`: the citation schema, checking claims through the content script, and the status of each claim;
  - `translate.ts`: Language Detector and Translator, cached per language pair, with download progress;
  - `vision.ts`: an image from the page, or a capture of the visible tab, and the image session.
- **Content script:**
  - `AI_PAGE_VIEW` and `AI_GROUND` are reused;
  - new: `AI_SHOW` (scroll to a block and highlight it with the CSS Custom Highlight API) and `AI_PICK_IMAGE` (the picker in image mode).
- **Side panel:**
  - `TextSummarizerPage` becomes the Page assistant, built from the shared UI kit (`../ui`), not one-off styles;
  - the brief card, citation chips, the image button in the input box, and the table result with its actions.
- **Data:**
  - **tables:** `db.tables.save` with source `ai`;
  - **saved briefs:** one table "Briefs" for every kind of page. Each row has URL, kind, title and gist, plus the kind's fields; a field another kind doesn't have stays empty.

## Progress

**P1, built (2026-10-19):**
- **Kinds and briefs:** `shared/ai/brief.ts` holds the kinds and each one's fields. `detectKind` is right on all 12 saved pages in `src/test/corpus/brief.test.ts`.
- **Checks:** `shared/ai/cite.ts`, run on the page by `content/services/ai-view/claims.ts`.
- **Run:** `sidepanel/services/ai/assistant.ts` briefs up to 3 chunks and merges them.
- **Screen:** `components/summarizer/PageAssistant.tsx`, with "Brief" as the default mode and "Summary" for the old summary.
- **Messages:** `AI_CHECK` and `AI_SHOW`.
- **e2e:** `e2e/assistant.spec.ts`, with a scripted model, covers:
  - the kind chip;
  - points checked, with an invented one marked "not found";
  - clicking a point highlights its quote on the page;
  - each answer citation shows its own sentence's check;
  - an unsupported sentence is flagged;
  - suggested questions.
- **Still to do for P1:** scoring briefs with the real Gemini Nano in Chrome on the saved pages. The target is at least 90% of claims found on the page.

**P2, built (2026-10-19):**
- **Save the brief** to the one "Briefs" table (`saveBrief`). It keeps the points found on the page and the model's readings (marked as such), and leaves out the rest.
- **"As a table" on an answer.** The model makes rows copied from the page, in a clone of the conversation so the table doesn't join it.
  - Each row is checked against the block it cites, and the table says "2 of 3 rows found on the page".
  - The table can be copied as CSV or saved to My data (source `ai-assistant`).
- **Next step for each kind:**
  - a results list → "Extract all items" in the List Extractor;
  - product, article and job → "Get these details as data", which opens AI Extract with that kind's schema filled in (`extractDraft.ts`).
- **e2e:** `e2e/assistant.spec.ts` covers all of these.

**P3, built (2026-10-19):**
- **Detect and read:** Language Detector names the page's language. A page not in English is translated to English line by line, so each `[bN]` stays on its block (`translate.ts`). The brief notes "Read from German".
- **Checks:** claims on a translated page are checked against the translated blocks (`checkedPage`). "Show on page" highlights the original block whole, since its English quote can't be matched in the original.
- **Your language:** with the extension in another language, brief points, answers (markers kept), suggested questions and typed questions are translated. A language pack not yet downloaded shows a "Show in …" button, or for the page's language a download prompt, since a download needs a click.
- **Name:** "Page assistant" in all 9 languages.
- **Tests:** `e2e/assistant.spec.ts` runs a German page with the extension set to French. The download prompt itself can't be e2e-tested, because Playwright's page already counts as clicked.

## Phases

Each phase is committed on its own and can be used by itself.

| Phase | What | Effort |
|---|---|---|
| **P1** | **A1 brief per kind + A2 citations and show on page.** The core: it makes the feature trustworthy and different from Chrome's own. | Large |
| **P2** | **A3 answers become data** (table, save, copy, open in AI Extract / List / Page Extractor) | Medium |
| **P3** | **A4 any language** (detect, translate in, answer in the user's language) | Medium |
| **P4** | **A5 images** (pick an image, capture the screen, image to table) | Medium |
| **P5** | **A7** (what changed, "does it fit me") | Later |

## Testing

- **Unit tests (Vitest):**
  - the page kind from page signals;
  - each kind's schema and how its result turns into a brief card;
  - the claim check (verified / found elsewhere / not on the page) on saved pages: `pdp-walmart`, `article-wikipedia`, `docs-mdn`, `walmart-search`, and a local job page;
  - translation steps, with the Translator mocked.
- **e2e:** Playwright's Chromium has no Gemini Nano, so the tests replace `LanguageModel`, `Translator` and `LanguageDetector` with scripted fakes. They then test:
  - the brief card;
  - citations and show on page, where the page scrolls and the highlight is set;
  - saving a table to My data;
  - image attach.
- **Manual, in real Chrome with Gemini Nano:** the same saved pages plus a few live ones (asking before any live capture). Score each brief:
  - how many of its claims are checked on the page;
  - whether it has the kind's main fields (for example the price on a product page);
  - how long it takes until the brief shows.

  P1 is done when, on the saved pages, at least 90% of the brief's claims are checked on the page and none says "not on the page" when the page does say it.

## Decided

1. **Name:** "Page assistant". The home screen tile and the view title change; the view id stays `text-summarizer`, so links keep working.
2. **Saved briefs:** one "Briefs" table for every kind of page.
3. **Pages:** the current tab only; no comparing tabs.
