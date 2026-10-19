/**
 * Contacts from websites (docs/plans/leads-and-sheets-plan.md §1): each URL a company site, opened in
 * a run tab; its contacts read there and from up to `follow` of its contact pages (fetched by the
 * content script). A contact page built by script is opened in the tab and read there instead.
 */
import type { ContactsStart } from '../../shared/messages';
import type { RunJob } from './JobRunner';
import { mergeContacts } from '../../shared/contacts/find';
import { CONTACT_COLUMNS, contactRow } from '../../shared/contacts/row';

/** Until the tab has loaded (or `ms` passed). */
function loaded(tabId: number, ms = 20_000): Promise<void> {
    return new Promise(resolve => {
        const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); };
        const listener = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') done(); };
        const timer = setTimeout(done, ms);
        chrome.tabs.onUpdated.addListener(listener);
    });
}

export function contactsJob(start: ContactsStart): RunJob {
    const follow = Math.max(0, Math.min(start.follow ?? 3, 6));
    const ownOnly = !!start.ownOnly;
    return {
        kind: 'contacts',
        urls: start.urls,
        maxConcurrent: start.maxConcurrent,
        // Gentle by default: a site's pages are read one after another, from a few sites at once.
        settings: { requestDelay: start.requestDelay ?? 500, loadTimeout: 30000 },
        name: start.customName,
        spec: { kind: 'contacts', options: { follow, ...(ownOnly ? { ownOnly } : {}) } },
        tableType: 'contacts',
        columns: () => CONTACT_COLUMNS,

        async extract(tabId, url, ctx) {
            const res = await ctx.message(tabId, 'CMD_FIND_CONTACTS', { follow });
            if (!res.success) throw new Error(res.error || 'The page did not answer.');
            let { contacts, pages } = res;
            const thin = res.thin[0];
            if (contacts.emails.length === 0 && thin && !ctx.stopped()) {
                await chrome.tabs.update(tabId, { url: thin });
                await loaded(tabId);
                const again = await ctx.message(tabId, 'CMD_FIND_CONTACTS', { follow: 0 });
                if (again.success) {
                    contacts = mergeContacts([contacts, again.contacts]);
                    pages = [...pages, thin];
                }
            }
            return { rows: [contactRow(url, contacts, pages, ownOnly)] };
        },
    };
}
