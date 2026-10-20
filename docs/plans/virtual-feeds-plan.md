# Virtual lists and feeds: Instagram-class pages

Status: V0–V2 done (2026-10-20, branch `feat/virtual-feeds`); next V3. §8 has the progress. Driving case: Instagram (home feed, profile and explore grids, post pages). The rule
throughout is the usual one: **no site rules**. Everything below is a mechanism for the class of page: lists that
render only the rows near the viewport, built with generated class names, whose data is also in the page's JSON and
API responses.

## 1. What the user gets

- **A profile, explore or hashtag grid:** point at one post, click **Get the data**: every post the page loads as
  you would scroll it (to a limit the user sets), once each, with its link, image, type (photo, carousel, reel),
  caption and date.
- **The home feed:** each post's author, link, caption, date and media, with sponsored and "Suggested for you" blocks
  left out, to a limit (items or minutes), because the feed never ends.
- **Post details:** a list of post links (from the run above) goes to **Same details from many pages**. Each post
  gives caption, date, likes, comments count, media URLs, author. Paced so the account isn't blocked, and a run
  that hits the login wall stops and says so instead of saving empty rows.

## 2. Trace (2026-10-20)

Traced in the e2e browser (logged out: the home feed needs a login, so it rendered blank; the public profile
`instagram.com/natgeo/` was traced live and saved). Script: `scratchpad/ig/zz-ig.spec.ts` (not in the repo).

### 2.1 What the page is

| What | Seen |
|---|---|
| Profile grid | One column `div` with `style="display:flex; flex-direction:column; padding-top:…; padding-bottom:…"`: the windowing wrapper. Its children are rows (`div._ac7v`, 3 posts each); each post is `div.x1lliihq… > a[href="/natgeo/p/{code}/"]`. Logged out: 4 rows, 12 posts, then a login prompt; scrolling loads nothing more |
| Class names | Atomic, generated (`x1i10hfl xjbqb8w x1ejq31n…`): shared by unrelated elements, meaningless as item identity |
| Root id | `#mount_0_0_29`: the number changes on every load |
| Post identity | The link: `/{user}/p/{code}/` or `/{user}/reel/{code}/` (the `code` is the shortcode) |
| Embedded data | A 19 KB `<script type="application/json">` holds all 12 posts at **depth 14** (`…result.data.xig_user_by_username.polaris_ordered_timeline_connection.edges[].node`): `code`, `caption.text`, `display_uri`, `media_type`, `product_type` (clips = reel), `accessibility_caption` ("Video by … on October 15, 2026. May be an image of …"), `user`, plus `page_info.end_cursor` / `has_next_page` |
| More posts | Loaded by GraphQL `fetch` as you scroll, same `edges[].node` shape |
| JSON-LD | None. Open Graph only on profile/post pages |

### 2.2 What CrawlPilot did

| Step | Result |
|---|---|
| List pick on a post image | **One element**, not the grid: `count: 1`, `patternFound: false`, no fields. The container chain is fully positional from `#mount_0_0_29 > div > … > a > div:nth-of-type(1) > div:nth-of-type(1)` |
| Auto-scroll with that pick | **Never finished**: no `AUTO_SCROLL_COMPLETE` in 2 minutes (cause not yet found: V0) |
| Pick on the post link (`a`) | No `ELEMENT_SELECTED` in 20 s (the click may have opened the post; to check in V0) |

### 2.3 Why: the code today

