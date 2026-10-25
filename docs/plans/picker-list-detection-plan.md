# CrawlPilot: the list picker: the nearest container with the most matching cards

Branch base: `feat/scraper-toolkit`, after GS1–GS7 and L2/L5/L6.

**Why.** On app-style pages the List Extractor's hover highlights the whole page instead of the list under the cursor:

- **Google Maps search** (`/maps/search/cars/…`): the user wants the result cards in the left pane, but the highlight
  covers the page.
- **Instagram:** the same happens on profile and explore grids.
- **LinkedIn:** the same happens on feeds and search results.

What the user means is always the same: **the nearest ancestor of the hovered element that holds the most cards like
the hovered one**. This plan rebuilds hover detection around that rule. As before, there are **no site rules**.

---

## 1. Why it happens: the code today

Hover runs `findList` (`content/services/extraction/items.ts`), then `expandItemSet` (`itemSets.ts`, GS1).

| # | Cause | Where | Effect on div-only apps |
|---|---|---|---|
| P1 | **A "list" is any element whose children share one tag** (≥ 60%). Nothing checks that the children look like each other, or like the hovered card. | `homogeneousChildren` | On Maps, Instagram and LinkedIn almost everything is a `div`, so every wrapper passes: the app shell (header, side pane, map, overlays) looks like a list of "items". |
| P2 | **The score is mostly the child count** (`items × 2`), and the best of **all 16 ancestors** wins. No preference for the nearest one. | `listScore`, `findList` | Maps' map layer and app shell have dozens of sibling `div`s (controls, tiles, overlays). That beats the feed's ~20 cards, and the highlight becomes the page. |
| P3 | **Only `role="list"` gets a bonus**; `role="feed"` and `role="grid"` get nothing, and the class words (`list`, `grid`, `card`, `feed`) don't appear in hashed or atomic CSS. | `listScore` | The strongest generic signals on these sites (`role="feed"` on the Maps results pane and on social feeds, an `article` per post) are ignored. |
| P4 | **No region boundary.** The walk doesn't stop at the scrolling pane the cursor is in. | `findList` | Maps' results pane scrolls on its own beside the map. A list never spans that boundary, but the walk climbs past it. |
| P5 | **The item set searches the whole document** for the fingerprint, and the container is the lowest common ancestor of all matches. | `expandItemSet`, `groupByRegion` | If a fingerprint is too broad (an atomic class that passed the utility check, or the bare presence of an identity attribute), matches spread across the page and the highlighted container becomes the page. |
| P6 | **Grids split into rows** (Instagram: rows of 3 posts) make the hovered card's parent a row of 3. The level above has rows as its "items", the wrong unit. | `findList` (one level of children only) | It picks "one row of 3", or "N rows" where each row would be a record. Neither is "every post". |
| P7 | **No way to correct the pick.** The user can't widen or narrow the highlight. | `ListSelectionStrategy.handleHover` | When the guess is wrong there is no recourse except hovering somewhere else. |

P1, P2 and P4 together explain "the full page" on Maps. P5 and P6 are the likely extra causes on Instagram and
LinkedIn. **These are hypotheses until P0 below confirms them on the real pages.** I haven't opened those pages: Maps
renders entirely with JavaScript, and Instagram and LinkedIn need a login.

---

## 2. The rule: the nearest container with the most matching cards

For the hovered element *h*, every ancestor *A* (up to the boundary in §2.3) is a candidate. At each one, take the
**hovered card** *c(A)*: the child of *A* that contains *h*.

### 2.1 Matching cards, not same-tag children

A sibling *s* of *c(A)* **matches** when it looks like the hovered card. Signals, all generic:

- **Structure:** cosine similarity of the subtree tag histograms (`shape`/`similarity` from `itemSets.ts`) ≥ 0.7.
- **Size:** width within ×1.5 of the card's and height within ×2 (cards in one list are about the same size; header,
  map and pane differ by orders of magnitude).
- **Content kind:** the same mix of link / image / text present.
- **Rendered:** a box exists. A placeholder with the card's tag and classes counts as a card still loading (GS1
  `keepItems`).

