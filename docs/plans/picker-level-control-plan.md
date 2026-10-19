# Picker: the user controls how much is selected

Status: 2026-10-19. **L1–L4 built** for every picker (the Page Extractor's readings, the bar, the side panel mirror in the Page Extractor). **L5 built** (#35). L6–L7 to do: issues #36, #37.

Decided by default (the open questions below): the Page Extractor first; the keys as proposed; no sticky offset across elements; "leave out part" later.

**Built:**
- `picker/path.ts`: visible steps, Narrower back toward the start, siblings, breadcrumbs. A step that stands for same-box wrappers is named by the most telling one ("div.price-block", not "div.wrap").
- `VisualElementPicker`:
  - the level holds while the cursor stays inside it, and Space locks it;
  - keys ↑ ↓ [ ] ← → Space Enter Esc, L / T / V, and Alt+scroll;
  - the bar (path, "Read as" chips, a button per key);
  - `PICKER_STATE` to the side panel, at most every 120 ms;
  - `PICKER_ACTION` names: wider, narrower, prev, next, lock, select, `reading:i`, `step:i`.
- `DetailSelectionStrategy.readings()`: from the existing detectors, suggested in their old order, and the click saves the reading shown (no re-deciding). For example, a spec row is suggested as "Texts · 2" as before, with "Items like this · 4" and its "Text" one key away.
- `PickerControls` (side panel): path, Wider / Narrower / Prev / Next, "Save it as" chips, Lock, Select, and the keys forwarded. It is used in the Page Extractor's "Pick the fields".
- **L5, List Extractor:**
  - `findListCandidates` (`items.ts`) keeps every section the walk scores, nearest first, and the rows of a grid laid out in rows; `findList` still returns the same pick.
  - `ListSelectionStrategy.readings()` offers them, with the old pick suggested; `stepsThroughReadings` makes ↑ / ↓ step through sections (keeping cards or rows), and the click saves the section shown.
  - The bar shows "Sections", and `PickerControls` is in the List Extractor's pick step.
- Tests:
  - `path.test.ts` (4);
  - `e2e/picker-levels.spec.ts` (4: steps and back, the next row and readings, lock and bar buttons, the side panel protocol).
  - The picker, list, pagination and run browser tests still pass.

Scope:
- The Page Extractor's element picker ("attributes": `DetailSelectionStrategy`).
- The List Extractor's section picker (`ListSelectionStrategy`).
- The shared `VisualElementPicker`.

## 1. What's wrong today

| # | Where | What the user sees | Why |
|---|---|---|---|
| 1 | `VisualElementPicker.handleKeyDown` / `handleExternalAction` | ↑ "Expand" jumps to an element that looks the same, or to something much larger than expected. | ↑ goes to the DOM `parentElement`, and many parents are invisible wrappers with the same box. Several presses change nothing on screen; then one press takes the whole card. |
| 2 | Same | ↓ "Narrow" goes somewhere unrelated to where the mouse was. | ↓ takes the **first** child with text, not the child on the way back to the hovered element. ↑ then ↓ doesn't return to the start. |
| 3 | `handleMouseMove` | The level chosen with the keys is lost on the next mouse move. | Every mouse move sets `currentElement` to the element under the cursor, so keys and mouse fight. |
| 4 | `DetailSelectionStrategy.handleClick` | The user narrows to one item of a list and clicks, but gets **the whole list**, or a "Table" of the item's siblings. | The click reinterprets the element: `findListInside` makes it a list, `classifyAsSiblingTable` retargets to the **parent**, and `classifyAsHomogeneousArray` makes it an array. The user's level is overridden by the picker's own idea of what they meant. |
| 5 | Detail hover | The highlight says "Select Element / Click to edit & extract" at every level. | Nothing tells the user what the click will produce: one value, a list of 12, a table, an image, a link. |
| 6 | `ListSelectionStrategy.handleHover` | ↑/↓ in the List Extractor appear to do nothing, or jump to an unrelated section. | ↑ moves to the parent element, then `findList` runs again from it and picks its own container. The user can't choose "these cards, not their rows" or "this smaller section". |
| 7 | Both | No way to go to the next item at the same level (the next spec row, the next card). | There is no sibling movement. |
| 8 | Both | Once picked, a field can't be widened or narrowed; it must be deleted and picked again. | There is no "adjust" for an existing selection. |
| 9 | Both | The shortcuts work only while the page has focus, or through the side panel's key forwarding (`Step2Schema` sends `PICKER_ACTION`); there are no on-screen controls. | Keyboard only, and only ↑/↓. |

## 2. Principles

1. **What you see is what you get.** The outlined element, and the outlines on the items it repeats, are exactly what the click saves. The picker suggests; it never silently swaps the selection on click.
2. **The user's level sticks.** After ↑/↓, the chosen level holds while the cursor stays inside it. It doesn't jump back on the next small mouse move.
3. **Visible steps only.** Every step changes what's on screen: wrappers with the same box, `display: contents` elements and zero-size elements are skipped.
4. **Say what it will be.** Each level shows what a click produces: "Text · $24.99", "Image", "Link · /item/12", "List · 12 items", "Table · 5 rows × 3".
5. **Container-bound stays.** The List picker still only considers the hovered element's ancestors and their children (`picker-container-bound-plan.md`). Level control chooses among those; it doesn't search the page.

## 3. Design

### 3.1 The selection path (shared, `picker/path.ts`)

When the cursor rests on an element, the picker builds its **path**: the hovered element and its ancestors up to `body`, keeping only **visible steps**. An ancestor is dropped when it has:
- the same rendered box as the step below it (±2 px);
- no box (`display: contents`, zero size);
- no text and no media of its own beyond the step below.

The current selection is an **index into the path**. The path is kept until the cursor leaves the selected element, so ↓ always walks back toward the element the user started from (fixes #2).

### 3.2 Controls

| Control | Does |
|---|---|
| ↑ or `[` or **Alt + scroll up** | Wider: one visible step up the path. |
| ↓ or `]` or **Alt + scroll down** | Narrower: one visible step down, toward where the cursor started. At the bottom, it goes into the child under the cursor. |
| ← / → | Previous / next sibling at the same level, among siblings with a box and text (the next spec row, the next card). |
| **Space** | Lock or unlock the selection. Locked: the mouse no longer changes it, so the user can move to the side panel or the bar. |
| `L` / `T` / `V` | How to read it: as a **L**ist, a **T**able or one **V**alue (see 3.3). |
| Enter / click | Select exactly what is outlined, read as shown. |
| Esc | Cancel (as today). |

**Mouse and keys together (fixes #3):**
- After a key, the level holds while the cursor stays inside the selected element.
- Moving the cursor out starts again from the new element at its own level.
- Optional, later: keep the same offset "+2 levels" for the next element, useful for picking the same level in several places. Only if wanted (open question 3).

### 3.3 "How to read it" chooser (fixes #4, #5)

At each level the picker works out the **readings** the element supports, using the existing detectors (`findListInside`, `detectHomogeneousArray`, `classifyAsSiblingTable`, direct tag, wrapper content). Instead of picking one silently, it shows them:
- **Value** (always): its text, or its image or link when it is one.
- **List · N:** when it holds N similar items (outlined dashed).
- **Table · N rows:** when its children are rows of the same shape.
- **Items like this · N:** when the selected element is **one of** N similar siblings. This is today's silent "sibling table" retarget, now a choice; picking it widens the outline to the parent with dashed outlines on the siblings.

The suggested reading is preselected and shown first, as today's detectors would choose. The user can switch with `L` / `T` / `V` or by clicking a chip. **The click saves the reading shown.** "Auto" no longer overrides a level the user chose.

### 3.4 The on-page bar (replaces the shortcut bar)

At the bottom of the page, with pointer events on (it's ours, above the overlay):

```
 card › div.price-block › [ span.price ]            ◀ ▶     Value · $24.99 | List · 3 | Items like this · 24
  Wider ↑   Narrower ↓   Lock ␣   Select ⏎   Cancel Esc
```

- **The path as breadcrumbs:** each chip is a visible step, named by its role or text (`card`, `price`, `ul · 12`), not raw class names. Clicking a chip jumps to that level, and hovering a chip previews its outline.
- **The readings as chips,** with the preselected one filled.
- **Buttons for every key,** so it works without the keyboard and from a trackpad.

The tooltip near the element keeps a one-line version: "Price · $24.99 · click to select".

### 3.5 Side panel mirror

`Step2Schema` (Page Extractor) and the List Extractor's pick step show a **Selection** card while picking:
- the same breadcrumbs;
- Wider / Narrower / ◀ ▶ / Lock buttons;
- the reading chips;
- a live preview of the value or the first 3 items.

The content script sends `PICKER_STATE` (path labels, index, readings, preview) on each change; the buttons send `PICKER_ACTION` with the new actions (`wider`, `narrower`, `prev`, `next`, `lock`, `reading:list`…). This replaces the side panel's key forwarding of ↑/↓/Enter (#9).

### 3.6 List picker levels (fixes #6)

The List picker's hover finds **candidate sections** along the hovered element's ancestors, as `findList` already does internally. That includes the nearest container of cards and larger ones with clearly more cards. ↑/↓ move through those candidates, not raw DOM parents.

- **Sections:** ↑ takes the next larger section, for example "Results · 24" then "Results + shelf · 30" when they really share a container. ↓ goes back.
- **Items within a section:** `Alt+↑/↓` (and chips "Cards · 24" / "Rows · 8") choose the item level when there are two, such as a grid of rows and the cards in them. This is today's automatic row split, made a visible choice.
- **No page-wide search:** candidates stay among ancestors, as the container-bound plan requires.

### 3.7 Adjust an existing pick (fixes #8)

Each element in the Page Extractor's list, and each selector card in the List Extractor, gets **Adjust**:
1. It finds the element with its stored chain, scrolls to it and outlines it.
2. It opens the picker **locked** on it, with its path and readings.
3. Wider, Narrower, the arrows and the reading chips then replace that field's selector and reading in place. Its name and position in the recipe stay.

### 3.8 Leave out part of a selection (later, optional)

"Reduction" beyond moving to a child: **Alt + click** a part inside the selection to leave it out. For example, a price block without its "was" price, or a description without its "Read more" link.
- The part is saved as an exclusion on the field: a relative selector whose text is removed when reading.
- It's shown struck through in the outline.
- The reader (`ElementProcessor`, list fields) skips it.

This changes the field spec, so it's a separate phase.

## 4. Phases

| Phase | What | Files |
|---|---|---|
| L1 | **Path and controls:** visible-step path, ↑/↓ along it, ↓ back toward the start, ←/→ siblings, sticky level and Space lock, Alt+scroll. Keys work the same in the side panel's forwarding. | `picker/path.ts` (new), `VisualElementPicker.ts` |
| L2 | **What it will be:** readings per level (from the existing detectors, no new heuristics), the tooltip line, the click saving the reading shown. Detail's `handleClick` takes the chosen reading instead of re-classifying. | `DetailSelectionStrategy.ts`, `ISelectionStrategy.ts` (`readings(el)`, `handleClick(el, reading)`) |
| L3 | **The on-page bar:** breadcrumbs, reading chips and buttons, replacing the shortcut bar. | `VisualElementPicker.ts`, `picker/bar.ts` (new) |
| L4 | **Side panel Selection card** and `PICKER_STATE`; the key forwarding is replaced by the buttons (keys still forwarded). | `messages.ts`, `content/handlers/picker.ts`, `Step2Schema.tsx`, the List Extractor's pick step |
| L5 ([#35](https://github.com/crawlpilot/crawlpilot/issues/35)) | **List picker levels:** sections along the ancestors, and item level (cards vs rows) as a choice. | `ListSelectionStrategy.ts`, `extraction/items.ts` (expose the candidates `findList` already scores) |
| L6 ([#36](https://github.com/crawlpilot/crawlpilot/issues/36)) | **Adjust** an existing pick. | Page Extractor element list, List Extractor `SelectorCard`, `START_PICKER` payload (`adjust: chain`) |
| L7 ([#37](https://github.com/crawlpilot/crawlpilot/issues/37)) | (Optional) **Leave out part:** exclusions on a field. | Field spec, `ElementProcessor`, list field readers |

## 5. Tests

**Unit (jsdom), `path.test.ts`:**
- wrappers with the same box are skipped;
- `display: contents` is skipped;
- ↑ then ↓ returns to the start;
- ←/→ skip empty siblings;
- the path of an element in a card.

**Unit, readings:**
- a `ul` gives List · N and Value;
- an `li` among 5 gives Value and Items like this · 5;
- an `img` gives Image;
- a table row's cell gives Value and Items like this.
- The click saves the reading chosen, never a retarget.

**e2e (`picker.spec.ts`, fixtures in `e2e/site/`):**
- on `product.html`, hover the price, then ↑ twice; the outline is the price block, and Enter saves it as Value. ↓ comes back to the price.
- On a spec table, → moves row by row.
- Choosing "Items like this" on one spec row saves a table of all rows.
- List picker on `rows-grid.html`: "Cards · 12" vs "Rows · 4" both offered, each saved as chosen.
- Adjust a saved field from the side panel: widen one level, and the recipe's selector changes; the field keeps its name.
- The perf budget for hover still holds at 4× (`perf.spec`): the path and readings are built once per hovered element, not per frame.

## 6. Open questions

1. **Which picker first?** The Page Extractor's element picker (most of the "attribute" complaints), or both together?
2. **Keys:** ↑/↓ plus `[` / `]` and Alt+scroll as proposed, or something else? (Plain scroll must keep scrolling the page.)
3. **Sticky offset:** after choosing "+2 levels" on one element, should the next hovered element start at +2 as well (good for picking the same level repeatedly), or always start at the element under the cursor?
4. **Leave out part (L7):** wanted now, or later?
