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

## Product pages

`pdp-*.html.gz` and `src/test/corpus/pdp-targets.json` (30 annotated targets: titles, prices, spec rows with their
labels, controls) are the product-page corpus captured for thenos's selector work on 2026-10-08:

| File | Page | How |
|---|---|---|
| `pdp-amazon.html.gz` | https://www.amazon.com/Lenovo-Essential-Laptop-Processor-Storage/dp/B0HJCRV1J6/ | browser session (direct downloads got the anti-bot page) |
| `pdp-walmart.html.gz` | https://www.walmart.com/ip/EG-4-BURNER-GRILL/17070020028 | browser session |
| `pdp-uniqlo.html.gz` | https://www.uniqlo.com/in/en/products/E481040-000/00 | Chrome, after scrolling |
| `pdp-zara.html.gz` | https://www.zara.com/in/en/straight-leg-jeans-p00774360.html | Chrome, after scrolling |

The capture tool marked elements with `data-tn-*` attributes; the corpus removes them before measuring, since a live
page has none. Amazon's capture has no buy-box price (the item did not ship to the capture's region).
