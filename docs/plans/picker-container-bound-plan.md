# CrawlPilot: a container-bound list picker

Branch base: `feat/scraper-toolkit`. This **supersedes** the approach in `picker-list-detection-plan.md` (PK1–PK3:
card-first detection, then a page-wide list). Its fixtures and the hover scorecard idea are kept.

**Why.** The List Extractor used to pick one section: hovering a product showed that section's container with a dashed
outline on each card in it. Two later changes made it page-wide, and on Walmart the result is now wrong and slow:

1. **GS1 item sets** (commit `551793d`) search the **whole document** for the hovered card's fingerprint. They group
   the matches by region, may **switch to a different section** than the one hovered (a sponsored shelf click becomes
   the results), and offer the other sections as alternatives.
2. **The uncommitted rewrite of `findList`** (in the working tree, not committed) finds a card, then climbs up to 12
   levels to the ancestor with the most copies of it. On Walmart that is the whole results column: shelf, results and
   carousel together (53 cards in a 1280×8907 `div`).

A page with several sections doesn't need the picker to understand all of it. **The user picks one section at a time**,
and the List Extractor already keeps several list selectors per extraction (`addSelector`, one `SelectorCard` each). So
the picker should stay inside the section under the cursor.

---

## 1. What goes wrong today

| Symptom | Cause |
|---|---|
| **Walmart:** hovering a result highlights more than the results (the shelf and a carousel joined in), with a count like 53. A click in the sponsored shelf jumps to the results. | Page-wide fingerprint search and region grouping (GS1). The uncommitted rewrite climbs to the column holding every section. |
| **Walmart:** the page stalls while hovering. | Each hover runs page-wide queries: `document.querySelectorAll(fingerprint)` in GS1, and in the rewrite, searches inside every ancestor at up to 40 levels. |
| **BestBuy:** hovering the price shows "4 items" (bits of the price block), not the 18 cards. **Live BestBuy:** a row of 3 cards counts as 1 item. | The old `findList` takes the best tag-count score among ancestors, so a small block inside the card can win. The grid is rendered as one `ul` per row, so the row is a "list of rows". |
| **Maps, Instagram, LinkedIn:** the whole page is highlighted. | The old `findList` accepts any element whose children share a tag (all `div`s on these sites), and the largest such element wins. |
| Dashed outlines sometimes cover price-block fragments or rows, not cards. | They follow whatever was picked as the items. |

---

## 2. The rule: one section, its own cards

**The list is the nearest container around the hovered element whose children are the cards.** Nothing outside that
container is searched, counted or offered.

1. **Start from the old `findList`** (container plus children, as before GS1). That is the behaviour that worked: one
   section, outlines on its cards.
2. **Change how it scores a container. The search space stays the same: the hovered element's ancestors and their
   children.**
   - **Cards, not same-tag children:** a child counts as an item only if it looks like the child holding the hovered
     element (same tag, similar structure and size, the same kinds of content: image, link, text). Spacer `div`s,
     headers and price fragments don't count.
   - **Card-sized items:** items smaller than about 40×16 px (skeleton bits, stars, dots) don't make a list.
   - **Nearest wins:** a container further up replaces a nearer one only if it has clearly more cards (≥ 1.5× and at
     least 2 more). The grid beats a card's own row of price lines; a page wrapper never beats the grid.
   - **Stop at the pane:** the walk doesn't climb past a scrolling pane at least 300 px tall (Maps' results pane) or a
     dialog.
3. **Grids split into rows, inside the container only:** when the container's children are alike row wrappers
   (BestBuy's `ul` per row, Instagram's rows of 3), the items are the rows' children like the hovered card. The
   container stays the grid, the item path is relative to it (`:scope > div > ul > li`), and the outlines are the
   cards.
