# Syncing with the public extension

CrawlPilot Pro is a fork of `crawlpilot/crawlpilot`. Fixes to selectors, page data and extractors land there first
and are merged in here.

## One-time setup
```sh
git remote add upstream git@github-work:crawlpilot/crawlpilot.git
# Pro code must never reach the public repo: pushes to upstream fail.
git remote set-url --push upstream no-push-to-public-upstream
```

## Each sync
```sh
git fetch upstream
git switch -c sync/upstream-$(date +%Y%m%d)
git merge upstream/main
npm ci --legacy-peer-deps
npx tsc --noEmit -p . && npm test && npm run e2e
```
Then open a PR into `main`.

## What Pro changed in upstream files
Keep this list short, and check these files first when a merge conflicts.
- `manifest.json`: `key` (fixed extension ID), `version`, no `externally_connectable`.
- `public/_locales/*/messages.json`: the name "CrawlPilot Pro" and an internal description.
- `public/icons/*`: the icon with a PRO band.
- `package.json`: name, version, private, the zip name.
- `sidepanel.html` (title) and `src/sidepanel/components/ui/Header.tsx` (brand label).
- `src/sidepanel/App.tsx`, `src/i18n/index.ts`, `src/types/i18next.d.ts`, `e2e/ux-shots.spec.ts`: the welcome
  screen is removed.
- `src/sidepanel/pages/SettingsPage.tsx`: no public support links or feedback form.
- `src/sidepanel/App.tsx`: the `pro-recipes` and `pro-history` routes, the panel opens on Recipes, and the Page Extractor gets `onNavigate`.
- `src/sidepanel/components/ui/Header.tsx`: a Recipes button.
- `src/sidepanel/pages/PageExtractorPage.tsx`, `ListExtractorPage.tsx`: a recipe session from Recipes (`takeProEdit`) loads the version being edited, and the last step is Save version (`PageSave`, `ListSave`) instead of a run. The List Extractor hides its one-click run in a session. Opened from Home, both run as in public.
- `e2e/home.spec.ts`, `e2e/i18n.spec.ts`, `e2e/migration.spec.ts`: open `?view=home`. `e2e/extension.spec.ts`: the panel opens on Recipes.

When upstream changes one of these files, keep the Pro side and take the rest of upstream's change.

## Extension key
The `key` in `manifest.json` fixes the extension ID to `gpehmmoohclacmpomaekjklfncabiiip` on every machine. The
private key (`extension-key.pem`) is never committed. It is needed only to pack a signed `.crx` for policy
installs.
