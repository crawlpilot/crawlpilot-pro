# Pro: a simpler way to build transforms, and the JOLT still missing

**Today's transform** (`recipe/jolt.ts`, the editor's *Transform (JOLT)*) is a JSON spec typed by hand. It is right
for anyone fluent in JOLT, and hard for everyone else:
- `&1`, `@(1,…)`, `[#2]` and wildcard precedence have to be known;
- an error shows only as an empty output;
- nothing ties the output to the schema it has to meet.

This plan has two parts:
- **A–F:** a builder that writes the JOLT for the user.
- **G–H:** the parts of JOLT still missing, and the few non-JOLT steps worth adding for scraped data.

## A. The output mapping: a table, not JSON (the default view)
One row per output key: **Output** ← **From** · **How**, with that row's value on the tested page.

| Output | From | How | On the tested page |
| --- | --- | --- | --- |
| `id` | `us_item_id` | as is | `17070020028` |
| `offer.amount` | `price_display` | number | `194` |
| `attributes.fuel` | `specifications` › `Fuel type` | as is | `Propane` |
| `category` | `path` › every row › `name` | list | `["Patio & Garden", …]` |
| `category_path` | `path` › every row › `name` | joined with `" > "` | `Patio & Garden > … ` |
| `image` | `all_images` › first row › `url` | as is | `https://i5…jpeg` |
| `source` | text `walmart` | as is | `walmart` |

- **Output** is a dotted path (`offer.amount`), typed or chosen from the target schema (B).
- **From** is a picker over the record, all the way down. It lists:
  - the fields;
  - an object field's keys (`specifications` › `Fuel type`, from the values on the tested page);
  - a table field's columns, for every row, the first row or the last row;
  - a fixed text;
  - another output already mapped.
- **How**, one choice per row, each a JOLT step:

  | How | JOLT step |
  | --- | --- |
  | as is | `shift` |
  | first item / last item / item *n* | `firstElement`, `lastElement`, `elementAt` |
  | list / one value | `cardinality` |
  | joined with … | `join` |
  | split on … | `split` |
  | count | `size` |
  | number / whole number / yes-no / text | `toDouble`, `toInteger`, `toBoolean`, `toString` |
  | upper / lower / trimmed | `toUpper`, `toLower`, `trim` |
  | default if missing | `default` |

- **Row tools:** rows are added, removed and reordered. *Add every field as is* fills the table, and *Remove what isn't
  mapped* says what the output leaves out.

The builder writes the JOLT chain (shift, then modify, default, cardinality and remove as the rows need), and that
chain is what the recipe keeps. So the crawler, Check and an Atlas export stay as they are.

## B. Start from the schema the output has to meet
- **Targets from the contract:** when the recipe has an output contract (*Output contract*), its fields are the
  Output column. Required ones are marked, and each row says whether it is mapped. *Map by name* fills the rows whose
  names match a field.
- **Contract check on the output:** the contract's check runs on the transformed record when there is a transform
  (it runs on the fields today), so "ready to submit" means the output meets the schema.

## C. JOLT stays one click away, and round-trips
- **Two tabs:** *Mapping* (A) and *JOLT* (today's editor). Editing either updates the other while the chain is one the
  builder can show.
- **A chain the builder can't show:** a hand-written chain with steps beyond the table (a `shift` over wildcards it
  didn't write, a nested modify) stays editable as JOLT. The Mapping tab then shows the chain read-only (D) and offers
  *Rebuild as a mapping*, which replaces it after a confirm.
- **Pasting an Atlas spec:** it opens in the JOLT tab and is checked (G). When it's simple enough, it shows as a
  mapping.

## D. Say what a chain does
Under the JOLT, each operation is read out in a line, and each line can be expanded:
- `shift`: "`title` → `product.name`; every item of `offers` → `variants[]` (sku → id, price → price)";
- `modify-overwrite-beta`: "`offer.amount` = number of `offer.price`";
- `remove`: "drops `gallery`".

An operation that changes nothing on the tested page is marked ("matched nothing: no key `Fuel Type`, did you mean
`Fuel type`?").

## E. Preview on more than one page
- **Side by side:** input record and output, with keys the output leaves out listed ("not in the output: `upc`,
  `rating`").
- **Every sample page:** *Try on the sample pages* runs the transform on the samples' last reads. It shows one line per
  page and the pages where an output key is missing or a step failed (`recordError`).

## F. Starting points
*Start from* offers a few common shapes:
- **Rename and nest:** every field as is, under the paths typed.
- **Specs into named attributes:** an object field's keys picked one by one; the rest under `other`.
- **A list of objects into a list of one key:** every row's `name` into a list.
- **First image and gallery:** the first row's `url`, then the rest as a list.
- **Defaults for missing values.**

## G. JOLT that is still missing
**What the engine runs today:** all eight operations, `shift` with `*` / `a|b` / `pre*suf` / `@` / `@(n,path)` / `$` /
`#` / `&n` / `&(n,m)` / `[]` / `[#n]`, and 29 modify functions.

**Missing, by how often specs use it:**

| Missing | What it does | Useful because |
| --- | --- | --- |
| `*` inside an output path (`"*": "out.&"` works; `"out.*"` doesn't) | writes under the key matched | some Atlas specs write maps this way |
| `$(n,m)`: a capture as the value | the part of a key a wildcard matched, as a value | `"spec_*": { "$(0,1)": "names[]" }` |
| Escapes `\@`, `\$`, `\&` in keys | keys that really contain those characters | JSON-LD has `@type`, `@id` |
| `indexOf` | position of a value in a list | picking the variant that matches |
| `avg` | average of a list | ratings, prices across offers |
| `intSubtract`, `longSubtract`, `doubleSubtract` | a − b | was − now price = saving |
| `squashDuplicates` | a list without repeats | images and categories listed twice |
| `isPresent`, `notNull`, `isNull`, `isString`, `isInteger`, `isLong`, `isDouble`, `isBoolean`, `isList`, `isMap` | keep a value only when it is of that kind | drop a price that isn't a number |
| `toList` of a map, `size` of a map | as JOLT | consistency |
| `modify-*` keys ending `?` | set only when the key is there | conditional changes |

Each comes with a test written from JOLT's own documentation. A spec that uses something still unsupported is named
when pasted (it is already), so nothing fails silently.

## H. Beyond JOLT, for scraped data (marked as Pro's, kept out of Atlas exports)
JOLT has no regex, dates or money, and scraped text needs them often. Most of it belongs in a field's cleanup (where
regex, Lua and typing already are), not in the transform. Three steps that only make sense on the record:

| Step | Example |
| --- | --- |
| `=regexExtract(pattern, value)` | `"Number of burners: 4"` → `4` (when the value came from page data and has no cleanup) |
| `=money(value)` | `"$194.00"` → `{ "amount": 194, "currency": "USD" }`, the same parser as the `money` type |
| `=date(value, format)` | `"Arrives Thu, Nov 6"` → `2026-11-06` |

They are flagged as Pro-only in the JOLT tab and the Mapping table. A spec using them won't run in Atlas, and the
check says so.

## Order
1. **A and E**, the table and the preview: the change people feel. It writes the JOLT that exists today.
2. **B**, schema-led mapping, and the contract checked on the output.
3. **C and D**, round-tripping and reading a chain.
4. **G**: escapes and `@type` first (JSON-LD), then `squashDuplicates`, the subtracts, `avg`, `indexOf` and the
   type checks, then `$(n,m)` and `*` in output paths.
5. **F**, the starting points.
6. **H**, after G, if the field cleanups don't already cover the cases.
