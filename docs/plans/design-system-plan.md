# Side panel design system: own components, no MUI, a livelier look

Status: D1 done, D2 waiting on the look review. Follows `ux-simplification-plan.md` (U0–U6 done).

Done so far:
- **Tokens** in `src/sidepanel/index.css`: the `--cp-*` names were kept, with new values, and new tokens were added (`brand`, tile pastels, `-soft` status fills, `line`/`line-strong`, `press`). Tailwind classes: `bg-surface`, `text-ink-2`, `border-line`, `bg-brand`, `bg-tile-mint`, `text-danger`, `rounded-card`, `shadow-press`, `font-display`, `text-caption` … `text-display`. Light-mode text colours meet 4.5:1.
- **Fonts are bundled** (`@fontsource-variable/*`, imported in `index.tsx`), not fetched from Google Fonts. Remote fonts didn't load in the extension test browser, and bundling means no third-party request and works offline.
- **The kit** is in `src/sidepanel/ui/` (Button, IconButton, Card, CardButton, Chip, Badge, Text, Heading, TextField, TextArea, Select, Switch, Checkbox, Radio, Segmented, Slider, Dialog, Menu, Tooltip, Notice, Progress, Spinner, Skeleton, Collapse, Disclosure, Stack, Row, Divider, EmptyState). Menus and tooltips opened inside a dialog render inside it, so they stay above the browser's top layer. Tests are in `ui/kit.test.tsx`.
- **The Kit view** is `?view=kit`, lazy-loaded and always present (it is small). Screenshots: `UX_SHOTS=<dir> UX_MODES=light,dark UX_VIEWS=home,kit UX_HEIGHT=3400 npx playwright test e2e/ux-shots.spec.ts`.
- **On the kit already:** Home, `Header` and `PageStrip`. The MUI theme (`muiTheme.ts`) was moved to the new colours, fonts and pill buttons, so screens still on MUI match until they move.

## 1. Why

- **Changing the design is hard today.** Buttons, cards, chips and inputs are styled where they are used: 684 `sx` props across 47 files, plus old `.btn` / `.card` / `.badge` classes in `index.css`, plus a `ui/Button.tsx` that wraps MUI. A change to "what a button looks like" means editing dozens of files, and they still drift apart.
- **MUI is heavy.** `vendor-mui` (MUI + Emotion) is 348 KB of the side panel's JavaScript, and we use about 50 of its components, mostly as styled `div`s (`Box`, `Stack`, `Typography`).
- **The look is dull and generic.** It has grey-on-white cards, small type and leftover cyan-to-blue gradients and glass panels (`ExtractionStatusBar`, `DataTablePage`), which is the "AI-generated dashboard" look.

## 2. Goal

1. **One component kit** (`src/sidepanel/ui/`) that every screen uses. The look is set only in the kit and in the design tokens in `index.css`. Screens never set colours, radii, shadows or font sizes themselves, so a future redesign means editing the kit and the tokens, not the screens.
2. **No MUI or Emotion.** Remove `@mui/material`, `@emotion/react` and `@emotion/styled`. The kit is plain React and Tailwind v4, already in the project. This should cut about 340 KB.
3. **A new look** that is bright, friendly and confident without being childish (direction in §4).

Not in scope: ag-grid (it stays, restyled through `gridTheme.ts` tokens), the content-script picker overlay on the page, the website.

## 3. The kit

Everything lives in `src/sidepanel/ui/` with one import: `import { Button, Card, … } from '../ui'`.

| Component | Replaces (MUI) | Notes |
|---|---|---|
| `Button` | Button, ButtonBase, LoadingButton | `variant`: primary · secondary · ghost · danger; `size`: sm · md · lg; `icon`, `iconEnd`, `loading`, `fullWidth` |
| `IconButton` | IconButton | needs `label` (aria-label and tooltip) |
| `Card` | Paper, Card, CardActionArea | `interactive` gives the hover/press state; `tone` for the coloured tool tiles |
| `Text`, `Heading` | Typography | a few named sizes only: title, heading, body, small, caption, mono |
| `Chip` / `Badge` | Chip, Avatar | `tone`: neutral · brand · success · warning · danger · info |
| `TextField`, `TextArea`, `SearchField` | TextField, InputAdornment, FormControl, InputLabel, FormHelperText | label, hint, error, start/end slot |
| `Select` | Select, MenuItem | native `<select>`, styled: small, accessible, no popover code |
| `Switch`, `Checkbox`, `Radio` | Switch, Checkbox, FormControlLabel | real inputs with a label |
| `Segmented` | ToggleButtonGroup, Tabs | one control for "pick one of a few" |
| `Slider` | Slider | native range input, styled |
| `Dialog` | Dialog, DialogTitle/Content/Actions | native `<dialog>` (focus trap, Esc and backdrop for free) |
| `Menu` | Menu, MenuItem, ListItemIcon/Text | anchored popover, keyboard navigation |
| `Tooltip` | Tooltip | small CSS/portal tooltip |
| `Notice` | Alert | tone + icon + optional action |
| `Progress`, `Spinner`, `Skeleton` | LinearProgress, CircularProgress, Skeleton | |
| `Disclosure` | Accordion, Collapse | `<details>` or a height transition |
| `Divider`, `Stack`, `Row` | Divider, Stack, Box | thin flex helpers with a `gap` scale; any other layout is Tailwind classes |

