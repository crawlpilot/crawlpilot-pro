# Pro: fields from the page's data, and JOLT transforms

Two gaps in the recipe editor, found while bringing Atlas recipes over:
- **No fields from page data.** A field could not be added, or given a way, from the page's JavaScript-backed data
  (JSON-LD, `__NEXT_DATA__`, inline state). Only re-picking in the Page Extractor did that.
- **No JSON transformation.** Atlas turns each record into the schema its consumers want with JOLT; Pro wrote the
  fields as read.

## Done
1. **JOLT** (`src/pro/recipe/jolt.ts`): a chain of operations, as JOLT writes them, so an Atlas spec runs unchanged.
   - **shift:**
     - Keys match as a literal, `*`, `pre*suf` (with captures) or `a|b`; a literal wins over a wildcard.
     - The specials are `@`, `@(n,path)`, `$` / `$n` and `#literal`.
     - Output paths take `&`, `&n`, `&(n,m)`, `[]`, `[n]`, `[&n]`, `[#n]` and `@(n,path)`.
     - Two values written to one place make a list.
   - **default, remove, cardinality** (`ONE` / `MANY`) **and sort.**
   - **modify-overwrite-beta / modify-default-beta / modify-define-beta,** with these functions:
     - text: `toString`, `toLower`, `toUpper`, `trim`, `concat`, `join`, `split`, `substring`, `leftPad`, `rightPad`;
     - numbers and booleans: `toInteger`, `toLong`, `toDouble`, `toBoolean`;
     - lists: `toList`, `size`, `firstElement`, `lastElement`, `elementAt`, `squashNulls`, `recursivelySquashNulls`;
     - arithmetic: `abs`, `min`, `max`, `intSum`, `longSum`, `doubleSum`, `divide`, `divideAndRound`, `multiply`, `noop`.
   - Unknown operations and functions are named before saving.
2. **The transform in a recipe** (`PageRecipeSpec.transform.jolt`).
   - **Input:** the page's record, its fields by name as read (typed and cleaned), goes through the chain.
     `readPage.ts` makes `record`, or `recordError` when the chain fails on the page.
   - **Editor:**
     - The *Transform (JOLT)* section takes the spec as JSON, and *Start from the fields* writes a shift that keeps
       every field.
     - The output shows on the page last tested. Saving waits until the spec is valid.
   - **Check** shows the record. **The version diff** names the change.
   - **Crawler:** it writes `record` (and `recordError`) next to `attributes` in the scrape document, also for each
     "for each" row. The `scrapes` mapping stores `record` without indexing it, as it does `attributes`.
   - It is part of the spec, so changing it is a new version, and the worker gets it with the spec.
3. **Fields from the page's data** (`steps/pageData.ts`, `pages/PageDataSource.tsx`).
   - **Finding values:** *From the page's data* lists the open page's values, with where they are
     (`__NEXT_DATA__ · props.pageProps…product.name`). It searches by key or value, offers lists of plain values
     whole, and puts values inside lists last.
   - **On a field:** the value chosen becomes that field's first way.
   - **As a new field:** *Add a field from the page's data*, at the end of the fields, makes one. It is named from the
     key (`usItemId` → `us_item_id`) and typed from the value (a number, a URL, a list, or text).

## Not done
- **List recipes:** a transform on their rows; their fields are still picked in the List Extractor.
- **JOLT gaps:** the `*` wildcard inside an output path segment, and `modify` functions not listed above. Each is said
  when a spec uses it.
