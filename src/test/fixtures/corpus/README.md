# Selector corpus pages

Real pages for `src/test/corpus` (the selector corpus, `docs/plans/selector-reliability-plan.md` S0).
Scripts (except JSON-LD and JSON state), styles, stylesheets, iframes and SVG paths are removed; the rest is as
served. Gzipped to keep the repository small.

| File | Source | Captured | Notes |
|---|---|---|---|
| `amazon-search.html.gz` | `https://www.amazon.com/s?k=laptop` | 2026-10-17, Chrome | 27 children of `.s-main-slot`, 16 products; sponsored, video and widget blocks between them |
| `walmart-search.html.gz` | `https://www.walmart.com/search?q=cars` | 2026-10-17, `curl` (desktop Chrome user agent) | 9 server-rendered tiles in `[data-testid="item-stack"]`; the rest of the ~140 items are in `__NEXT_DATA__`. Sale, range and plain price variants |

The synthetic and trimmed pages one level up (`bootstrap-grid.html`, `tailwind-grid.html`, `emotion-hashed.html`,
`walmart-carousel.html`) are part of the corpus too.