Spacer `div`s between Maps cards, headers, "Sponsored" labels and section titles don't match, so they aren't items
and don't add to the score.

### 2.2 The score, and the nearest-first rule

At each candidate *A*:

- **cards(A)**: the number of matching cards.
- **coverage(A)**: the matching cards' share of *A*'s rendered children, by area. A wrapper whose children are mostly
  other things (the app shell: header, map, pane) has low coverage.
- **Card-likeness of *c(A)*:** it has text or an image or a link, and is smaller than about 60% of the viewport. A pane
  or a page section is not a card.
- **Signals:**
  - `role="feed|list|grid|listbox|table"` on *A*;
  - `article` / `li` / `role="listitem|article|row"` on the cards;
  - a single shared link pattern (each card links to `/p/…`, `/maps/place/…`, `/in/…`).

**Choice:** walk up from *h*. Keep the first *A* with ≥ 2 matching cards and good coverage as the current best. Move up
to a higher *A′* only if it holds **clearly more matching cards** (≥ 1.5× and at least 2 more), with the same card unit
or a split-grid unit (§2.4). A higher container that adds only non-matching children never wins.

### 2.3 Boundaries: where the walk stops

The walk never goes above:

- **the nearest scrolling ancestor** of *h* that isn't the page (the results pane beside a map, a feed's scroll box,
  a modal's list). L2's `scrollerFor` already finds it;
- **a landmark**, unless nothing below it qualified: `main`, `[role="main"]`, `aside`, `nav`,
  `[role="complementary"]`, `dialog`;
- **a container larger than the viewport in both directions while its cards are much smaller.** That's the page, not
  a list.

### 2.4 Split grids: the unit is the card, not the row

When the hovered card's parent is a row wrapper (3 posts on Instagram), *A* is also scored **one level deeper**. The
candidates are the grandchildren that match *c*, through siblings that are alike wrappers (same tag, same structure).
The grid then holds "12 posts" (rows × 3), not "4 rows". This reuses GS1's region grouping (`groupByRegion`); the
item path becomes `:scope > div > div` (relative, already supported by the item chain).

### 2.5 The item set stays inside the region

`expandItemSet` (GS1) keeps its fingerprint search, now limited:

- **The search is scoped** to the boundary region (§2.3), not `document`. A sponsored shelf or a carousel in the same
  region is still found and offered.
- **A fingerprint whose matches spread far beyond the region** (the lowest common ancestor is the page, or matches
  have unlike shapes) is rejected. The list falls back to §2's cards.
- **The container is the tightest common ancestor of the chosen group's cards**, never `body` or `html`.

---

## 3. Hover experience

- **The tooltip says what will be taken:** "Results · 20 cards". When a bigger or smaller candidate exists, it adds
  "↑ 40 in a larger list" or "↓ 3 in this row".
- **Widen or narrow:**
  - `↑` / `↓` (or `Alt` + scroll wheel) move the highlight along the candidate ladder, and the choice holds while the
    pointer stays inside it;
  - `Esc` resets to the automatic choice.
  - This is the standard fix for "almost right" in visual scrapers, and it costs one keypress instead of a re-hover.
- **Each matching card is outlined** (the siblings outline exists). Non-matching children inside the container (spacers,
  ads, headers) are left un-outlined, so the user sees what will become rows.
- **Fast:**
  - recompute only when the hovered card changes (cache per card), not on every pointer move;
  - cap sibling sampling (60) and subtree scans (300 nodes);
  - throttle to one computation per animation frame.
  - Target ≤ 8 ms per recompute on a 5,000-node page.

---

## 4. Long scrolling lists (Maps, feeds)

- **Container and items are stored relative to the scrolling pane,** so a run finds the same pane on a reloaded page.
- **Runs scroll that pane,** not the window. L2's `scrollerFor` and `MutationAwareScrollStrategy` already do this; to
  verify on Maps, where the results pane loads more as it scrolls and ends with "You've reached the end of the list".