| # | Cause | Where |
|---|---|---|
| R1 | **Queued element references.** The scroll strategy queues the item *elements* it sees, then scrolls to each one and reads it. In a virtual list a queued element is unmounted (read detached, or skipped) or **recycled** to show another post by the time its turn comes: rows are lost, duplicated or read with another post's content. | `MutationAwareScrollStrategy.ts` (`pendingQueue`, `scrollIntoView` per item) |
| R2 | **Dedupe by content fingerprint.** `text[0..200] + first img src + first href`: a post with no text and a CDN URL that changes on re-render (signed `srcset`) counts twice; two posts with the same text and image count once. The run also dedupes on the row's JSON hash, with the same weakness. | `fingerprint()`, `listRun.ts` (`seen`) |
| R3 | **Scroll jumps.** It scrolls by a viewport, and when that doesn't move, to the very bottom. In a virtual list the rows in between are mounted and unmounted without being read. | `triggerScroll`, `scrollToBottom` |
| R4 | **The container is resolved once.** React replaces the wrapper (route change, re-render); the observer watches a detached node and sees nothing, so the run ends early or (with `document.body` as fallback) spins. | `execute()` (`container`, `observeTarget`) |
| R5 | **Unstable chains.** `mount_0_0_29` passes `isStableId` (no 4-digit run, few character-class changes), so a chain starts from it; the rest is `nth-of-type`. The recipe breaks on the next load. | `stability.ts` (`isStableId`) |
| R6 | **Item detection by tag and class.** Atomic classes are shared by everything, and the grid is split into rows, so the picker can't tell the card from its parts. The one reliable item signal, a **link of the same shape** (`/{x}/p/{id}/`), isn't used to find the items. | `items.ts`, `itemSets.ts` |
| R7 | **JSON too deep.** Structured rows search arrays to depth 8; Instagram's are at 14. The `edges[].node` connection shape isn't recognised. | `structuredRows.ts` (`MAX_DEPTH`) |
| R8 | **No API data during runs.** The network hook runs only while the API Finder records, so posts loaded by scrolling never get their JSON (caption in full, date, counts). | `public/net-hook.js`, `apiRecording.ts` |
| R9 | **Endless feeds.** The run ends after 5 scrolls with nothing new; a feed always has something new, so the only end is the user's Stop. | `maxNoChanges` |
| R10 | **Detail pages.** Many post pages in background tabs are rate limited and hit the login wall. The run saves empty rows rather than stopping, and has no pacing per site. | `JobRunner.ts` |

## 3. Design

### 3.1 Items by identity, not by element (R1–R4, R9)

A **harvest** loop replaces the element queue for every auto-scroll (virtual or not):

1. Read **every item mounted now**, in document order, at once. Each one is read immediately: never queued, never
   read after a scroll.
2. Key each row by its **identity**:
   - the item's main link (pathname, without query and hash);
   - else a stable id attribute (`data-id`, `data-item-id`…);
   - else the row's values without image URLs.

   Skip keys already read. This replaces both fingerprints.
3. Scroll by **0.8 of the scroller's height** (never to the bottom), wait for new items or a settle, repeat.
4. Before each step, check the container is still connected. If not, **resolve it again** from its chain and items.
5. **End** when:
   - there are no new keys for N steps **and** the scroller is at its end;
   - or a limit is hit: max items, max minutes (defaults in §5);
   - or Stop is pressed.

   A list whose wrapper keeps `padding-bottom > 0` is not at its end.

Detection of a virtual list (logged in the run report, used to raise N): items unmount while scrolling, or the
wrapper's padding/height changes while its child count stays flat.

### 3.2 Picking the items (R5, R6)

- **Link-shape items.** When the hovered element is inside (or is) a link whose path has the shape of its siblings'
  links (`/{seg}/p/{id}/`: same segments, one varying id-like segment), the items are the nearest ancestors of those
  links that hold exactly one of them. Row wrappers are walked through (the existing split-grid rule). Works on
  atomic-class sites, split grids and virtual lists.
- **Item selector:** the link shape as an attribute selector (`a[href*="/p/"]`, `a[href*="/reel/"]`), scoped to the
  container; the item is reached from the link (`:has()` chain or "closest ancestor with one link").
- **Ids with counter tails** (`mount_0_0_29`, `root_12`, `:r3:`) are not stable: `isStableId` rejects
  `name(_\d+){2,}` and short numeric tails on generated-looking prefixes. Chains start at the nearest landmark
  (`main`, `section`, `[role]`), never at a positional path from `body`.

### 3.3 Data from the page's JSON and its API (R7, R8)

- **Any depth, by shape.** Structured rows search arrays at any depth within a node budget (not a depth limit), and
  unwrap the connection shape `{edges: [{node}]}` and `{items: […]}`.
- **Anchor by the link's id.** The item's link id (`DehZj9wggt0`) is matched against the JSON items' id-like
  fields (`code`, `shortcode`, `id`, `pk`): the existing `anchorKind: 'id'`.
