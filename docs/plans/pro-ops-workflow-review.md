# Pro: the ops workflow, reviewed

A walk through creating and updating a page recipe in the built extension, as an ops person does it:
- Build new;
- pick fields;
- save version 1;
- open the recipe;
- edit fields;
- test on the page.

Screens were captured at side-panel width. The aim is to find what makes the job slower or harder than it needs to
be, and to propose a simpler flow. Findings are numbered and referenced in the proposal.

## What works
- Picking a field shows its value straight away ("Linen Overshirt", "$79.00"), and page data is used when the page
  has it.
- Each version says why it can't be submitted yet ("Not ready: Not tested on sample pages yet", "Set the
  competitor"), and versions, review and live are clear on the recipe screen.
- The test-on-pages grid (fields × pages, ✓ and –) is the best validation view the extension has.

## Findings
### Building a recipe
1. **Fields are named after their HTML tag** (`h1`, `p`). Every field has to be renamed later, on another screen. The
   page usually says what a value is (JSON-LD `name`, `offers.price`; the extension's meaning detection), so a good
   name could be proposed at pick time.
2. **Two different "types".** At pick time the dropdown says *Text* (what the reader reads: text, link, image). In
   the editor the field has a *type* (text, money, date…) that was guessed silently (`p` became `money`). Ops see
   two settings called type, and the one that matters for the data is set where they can't see it.
3. **The wizard is the public extension's run wizard:** *Details → Pages → Run*, subtitled "Check, then get your
   data".
   - For a recipe, the Pages step is busywork: the crawler's jobs bring the pages.
   - Step 3 is called *Run* but it saves.
4. **What the crawler needs is asked last.** The recipe gets a default name ("127.0.0.1 · page details"). The
   competitor and page type, which it can't be submitted without, are asked on another screen, after saving.
5. **Saving ends in a dead end** ("Nothing ran. Test and submit it from Recipes. [Back to recipes]"). The next thing
   to do is always to check the values, so that's where saving should land.

### Checking a recipe (the main gap)
6. **There is no single view of what the recipe reads on this page.** *Test on this page* gives a one-line summary
   ("2 of 2 fields found"). Each value is inside its field's card, folded, and the card shows only a *found* chip.
   Ops can't see field, value, type and check side by side, and can't spot a wrong value at a glance.
7. **The typed value isn't shown as typed.** A money field shows "79", with no currency and no sign that it parsed as
   money. A date field doesn't show the date it understood. The cleaned value, the typed value and the reason for a
   failed check are all needed to trust a field.
8. **Nothing shows on the page what each field matched.** Picking highlights the element, but checking doesn't, so a
   field that reads the wrong element (the cross-sell price, not the product's) looks fine in the panel.
9. **Two test buttons** do similar things in different places: *Test on this page* at the bottom, *Test on 1 page*
   in Sample pages. The readiness verdict ("Ready to submit") appears only in the Sample pages section.

### Editing a recipe
10. **One long scroll with no order of work.** Sample pages, Output contract, Before reading, the fields and the
    steps are all at the same level. Nothing says "do this next".
11. **Field cards show everything at once**, as the screenshot of an open card shows:
    - name, type and required;
    - every way, with full XPath fallbacks;
    - *From the page's markup*;
    - the cleanup builder;
    - *Try on a value*.

    Most edits are a name, a type, or one selector.
12. **The recipe screen leads with the internals.** Targeting is fine, but *Selectors in v1* lists every way of every
    field, XPath fallbacks included, all marked "new", before the user has done anything. The actions that matter
    next are *Edit fields* (to test) and *Edit targeting*, and they compete with *Mark test* and *Mark live*, which
    are disabled without saying why.
13. **Reviewing means changing your name.** A version's author can't approve it, so ops switch *Your name* in the
    Backend dialog to approve as someone else. This is a stand-in until sign-in exists, but it's a trap: the name
    sticks.

## Proposal: three screens, each with one job
**1. New recipe.** One short form, then picking.
- **Upfront:** competitor, page type (both suggested from the site and the page) and name. Fixes 4.
- **Picking:** each field gets a proposed name from the page's data or meaning ("title", "price") and an output type
  (text, money, date…) that can be changed on the spot. The reader type moves to "Advanced". Fixes 1 and 2.
- **No Pages step.** Saving goes straight to Check. Fixes 3 and 5.

**2. Check** (the new screen this review asks for).
- **One table for the open page**, one row per field:
  - the field's name, and its type with a parse result ("money ✓ 79.00 GBP", "date ✗ not a date");
  - the value as the crawler will output it;
  - where it came from (page data, markup, a selector, healed);
  - required or not.

  Fixes 6 and 7.
- **On the page:** each field's element is outlined with its name, and clicking a row scrolls to it. Fixes 8.
- **Checks:** *Check this page* and *Check samples* sit side by side, with the fields × pages grid below. Fixes 9.
- **Readiness checklist,** each item a link to where it is fixed:
  - fields found;
  - samples checked;
  - targeting set;
  - review.

  Fixes 9 and 10.
- **Fixing a field:** clicking a row opens its editor.

**3. Edit field.** One field at a time.
- **Shown:** name, type, required, its value on the open page, and *Pick again on the page*.
- **Under "Ways and cleanup":** the list of ways, markup, cleanup and *Try on a value*. Fixes 11.

**Around them:**
- The recipe screen leads with the readiness checklist and *Check*; the selector list with usage moves below. Fixes
  12.
- *Mark test* and *Mark live* say why they are disabled.
- Approving asks "Approve as…" and doesn't change the user's saved name. Fixes 13 until sign-in.

## Order
1. **Check screen** (6–9): the biggest gain. It adds a screen and changes no existing one. **Done:**
   - **Where:** `src/pro/pages/CheckPage.tsx`, opened from each recipe's card, the recipe screen, and *Check it on
     this page* after saving a page recipe.
   - **What it shows:**
     - one row per field: the typed value, its verdict and its source;
     - each field's element outlined on the page with its name, coloured by its check;
     - one row per item for a "for each" step;
     - the sample pages' grid, and the *Ready to submit?* checklist with a link to each fix.
2. **Names and types at pick time, and saving into Check** (1, 2, 5). **Done:**
   - The save step lists each picked field with a proposed name and output type, both editable
     (`src/pro/recipe/naming.ts`). Names come from the page's data, the words in the selector, the value's shape, or
     the heading.
   - Names someone gave are kept, and duplicate names can't be saved.
   - Saving a page recipe offers *Check it on this page*.
   - Found while doing it: a re-pick used to drop everything Pro adds (types, required, cleanup, markup ways, session
     setup, action steps). Re-picks now keep it (`src/pro/recipe/repick.ts`).
3. **New recipe form and no Pages step** (3, 4). The wizard is the public extension's, so this needs a Pro hook in
   it, or Pro's own picking screen.
4. **Field editor folded down, recipe screen reordered, approving as someone else** (10–13).
