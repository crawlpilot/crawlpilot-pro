# Pro: page rules, conditions and value checks

A review of how recipes say what a page is (page rules) and what a value must be (assertions) found these gaps. Each
is numbered (R1–R6) and referenced in the code.

## What there was
- **Conditions** (`all`, `any`, `not` of match counts) were already evaluated in the page, and Atlas imports used them,
  but the editor could only add a single "the page has the text" or "something matches" rule. It could not combine
  tests, edit or reorder rules, or add a condition to a way.
- **"The page has the text"** searched the HTML source, so text in scripts and attributes counted, and entities did not
  match.
- **A page where a rule held** showed "0 of 0 fields found" on Check. `passed()` counted it as passed. An error page kept
  as a sample could not be marked as such, so it blocked readiness.
- **Field checks** were only "required" and "parses as its type".
- **The Atlas import** understood AND and OR only. NOT, `!`, NOR and unknown functions made a condition that never
  holds, noted only in the version note.
- **List recipes** had no page rules.

## Done
1. **R1. Check names the outcome** (`runner/outcome.ts`, `pageOutcome`). A page is one of: read, a rule that held, a
   rule a sample expected but that did not hold, another product, or not read.
   - Check says which rule held and hides the empty field table.
   - The samples grid marks rule pages in their column and lists each page that was not a plain read.
   - `passed()` no longer passes a page where a rule held.
2. **R2. Samples that should hit a rule** (`Sample.expectRule`).
   - On Check or in the editor's test, *Keep as a sample that should hit "X"*. The editor's sample list has a "Should
     be" choice.
   - Such a sample passes when its rule holds and is not one of the 3 pages to read.
   - Readiness names one that missed, or a rule gone from the recipe.
   - The expectation is written to and read from the recipe file.
3. **R3. A condition builder** (`recipe/conditions.ts`, `pages/ConditionEditor.tsx`).
   - **What a test looks at:** the visible text, elements matching a selector, the URL, the title, or the HTML source
     (`in` on a regex condition; the default stays the HTML, as Atlas counts).
   - **Counts:** is found, is not found, at least, at most, exactly, more than, fewer than, not exactly (`gte`, `lte`
     and `ne` added).
   - **Groups:** all of these (AND), any of these (OR), none of these (NOR), nested one level.
   - **Plain text** is kept as an escaped, case-blind regex and reads back as text; *Regex* switches.
   - **Each condition reads as a sentence.**
   - **Rules can be renamed, given a status, reordered and removed;** a way gets *Only try it when…*.
   - **Problems** (nothing to look for, a bad regex, a duplicate rule name) block saving. An empty group is a warning.
4. **R4. Value checks** (`field.checks`, `recipe/valueChecks.ts`, `pages/ValueChecks.tsx`).
   - **Kinds:** matches or does not match a pattern; a numeric range on the typed value; one of a list (case and spaces
     aside); a length of text or of a list; a comparison with another field on the page.
   - **Order:** one-field checks run with the field. Comparisons run once the page is read, when both are filled.
   - **Where they show:** a failure is the field's problem, in Check, readiness and the crawler's `fieldStatus`.
   - **Versions and renames:** the version diff names checks added and removed. Renaming a field carries comparisons
     with it, and the identity check, along.
5. **R5. The Atlas import.**
   - It reads NOT and `!` (tightest), NOR (`A NOR B` is NOT (A OR B)), and the "or equal" and "not equal" count
     functions as well as the three seen in the exports.
   - OR and NOR mixed without brackets is not guessed.
   - The import message lists what was not carried over, conditions that never hold first.
   - The editor marks a rule that never holds and a way that is never tried (`neverHolds`).
6. **R6. Page rules for list recipes** (`ListRecipeSpec.rules`).
   - They are checked before any row is read (`crawler/inPage.ts`, `readLists`). On a later page, paging stops and the
     rows so far are kept.
   - The worker classes the job as for a page and writes a status-only document.
   - They are edited in Pro's editor (a list recipe's rows are still re-picked) and kept on a list re-pick, with the
     setup and details page, which a list re-pick used to drop.
   - Rules are diffed by name: added, removed, status or condition changed, moved.

## Not done
- **The Atlas count function names** beyond EQUAL_TO, GREATER_THAN and LESS_THAN are guesses (the "or equal" and
  "not" forms, symbols). They should be checked against Atlas's list.
- **Check reads page recipes only.** A list recipe's rules are tested by the crawler, not yet in Pro.
- **Value checks on a list or table's columns** (each row's price in range) are not there yet. Value checks on a field
  are.
