# Recipe improvements for Pro (learned from thenos)

Status: 2026-10-25. Planned.

Thenos is a design reference only: no code, no imports, no shared formats. Each idea below is rebuilt in
Pro's own terms. AI features, Lua scripts and anything for getting past bot checks (stealth, proxies,
captcha) are left out.

## Where CrawlPilot recipes are today
- **Fields:**
  - a chain of up to 3 selectors, where the first that matches wins;
  - an optional binding to JSON-LD or embedded JSON (path, `first`, pairs → object);
  - a few cleanup ops (`stripHtml`, `absoluteUrl`, regex, replace);
  - a `shape` for healing.
- **Clicks** are steps in order.
- **Lists:** container and item chains, plus pagination (next, load more, scroll, URLs).
- **API recipes:** a recorded call and its paging.
- **Contracts:** `contracts/contract.ts`, with typed contract fields and fill floors. These are applied at export, not in the recipe.
- **Versioning:** none worth the name. `rev` is a counter, and the spec hash includes the run settings.

## What thenos does that Pro should have
Each group says what it is, what it looks like in the extension, and which Pro slice it belongs to (see `pro-plan.md`).

### A. Versions you can trust (slice 2)
1. **Locked versions with a digest.**
   - A saved version never changes.
   - Each version stores:
     - `digest`, a hash of the canonical spec;
     - `outputDigest`, a hash of the field names and types only. If it stays the same, the edit did not change the output, so the backend's consumers are safe;
     - `parentDigest`;
     - `origin` (built, edited, imported, repaired);
     - `note`, `author`, `createdAt`.
2. **Labels instead of a status field.**
   - `latest` moves by itself; `live` (what the backend runs) and `test` are moved by a person.
   - Each move is logged with who, when, why, and the previous version.
   - A rollback is moving `live` back to an earlier version. A recipe without `live` is a draft.
3. **The Save version dialog lists what changed** since the base version (fields added, removed or changed; clicks; pagination), with a note box.
   - The draft autosaves.
   - Undo and redo.
   - A save from a stale base (another window saved first) is refused with an offer to reload, never overwritten.
4. **A structured diff between two versions,** covering:
   - fields;
   - each field's selectors, in order;
   - cleanup steps and clicks;
   - whether the output changed.

### B. Stronger fields (slice 2–3)
5. **Typed fields with cleanup built in.**
   - Types: `text`, `number`, `integer`, `money` {amount, currency}, `date`, `url`, `boolean`, `enum`, `list`, `object` (name → value), `table`.
   - Options per field: `required`, `default`, `description`.
   - A detector proposes the type from the sample values, using the existing `transforms/detect` and parsers. When a value can be read two ways (`03/04/2026`, `1,299`), the other reading is one click away.
6. **Fallbacks of different kinds for each field.** The ordered list of ways to find a field mixes:
   - page data (JSON-LD, embedded JSON);
   - a label anchor ("the value next to *Composition*");
   - an id or attribute;
   - structure (CSS/XPath);
   - the URL (part of the path, a query value);
   - a meta tag.

   Each row in the editor:
   - can be shown on the page (flash) and tested: "1 match", "12 matches, expected 1", its value, whether it wins;
   - can be reordered or removed;
   - can be added by typing a selector;
   - is described in plain words ("found by its label").

   **Rule:** a required field needs at least 2 ways, of 2 different kinds, before it can be submitted.
7. **Strength badge.** Each field is marked Strong, Fragile or Broken, with one sentence saying why:
   - built on a hashed class or a position;
   - only one way to find it;
   - no match on a sample page.

   "Make it stronger" adds fallbacks of other kinds and drops ones that are dead. It shows before → after and uses rules only, from the existing `selectors/stability.ts` and the heading/label XPaths.
8. **Checks on values.** These are not empty, pattern, range, one of, unique within a list, compare (sale price ≤ list price), and both ways agree (the page-data value equals the selector value).
   - Each check is either a warning ("suspect") or an error.
   - The backend reports failed checks for each field.
9. **More cleanup ops, each showing before → after for every sample.** New ops:
   - `between`, `split`, `join`, `first`, `last`, `unique`;
   - `toMoney`, `toDate`, `toNumber`, `toCount`;
   - `urlParam`, `largestSrcset`;
   - `map` (value → value);
   - `toObject` ("Name: value" lines), `splitList`.

   The step that broke a value is highlighted. The ops use the existing `ColumnCleanDialog` chips.

### C. Test like the backend will run it (slice 3)
10. **Sample pages on the recipe.**
    - Each recipe keeps a list of sample URLs, and Pro asks for 2 more after the first field.
    - A sample can be marked as a *canary*: the backend checks it on a schedule.
11. **Test grid.**
    - Rows are fields and columns are sample pages, each cell ✓ or ✗, with the value shown on hover.
    - Clicking a failing cell opens that page and that field.