- **API capture during a list run.** The run starts the network hook in its tab (MAIN world, the same ring buffer)
  and stops it at the end. Posts loaded by scrolling are matched to their GraphQL items like the embedded ones. The
  data stays in the tab, as with the API Finder.
- **Fields:**
  - caption (full text: no "… more" click);
  - date (`taken_at`, epoch → ISO);
  - media type;
  - image / video URL;
  - counts (likes, comments, views) when the response has them;
  - the alt text (`accessibility_caption`) when the image has nothing else.

### 3.4 The home feed

- Items are `article`s (or link-shape posts). Rows whose label or first line is "Sponsored", "Suggested for you" or
  "Suggested posts" are left out: a generic **promoted / suggested** filter read from accessible text, in the
  page's language through the i18n strings. Reported as "N promoted items left out".
- **Limits** are offered up front for endless feeds: "Stop after 200 posts / 10 minutes".

### 3.5 Details from post pages (R10)

- **Same details from many pages** on post URLs:
  - **Fields:** Open Graph, the embedded JSON (the T0 structured answers) and the page.
  - **Pacing per site:** concurrency 1–2 and a randomised delay (the existing speed profiles, with a "careful"
    default for sites that rate-limit).
  - **Back off** on HTTP 429 or a "Try again later" page.
- **Login wall:** a page that redirects to a login URL or shows only a login form is a **login wall**, not a row.
  The run stops after 3 in a row: "Instagram needs you to be logged in. N pages read; log in and resume."
- **Optional (decision §5): open each item.** A list mode that clicks each item, reads the dialog or route it opens
  (URL changes by `pushState`, or a `role="dialog"` appears), then closes it (Esc or back). This is generic for
  modal-detail sites: Instagram, LinkedIn jobs, Airbnb. It gives details with no second run and no new page loads.

## 4. Steps

| Step | What | Done when |
|---|---|---|
| **V0 Fixtures and the hang** | `e2e/site/virtual-grid.html`: rows of 3 inside a padding-windowed wrapper (about 4 rows mounted), atomic classes, a `mount_0_0_N` root with a random N, `/u/p/{code}/` links, 12 more posts per scroll end, embedded JSON at depth 14, the next pages as `fetch` JSON. `virtual-feed.html`: `article`s that are **recycled** (same nodes, new content), a "Sponsored" and a "Suggested for you" block, endless. Find why the traced auto-scroll never completed (§2.2) and why the link pick didn't answer. Logged-in captures of the feed, a profile and a post from the user, kept local (`instagram-*-local.html.gz`, git-excluded). | Both fixtures reproduce R1–R4 in an e2e test: today's run loses or duplicates rows. The hang has a cause and a failing test |
| **V1 Harvest scrolling** | §3.1 in `MutationAwareScrollStrategy` (or a new strategy behind it): read every mounted item per step, identity keys, 0.8-viewport steps, re-resolve the container, end rules, limits. `listRun.ts` dedupes on the same key. | `virtual-grid.html`: 120 of 120 posts, each once, none blank, in order. `virtual-feed.html` with recycling: every post's own content. Existing list e2e tests still pass |
| **V2 Picking on atomic, split, virtual grids** | §3.2: link-shape items, counter-tail ids rejected, chains from landmarks. | The fixture and the saved Instagram profile: one pick → "12 posts", an item chain with no `nth-of-type` and no `mount_` id that finds the same 12 after a reload |
| **V3 JSON and API fields** | §3.3: any-depth search with a budget, connection unwrapping, id anchors, network capture for the run. | Fixture rows carry caption, date and media type, for the first 12 posts (embedded) and the scrolled ones (API). The saved profile: 12 of 12 rows matched to their JSON |
| **V4 Feeds** | §3.4: the promoted/suggested filter, limits in Quick run and Step 3. | `virtual-feed.html`: no promoted rows; a 50-item limit stops at 50 and saves |
| **V5 Post details** | §3.5: login-wall detection, careful pacing, back-off, the stop message. | A bulk run on fixture post pages where the 4th page redirects to `/accounts/login`: the run stops after 3 walls with the message, and the read rows are saved. Pacing delays are visible in the job's stats |
| **V6 Open each item** (if chosen) | §3.5 optional mode. | A fixture grid whose items open a dialog: every item's dialog fields, the dialog closed after each one |
| **V7 Report** | The run report says: virtual list detected, items read, duplicates skipped, promoted left out, limit reached, login wall. | Shown in the Step 3 result and the job's stats |