Rules, written at the top of `ui/index.ts` and enforced by a check:
- Screens use kit components and Tailwind *layout* classes only (flex, grid, gap, padding, width). No hex colours, no `rgba(...)`, no `rounded-[…]` or `shadow-[…]` outside `ui/` and `index.css`.
- `scripts/check-design.mjs` (run in `npm test`) fails on `@mui`, `sx=`, raw hex or `rgba(` in `src/sidepanel/**` outside `ui/` and `theme/`.
- A **Kit view** (`?view=kit`, dev builds only) shows every component in every state, in light and dark. Design changes are checked there and in the existing `ux-shots` screenshots.

## 4. The look ("Pop")

The aim is something that feels like a well-made consumer app (Arc, Linear's marketing pages, Gumroad, Duolingo's restraint), not an admin template.

- **Warm paper, not grey.** Background `#FAF7F2`, white cards, warm near-black ink `#16130F`. Dark mode: `#121110` with warm greys, not blue-black.
- **One electric colour.** Lime `#C8F03C` for the moment that matters: the main button's hover and press, selected states, the active step, "found 24 items" highlights. It is always a *fill* with ink text on it, never lime text on white. In dark mode the main button itself is lime.
- **Soft colour tiles for the tools.** Each tool on Home gets its own pastel (lilac, sky, peach, mint, butter) with an ink icon, so the screen reads at a glance instead of being a column of identical grey rows.
- **Chunky, tactile controls.** Pill buttons 36 px tall, a 1.5 px ink outline on secondary buttons, and a small hard offset shadow (`2px 2px 0 ink`) that pushes in on press. Cards have 16 px corners, no blur, no glass, no gradients.
- **Type with character.** *Bricolage Grotesque* for titles and numbers; *Geist* for text (14 px body instead of 13); *Geist Mono* for selectors and code. Titles are bigger and tighter, so screens get a clear hierarchy instead of everything being 12–13 px.
- **Plain, human copy and small moments.** A short celebratory state when a run finishes ("24 rows saved"), friendly empty states with one line and one button, motion of 150–200 ms only on press, open and appear, and `prefers-reduced-motion` honoured.
- **Status colours** are tuned to sit with lime: success `#12A150`, warning `#E58A00`, danger `#E5484D`, info `#2F7CF6`, with matching soft fills for chips.

Tokens (`index.css`, light and dark): `bg`, `surface`, `surface-2`, `ink`, `ink-2`, `ink-3`, `line`, `line-strong`, `brand`, `on-brand`, `primary`, `on-primary`, five tile pastels, four status colours with `-soft` fills, `radius-sm/md/lg/pill`, `shadow-press`, `shadow-pop`, and `font-display/sans/mono`. The old `--cp-*` names become aliases during the move and are deleted at the end.

This departs from the website's navy and amber "Daylight" look. Options: keep both (the extension has its own personality), or move the website later. The plan assumes the extension leads.

## 5. Steps

Each step builds, passes the unit tests and the e2e suite, and gets screenshots in light and dark (`UX_SHOTS=… UX_MODES=light,dark`).

| Step | What | Size |
|---|---|---|
| **D1** | Tokens and fonts in `index.css`; the kit (§3) with unit tests for Dialog, Menu, Select and Segmented behaviour; the Kit view. Nothing on screen changes yet. | M |
| **D2** | Look review on the Kit view and on Home rebuilt with the kit: confirm the direction before moving everything. | S |
| **D3** | Shell and Home: `App`, `Header`, `ToolHeader`, `PageStrip`, `WizardLayout`, `HomePage`, `WelcomePage`, `SettingsPage`. | M |
| **D4** | List flow: `QuickRun`, wizard steps 1–3, `SelectorCard`, `FieldEditor`, `NextButtonCard`, `ExtractionStatusBar`, `SelectorEditDialog`. | L |
| **D5** | My data and the table: `HistoryPage`, `DataCard`, `RerunDialog`, `JobDetailsDialog`, `DataTablePage`, `DataTable`, `ColumnHeader`, `ColumnCleanDialog`, `SchemaMapDialog`, `MarkdownPreview`, `gridTheme`. | L |
| **D6** | The other tools: many pages (`PageExtractorPage`, `DetailsChoice`, `AiSchemaDialog`, `SiteDiscoveryDialog`), images (`ImageDownloaderPage` and `images/*`), `AiExtractPage`, summarizer, `UtilitiesPage`, Toolkit (`ToolkitPage`, `toolkit/*`). | L |
| **D7** | Remove MUI and Emotion from `package.json` and the `vendor-mui` chunk; delete `muiTheme.ts`, the old `.btn/.card/.badge` CSS, `components/ui/{Button,Input,Card,Badge,Select,LoadingSpinner}`; switch on `check-design`; compare bundle sizes. | S |

## 6. Measure of done

- `@mui` and `@emotion` are absent from `package.json` and `src`; the check passes.
- The side panel's start bundle is at least 300 KB smaller (measured from `dist/assets`).
- Changing `--radius-md`, `--brand` or `Button`'s classes changes every screen, checked on the Kit view and in screenshots.
- All unit and e2e tests pass. Specs that find elements by MUI class names are updated to use roles or text.
- Keyboard: Tab reaches every control, a focus ring is visible, Esc closes dialogs and menus, and contrast is at least 4.5:1 for text in both modes.

## 7. Risks

- **Size of the move.** About 7,400 lines in 47 files. Steps D3 to D6 go screen by screen, so the app works with mixed MUI and kit components until D7.
- **Behaviour MUI gave for free.** Focus trap, scroll lock, menu positioning and keyboard handling: the native `<dialog>` and a small positioning helper cover them, with unit tests in D1.
- **e2e selectors** that rely on MUI markup (`.MuiChip-label`, `role="combobox"` from MUI Select): these are found and fixed in each step.