- **Virtualized feeds** (only the visible posts exist in the DOM) are read by content as they appear. L2 already
  dedupes by content, not position. The pick check (L6) shouldn't warn that the list is short because the page shows
  only a window of it.

---

## 5. Phases

| Phase | What | Done when |
|---|---|---|
| **PK0** Evidence and fixtures | (1) A picker debug mode: the candidate ladder per hover, with cards, coverage, signals, boundary and choice, logged and optionally drawn. (2) Synthetic fixtures of the generic layouts: div-only app shell with a map and a scrolling results pane (Maps-like); `role="feed"` cards with spacer divs between them; atomic-CSS classes (`x1lliihq`-style) everywhere; a grid split into rows of 3; a virtualized feed; a page with a header and footer whose sections are all `div`s. (3) The real pages: Maps search, an Instagram profile and explore grid, a LinkedIn feed and people search, saved by you as HTML (like `homedepot.html`) and stripped of personal data. (4) A **picker scorecard** e2e: hover several points per card (title, image, rating, blank padding), then assert the highlighted container, item count and item unit. | The scorecard fails on today's code for the layouts above and passes on the existing corpus (Amazon, Walmart, BestBuy, Home Depot, COS). The causes in §1 are confirmed or corrected on the real pages. |
| **PK1** Matching-card finder | Replace `homogeneousChildren` and `listScore` with §2.1–§2.3: matching cards, coverage, card-likeness, signals, nearest-first with "clearly more" to climb, boundaries. | Maps-like fixture: hover any card → the pane's list with every result card and no spacers. App-shell fixture never highlights the page. Existing corpus picks unchanged. |
| **PK2** Split grids | §2.4: one level deeper through alike row wrappers. | Rows-of-3 fixture and Instagram grid: "12 posts" (every post), item path relative to the grid. |
| **PK3** Region-scoped item sets | §2.5: fingerprint search scoped to the boundary, broad fingerprints rejected, tight container. | Atomic-CSS fixture: the set stays in the region; existing GS1 tests (sponsored shelf redirect, BestBuy ad cells, Walmart) pass. |
| **PK4** Hover UX | §3: the candidate ladder with `↑`/`↓`, `Alt`+wheel and `Esc`; the tooltip with the count and the neighbours; per-card caching and frame throttling. | e2e: `↑` from a row of 3 reaches the grid and `↓` returns; recompute time within budget on the largest fixture. |
| **PK5** Scrolling panes | §4: the run scrolls the pane; checks on Maps and a virtualized feed fixture. | A scroll run on the Maps-like fixture reads every card the pane loads, to its end-of-list marker. |

---

## 6. Risks

| Risk | Guard |
|---|---|
| **Narrowing too much on grids with mixed cards** (ads, a different-sized "featured" card) | The match threshold and size tolerance are tuned on the corpus. A mixed cell keeps the row as one list (GS1 majority rule). The ladder lets the user widen. |
| **Hover cost on huge pages** | Per-card caching, sample caps, frame throttling, and a measured budget in the e2e. |
| **Regressions on pages that work today** | The existing e2e item-set tests, the listing scorecard and the corpus report must stay green on every phase. |
| **Real-page evidence contains personal data** (Instagram, LinkedIn) | Use synthetic fixtures for the tests. Real saves are stripped (names, photos, messages) before they go into the corpus, or kept out of the repository and used only locally. |
| **Sites change markup often** | The rule uses no site names, only structure, size, roles and link patterns, so it keeps working. |

## 7. Open decisions

1. **Real-page captures:** can you save Maps, Instagram and LinkedIn pages as HTML (like `homedepot.html`)? Or should
   I open a browser to capture them? Instagram and LinkedIn need your login, so a saved page from your own browser is
   simpler and safer.
2. **Keys for the ladder:** `↑`/`↓` plus `Alt`+wheel, or `[`/`]`? Arrow keys may scroll the page while the picker is
   active unless captured.
3. **Should the debug overlay ship** behind a setting, so you can report a bad pick with its candidate ladder?

## 8. Progress

| Phase | Status |
|---|---|
| PK0–PK5 | Not started |