4. **No page-wide expansion on hover or pick:**
   - GS1's `expandItemSet` no longer searches `document`;
   - there's no sponsored redirect, and no "Also on this page" alternatives;
   - **sections are picked one at a time:** to take the shelf and the results, the user picks each one, getting two
     selector cards.

   The GS1 parts that stay are the in-container ones: placeholders kept as items, and ad cells inside the grid not
   marking it sponsored. A sponsored label on the picked section itself is still shown.
5. **Outlines:** the container gets the solid box and every card a dashed one, as before. The tooltip shows "18 items".

## 3. Speed

- Hover only looks at the hovered element's ancestors (≤ 25 levels) and their children: no `document` queries.
- Per hover: subtree comparisons capped (300 nodes each, about 60 children per container), and element sizes measured
  once and cached.
- The result is cached per hovered element. A hover that runs past 20 ms keeps the best container found so far.
- **Target:** ≤ 10 ms per hover on the Walmart and Amazon captures, checked in the e2e.

---

## 4. Phases

| Phase | What | Done when |
|---|---|---|
| **C0** Reset | Discard the uncommitted `findList` rewrite and the `itemSets` guard edits (back to `HEAD`). Keep the new fixtures (`app-pane.html`, `rows-grid.html`), and keep the hover scorecard rewritten for §2. Delete `e2e/probe.spec.ts`. | `git diff` shows only the kept test files. |
| **C1** Container-bound picking | Remove the page-wide parts of GS1 from hover and click: no document search, no redirect, no alternatives (`ListSelectionStrategy`, `itemSets.ts`). The picked list is the hovered container's own items. | Walmart: hovering a result → the results only (45), and a shelf card → the shelf's own items. BestBuy carousel → the carousel's own items, labelled sponsored. |
| **C2** Better container choice | §2.2 in `findList`: cards not same-tag children, card-sized items, nearest-first with "clearly more", the pane boundary. | BestBuy: title, image, price and card corner all → 18 cards with 18 outlines. Maps-like fixture: the pane's 20 cards, never the page. Amazon: 16. Home Depot: 12. |
| **C3** Rows inside the grid | §2.3: row wrappers inside the chosen container, items through them, relative item path. | BestBuy grid (one `ul` per row) and the rows-of-3 fixture: every card in the grid, one outline each, and stored chains that find exactly them. |
| **C4** Speed | §3: caps, caching, time limit; timing in the debug ladder; e2e assertion. | Every scorecard hover ≤ 10 ms on the captures, with no stall. |
| **C5** Tests that match the intent | Hover scorecard (several points per card) on BestBuy, Walmart (results and shelf separately), Amazon, Home Depot, the Maps-like and rows-of-3 fixtures. `item-sets.spec.ts` rewritten: no redirect; the shelf picks the shelf. The stored-chains test no longer uses the unstyled Walmart capture. The listing scorecard clicks inside the results. A multi-section e2e: pick the results, then add the shelf as a second list, and both read. | The full unit and e2e suites pass. |

## 5. What this changes for the user

- Hover and click pick **the section under the cursor**, with every card in it outlined.
- To take several sections (the results and a sponsored shelf, two carousels), **pick each one**: each becomes its own
  selector card, as before GS1.
- The "Also on this page" chips and the automatic jump from a sponsored shelf to the results go away.
- Saved recipes keep working: their stored container and item chains are read the same way.

## 6. Risks

| Risk | Guard |
|---|---|
| **A grid where every card sits in its own layout cell** (each cell a bare `div` with one tile) | The cell is the card: cells look alike, so they are the items, and the fields come from inside them, as before GS1. |
| **The results split into separate containers** (one per page section) | Pick each one, or pick one and use pagination. Nothing is lost compared with before GS1. |
| **Losing GS1's sponsored redirect,** which helped when the first product on Walmart was in the shelf | The tooltip shows the shelf's own count and label ("Sponsored · 3 items"), so the user sees it isn't the results and hovers lower. |

## 7. Progress

| Phase | Status |
|---|---|
| C0–C5 | Not started. The working tree still holds the uncommitted rewrite (to be discarded in C0) |
