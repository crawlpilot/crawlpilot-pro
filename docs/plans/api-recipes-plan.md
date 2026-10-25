# API recipes: scrape the site's own API instead of the page

Status: 2026-10-19. **Built** (A1–A3).

## What it does

The API Finder already records the JSON calls a page makes and finds the one holding a value the user sees. **Get every page** turns that call into a recipe and runs it in the background:
- the call is sent again **from a tab of the site** (one background tab at the page it was recorded on, opened once per run), so it carries the page's origin, its cookies and the headers the page sent;
- page after page, without rendering any page, until the list runs out;
- rows are saved as each page arrives (the table fills while it runs);
- optionally once per value of one parameter (a search query, a category id), with a column saying which value a row came from.

It is much faster than opening pages, and a redesign of the page doesn't break it.

## How it pages (`shared/network/apiRecipe.ts`)

`guessPaging` looks at the call and its response, in this order:

| Mode | Found by | Next page |
|---|---|---|
| Link | The response has `next`, `links.next`, `_links.next.href`… holding a URL | That URL |
| Cursor | A request parameter like `cursor`, `after`, `pageToken` (query or JSON body), and a new value for it in the response (`endCursor`, `nextCursor`, `continuation`…) | The response's value sent back |
| Offset | `offset`, `start`, `skip`, `from` | Grows by the page size (`limit`, `size`…, else the items on the page) |
| Page number | `page`, `p`, `pageIndex`… | Grows by 1 |
| Page number, left out | The first page's call has no page parameter, but the response counts its pages (`totalPages`…) | `page=1, 2, …` added |
| Cursor, left out | No cursor parameter yet, but the response hands one back | Sent as `cursor` / `after` / `pageToken` |

The user can override it: this page only, or "count up" any numeric parameter.

A recorded cursor is where the user had scrolled to, so a run starts from the beginning (the cursor left out).

**A series ends** when:
- a page has no items, or only items already seen (a site ignoring the parameter sends page one again);
- the cursor or link is missing or repeats;
- the page limit is reached (50 by default, up to 1,000);
- the site refuses a later page (pages read so far stay).

A `429` is waited out (5, 10, 20 s) before giving up. A refusal of the first page fails the series with plain words, for example "The site refused the call (401). Sign in on the site, or record the call again: the token it sent may have expired."

## The run

- **Units** (`unitsFor`): one per input value, each its first page's URL; a value that goes in a JSON body rides in the URL fragment, so a unit is a plain string a re-run can be given again (`unitInput`).
- **`apiJob`** (`background/runs/apiJob.ts`): a `RunJob` of kind `api`. It sends `CMD_API_FETCH` to the content script, which calls `fetch` with `credentials: 'include'`, so the request is the page's own.
- **`JobRunner`** gained:
  - `via`: every unit goes through one tab at that page, opened once and kept to the end, with no page verdicts;
  - `ctx.emit(rows, columns)`: a long unit saves and shows rows before it ends;
  - `rows` in progress messages.
- **Recipe and history:** the spec (`ApiSpec`: request, page, items path, paging, input, page limit) is saved as the run's recipe; History re-runs it (`useJobRerun`).
- **Secrets:** headers such as `authorization` are kept with the recipe on this computer only. The screen says so when the call sends one. The `cookie` header is never stored: the page's own cookies are used at run time.

## Screen

API Finder, step 3, after a response is chosen: **Get every page**:
- the list (from the searched value, else the response's longest list of objects) and its count;
- "How it pages" (the guess, or an override);
- "At most N pages";
- "Run it for a list of values" (a parameter, then one value per line);
- **Start**.

While it runs: rows read, values done, Stop, Open in My data.

## Tests

- `apiRecipe.test.ts`: every paging mode, stop rules, parameters in query and body, units and back.
- `e2e/api.spec.ts`, against a fake shop API in `harness.ts` that needs the page's session cookie:
  - record, search, Start, then 30 rows over 3 pages (first call without `page`);
  - a GraphQL-style cursor in a POST body (25 items);
  - two query values (40 rows, a `q` column);
  - a refused call (401) fails with plain words.

## Later

- **Picking fields:** choose and rename columns from the JSON before running (today: every field, flattened).
- **Scheduled API runs and Sheets sync:** they come with the recipe and table mechanisms already there.
- **Inputs from a dataset column**, as Contacts does.
