# Lead enrichment and live Google Sheets sync

Status: 2026-10-19. Sheets **built** (S1 + S2) the user's-own-script way; lead enrichment planned.

## 1. Lead enrichment ("Contacts from websites")

### Today

The Email Extractor is a "Coming soon" screen (`EmailExtractorPage.tsx`).

### What it does

The user gives a list of company websites:
- pasted (one per line: URLs or bare domains);
- a column of a dataset in My data, such as a List Extractor run over a directory or search results;
- or just the current page.

For each company it finds contact details and returns one row:

| Column | From |
|---|---|
| Website, Company | The URL; `og:site_name`, JSON-LD `Organization.name`, or the title |
| Email (best) | One email chosen: on the company's own domain, a role address first (`info@`, `contact@`, `hello@`, `sales@`), then a person's |
| All emails | Every email found, deduplicated, own-domain ones first |
| Phone | `tel:` links, JSON-LD `telephone` |
| LinkedIn, X/Twitter, Facebook, Instagram, YouTube, TikTok, GitHub | Links in the page and JSON-LD `sameAs`, normalised to the profile URL (share and intent links dropped) |
| Address | JSON-LD `PostalAddress` |
| Contact page | The page where the best email was found |
| Pages read | How many pages of the site were read |

### How

- **One URL per company in a bulk run.** This reuses the tab pool, background tabs, per-site pacing, stop, retry, verdicts and live preview. It's a new `RunJob`, `enrichJob`, next to `metadataJob`.
- **Reading a site, in the content script:**
  1. The homepage, rendered in the run tab.
  2. Up to 3 more pages from the same site, chosen from the homepage's links by their words: contact, about, team, impressum, imprint, kontakt, legal, support. They're fetched (`fetch` with the user's cookies) and parsed with `DOMParser`, without opening them, so it's fast.
  3. A contact page that is empty without its scripts is opened in the tab instead. This covers JavaScript-only sites.
- **Finding emails:**
  - `mailto:` links;
  - text that looks like an address;
  - written-out forms ("name [at] domain [dot] com", "name(at)domain.com");
  - Cloudflare-hidden addresses (`data-cfemail`, decoded);
  - JSON-LD `email`.
- **Leaving out junk:** image names that look like emails (`logo@2x.png`), example and placeholder domains, tracking and service addresses (sentry, wixpress, `noreply`). Addresses on other domains are kept, ranked last.
- **Courtesy:** at most 4 pages per site, one site at a time per host (the existing per-host gap), and pages a site blocks are skipped. No guessed addresses: only what the site publishes.

### Screen

The Email Extractor becomes **"Contacts from websites"**:
- **"This page":** contacts found on the current page, at once.
- **"A list of websites":** paste or pick a dataset column, choose how many tabs at a time (the machine-aware default), then Run.
- **Progress:** as in the other runs.
- **Results:** a table in My data ("Contacts: 120 websites"), with a filter for "Only own-domain emails".

### Phases

| Phase | What |
|---|---|
| L1 | Finding contacts on one page (`content/services/contacts/`): emails, phones, social links and address from the DOM and JSON-LD, with the junk filter. Unit tests on saved pages and fixtures. "This page" on the screen. |
| L2 | The bulk run over a site's pages (`enrichJob`, contact-page discovery, fetch + parse, JavaScript fallback). The "A list of websites" screen, with input pasted or taken from a dataset column. e2e on a fake mini-site served by the test server. |
| L3 | Ranking the best email, normalising and deduplicating social profiles, the "own domain only" filter, and the column order in My data. |

## 2. Live Google Sheets sync

**Decided (2026-10-19): no CrawlPilot Google account.** Each user connects their own spreadsheet with an Apps Script that CrawlPilot generates (option c below). There is no OAuth client and no Google Cloud project. The OAuth sections below were the alternatives considered.

**Built:**
- **The script and the connection** (`shared/integrations/sheets.ts`):
  - the generated script, with a secret key only this user's CrawlPilot knows;
  - the script writes a tab per dataset, adds new columns to the right, and uses a lock against overlapping writes;
  - the connection test and sending in batches of 500, with plain-words errors (for example "Deploy it with Who has access: Anyone").
- **Sync** (`shared/integrations/sheetsSync.ts`):
  - **Send to Google Sheets** from the data table's export menu writes every row and switches on syncing;
  - after that, `tables.appendRows` queues a sync, so rows any tool adds follow;
  - rows sent are counted on the dataset after each batch, so a cut-short sync resumes;
  - failures are kept on the dataset and shown with "Try again".
- **Screens:**
  - Settings → Integrations → Google Sheets: setup steps, "Copy script", Connect (asks Chrome for access to Google's script addresses), and once connected Open, Disconnect and "Use another spreadsheet";
  - the data table: a bar with the rows in the sheet, its tab, Open, and Stop or Sync again.
- **Tests:** unit tests in `sheetsSync.test.ts`; e2e in `e2e/sheets.spec.ts`, with a fake web app served by `harness.ts`.

### Today

Settings shows a disabled "Connect Google Sheets" button (`integrations.googleSheetsConnected` is never set).

### What it does

- **Send to Google Sheets** in the data table's export menu creates a spreadsheet named after the dataset, with a header row and every row.
- **Keep in sync** on that dataset: every later run writing to it (a re-run, a scheduled run, a List Extractor page) appends its new rows to the same sheet. New columns are added to the right; existing rows are never rewritten.
- **Settings → Integrations:** "Connect Google account" and "Disconnect", plus the list of synced datasets and their sheets (open, stop syncing).

### How

- **Sign-in:** Chrome's `chrome.identity`, with the scope `https://www.googleapis.com/auth/drive.file`. CrawlPilot can then only see and edit spreadsheets it created. That is a non-sensitive scope, so Google's security review isn't needed. It also means CrawlPilot can't write into a sheet the user made by hand (see the questions below).
- **Writing:** Sheets API v4:
  - `spreadsheets.create`;
  - `values.append` in batches of 500 rows;
  - `values.update` for the header when columns are added.

  The sheet's id is kept on the table (`Table.view.sheet = { id, url, syncedRows }`).
- **Sync:** the background appends the rows saved since `syncedRows` after each preview save and at the end of a run. It retries with backoff when rate limited (60 requests a minute per user), and shows a "Sync paused" notice when sign-in has expired.
- **Permissions:** `identity` in the manifest, and an `oauth2` block if the Chrome-only sign-in is used.

### What you need to set up (not something I can do)

1. A Google Cloud project with the **Google Sheets API** enabled.
2. An **OAuth consent screen** (app name, support email, the `drive.file` scope). Testing mode allows 100 test users; publishing needs brand verification, which is light for non-sensitive scopes.
3. An **OAuth client**: either
   - a "Chrome extension" client tied to the extension's ID (for `getAuthToken`), or
   - a "Web application" client with the redirect `https://<extension-id>.chromiumapp.org/` (for `launchWebAuthFlow`).

   The extension needs a fixed ID: the Web Store's, or a `key` in `manifest.json` for development.

### Phases

| Phase | What |
|---|---|
| S1 | Sign-in (connect, disconnect, silent token renewal), and "Send to Google Sheets" from the data table: create the sheet and write all rows. |
| S2 | "Keep in sync": appending new rows after runs, new columns, rate limits, expired sign-in, and the list of synced datasets in Settings. |

## Open questions

1. **Sheets sign-in**, with its trade-offs:
   - **(a)** `launchWebAuthFlow` with a Web client: works in Chrome, Edge and Brave without Chrome sign-in, but the user signs in to Google again about once an hour, silently when possible.
   - **(b)** `getAuthToken`: the smoothest, but Chrome only, needs Chrome sign-in, and needs the extension's fixed ID.
   - **(c)** No Google Cloud setup at all: a Google Apps Script the user pastes into their own sheet, which receives rows like the existing webhook. It can write to any sheet, but setup is manual.
2. Do you already have a Google Cloud project and OAuth client for CrawlPilot (the site's sign-in, for example)?
