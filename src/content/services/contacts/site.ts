/**
 * A company site's contacts (docs/plans/leads-and-sheets-plan.md §1): this page, then up to `follow`
 * of its contact, about and imprint pages, fetched with the user's cookies and parsed without running
 * them (fast, nothing opened). A page that is empty without its scripts is reported (`thin`) so a run
 * can open it in the tab instead.
 */
import { findContacts, mergeContacts, type Contacts, type SiteContacts } from '../../../shared/contacts/find';


const THIN_CHARS = 300;

export async function siteContacts(follow: number): Promise<SiteContacts> {
    const here = findContacts(document, location.href);
    const parts: Contacts[] = [here];
    const pages = [location.href];
    const thin: string[] = [];
    for (const url of here.contactLinks.slice(0, follow)) {
        try {
            const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10_000) });
            if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) continue;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const found = findContacts(doc, url);
            parts.push(found);
            pages.push(url);
            const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.length < THIN_CHARS && found.emails.length === 0) thin.push(url);
        } catch { /* a page that won't load: the others still count */ }
    }
    return { contacts: mergeContacts(parts), pages, thin };
}