V1 and V3 matter most: V1 fixes the wrong and missing rows on every virtual list, and V3 gives the fields that
Instagram's markup doesn't show.

## 5. Decisions

1. **Network capture during list runs** (V3): on by default for every list run (data stays in the tab, dropped at the
   end), or only when the page has no usable markup fields? The plan assumes on by default.
2. **Default limits for endless feeds** (V4): 200 items or 10 minutes, whichever comes first?
3. **Open each item** (V6): in scope now, or after V1–V5?
4. **Logged-in captures** (V0): the user saves the home feed, a profile and a post while logged in (they hold
   personal data and stay local, never committed).

## 6. Risks

- **Account blocks.** Instagram rate-limits and can lock accounts that load many pages fast. The defaults are slow
  for detail runs (V5). The user's own session is used: nothing is logged in on their behalf.
- **Terms of service.** Automated collection is restricted by Instagram's terms. This is the user's call per use; the
  extension doesn't bypass logins or limits.
- **Markup drift.** Mitigated by identity keys, link-shape items and JSON fields, none of which depend on class names.

## 8. Progress

| Step | State | Notes |
|---|---|---|
| V0 | Done, except the logged-in captures and the link-pick timeout | `e2e/site/virtual-grid.html` (rows of 3 in a padding-windowed wrapper, atomic classes, `mount_0_0_N`, embedded JSON 14 deep, `/feed/posts` pages, the wrapper replaced after the 2nd fetch) and `e2e/site/virtual-feed.html` (a pool of 5 recycled `article`s, sponsored posts, `?total=0` endless). Test server: `/feed/posts`. On the old strategy the grid run stopped at 19 of 60 posts (R4) and the feed run never ended (R1). **The traced hang:** `findLoadMore` took Instagram's "Show more posts from natgeo" link (it goes to the login page) for a Load more control; the click navigated, the content script went with the page and no "complete" was ever sent. Fixed twice: a link to another page is never a Load more control, and a page that goes away mid-run sends "complete" with the rows read so far (`pagehide`). Open: why the link pick didn't answer (V2), and the user's logged-in captures |
| V1 | Done | `MutationAwareScrollStrategy` is a harvest loop: every item in the page read at once in screen order (`visualOrder`), keyed by `identity.ts` (`itemKey`: links without query/hash, else identity attribute, else text and image paths; `ItemKeys`: link keys shared by items, at once or over the run, add the text), checked again just before reading (recycled nodes), 0.8-screen steps, the container found again (`resolveRoot`), ends at the list's end after `maxNoChanges`, a cap on empty steps, `maxItems` / `maxMs` (`AutoScrollRequest`). `listRun.ts` dedupes on the key. Tests: `identity.test.ts` (3), `settle.test.ts` (the login link), `e2e/virtual.spec.ts` (3: 120 of 120 grid posts in order; 40 of 40 recycled feed posts each with its own link; an endless feed stops at 25). Extension, list, listing scorecard and picker e2e still pass |
| V2 | Done | The hover already found Instagram's 12 posts (the picker's container-bound rules and `pathChain`, commit 42a64eb). Added: **link-shape items** in `list.ts` (`linkShape`: the word before the link's id segment, `p` / `reel`, at most 3 words each on 2+ items: `div:has(> a[href*="/reel/"], > a[href*="/p/"])`, family `link`, preferred to generated classes), and **counter-tail ids** rejected (`isStableId`: `mount_0_0_29`, `root-3-12`). The live logged-out page didn't answer a pick: there a post link measured 1264 × 1703 px (Instagram's layout for an automated logged-out browser, not a user's), so the live pick is left to the user's own browser. Corpus: `instagram-profile.html.gz` (public, logged out). The pinned selector report gains link-shape entries where only a bare tag named the items before (exact matches only). Tests: the stable-id cases, `e2e/picker.spec.ts` (Instagram profile: 12 items from every hover point), `e2e/virtual.spec.ts` (the Instagram pick stores the link chain and no `mount_` id; pick on the windowed grid then run with the picked chains: 48 of 48) |