12. **Why is it empty? (trace for each field).** It shows each stage in run order:
    1. revealed (the click worked);
    2. which way won and why the others lost;
    3. the raw value;
    4. the cleaned value;
    5. the checks.

    It reuses the step results `extractPage` already returns (ok, data, healed, empty), with more detail.
13. **Golden records.**
    - On a sample page, the user approves the tested record as the expected output for this version, and the page HTML is saved with it.
    - A later version is checked against these records before submit, field by field ("price changed from 29.90 to empty").
14. **Fill baseline saved with the version.** This is each field's fill share over the samples. The backend compares live crawls against it.
15. **Contract in the recipe, not at export.**
    - Picked fields are mapped to an output contract (the existing `contracts/contract.ts`, with names, types, required fields and floors).
    - Fill below a floor shows in red.
    - A required contract field with no mapping blocks submit.

### D. What the crawler needs from a recipe (slice 4)
16. **Which pages it is for.**
    - Match and exclude rules: host, glob, or regex.
    - Pro suggests the rules from the sample URLs, and each rule is checked against the samples (all of them must match).
    - The backend uses the rules to choose the right recipe for a URL.
17. **What the recipe needs to run:**
    - whether the page needs JavaScript (a test with scripts off shows whether the fields still fill);
    - `paceMs`, the minimum gap between requests to one site;
    - whether a sign-in is needed;
    - locale and region.

    These are the existing page settings, moved out of the spec into the version (see the roadmap in the public repo).
18. **Steps that say what happens when they fail.**
    - A click step gets: `onError` (fail, continue, skip the fields after it), `retry`, a guard ("only if *Composition* is closed"), and `repeatUntil` with a maximum.
    - Pro adds the guard and the wait for the click by itself.
    - Cookie banners and pop-ups found on the page are offered as setup steps.
19. **Lists:**
    - stop rules (no new rows, a repeated page, `maxItems`, a stop condition);
    - `dedupeBy` columns;
    - "Try 3 pages", showing rows per page, duplicates dropped, and why it stopped.
20. **Follow links.**
    - A URL field in a list recipe can name a page recipe (`follow: "zara.com · product details"`), so a crawl goes from the listing to each product page.
    - The public extension's "details for each row" becomes a link between two recipes.
21. **Page layouts.** A recipe can hold versions of a field for different layouts of the same site (for example a sale page). Each layout is detected by a rule (a selector that must be present, or a URL pattern), and a coverage table shows fields × layouts.

### E. Keep recipes working (slice 5)
22. **Health from the backend, per field:**
    - fill %, fallback-used %, failed checks, distinct values;
    - a status over the last 20 runs: healthy, watch, or action needed.

    Blocked or missing pages don't count against a field.
23. **Selector record:**
    - for each way of finding a field, its wins and misses, and whether it is alive or dead;
    - after 30 days with no wins, it is marked dormant and moves to the end.
24. **Repair proposals, approved by a person.** When a field breaks:
    - The backend, or Pro on the failing page, proposes a fix: reorder the ways, re-find the element by its label or neighbours, or add a new way.
    - Pro shows the proposal side by side: "read now" vs "read with the fix", on the samples and on the failing page.
    - Approve (with a reason) saves a `repaired` version and moves `live`. Reject (with a reason) means the same fix is never proposed again.
    - Nothing is applied by itself.
25. **Site change.** When several recipes for one site break at once, Pro shows one notice for the site and holds back fixes until the site settles.
26. **Library:**
    - search by name or site;
    - filters (site, kind, label, health) kept in the panel;
    - a site icon, label badges (`live v7`), health badges, and a preview of the fields on hover.

## Not taken
- **AI:** AI builds and model-based repairs.
- **Scripts:** Lua or JS steps.
- **Getting past bot checks:** stealth tiers, proxies and captcha.
- **Sharing beyond the team:** a marketplace and personal/org/platform registries. Pro has one team library.
- **JMESPath:** the simple paths are kept.

## The recipe file grows
`.crawlpilot.json` becomes a Pro format (`format: 2`) with:
- versions, labels and samples;
- checks, targeting and requirements;
- golden records.

Pro can still import a public recipe spec (`format: 1`, the current samples) and turn it into version 1. The public extension never reads format 2.

## Suggested order inside the Pro slices
1. **Slice 2:**
   - A1–A4 (locked versions, labels, the change list, the diff);
   - B5 types, B6 fallbacks, B7 strength.
2. **Slice 3:**
   - C10–C15: samples, test grid, trace, golden records, baseline, contract;
   - B8 checks, B9 ops.
3. **Slice 4:**
   - D16–D19: targeting, requirements, step failure rules, list stop rules;
   - D20 follow links.
4. **Slice 5:**
   - E22–E26;
   - D21 layouts, once health data shows where layouts differ.
