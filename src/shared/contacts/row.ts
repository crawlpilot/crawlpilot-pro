/** A company's contacts as one row of a dataset (docs/plans/leads-and-sheets-plan.md §1, L3). */
import type { Column } from '../types/database';
import { isOwnDomain, rankEmails, type Contacts, type Social } from './find';

const SOCIALS: [Social, string][] = [
    ['linkedin', 'LinkedIn'], ['x', 'X (Twitter)'], ['facebook', 'Facebook'], ['instagram', 'Instagram'],
    ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['github', 'GitHub'],
];

export const CONTACT_COLUMNS: Column[] = ([
    { id: 'source_url', name: 'Website', type: 'url' },
    { id: 'company', name: 'Company', type: 'text' },
    { id: 'email', name: 'Email', type: 'email' },
    { id: 'emails', name: 'All emails', type: 'text' },
    { id: 'phone', name: 'Phone', type: 'phone' },
    ...SOCIALS.map(([id, name]) => ({ id, name, type: 'url' as const })),
    { id: 'address', name: 'Address', type: 'text' },
    { id: 'email_page', name: 'Email found on', type: 'url' },
    { id: 'pages_read', name: 'Pages read', type: 'number' },
] as Column[]).map((c, order) => ({ ...c, order }));

/**
 * The row: the best email (the site's own, a role address first), every email (own domain first;
 * `ownOnly` keeps only those), the first phone, one profile per network.
 */
export function contactRow(site: string, contacts: Contacts, pages: string[], ownOnly = false): Record<string, string | number> {
    let host = '';
    try { host = new URL(site).hostname; } catch { /* a bare domain */ host = site; }
    const ranked = rankEmails(contacts.emails, host).filter(e => !ownOnly || isOwnDomain(e, host));
    const row: Record<string, string | number> = {
        company: contacts.name ?? '',
        email: ranked[0] ?? '',
        emails: ranked.join('; '),
        phone: contacts.phones[0] ?? '',
        address: contacts.address ?? '',
        email_page: ranked[0] ? contacts.emailPages?.[ranked[0]] ?? '' : '',
        pages_read: pages.length,
    };
    for (const [key] of SOCIALS) row[key] = contacts.socials[key] ?? '';
    return row;
}

/** Website addresses from what the user pasted: URLs or bare domains, one per line (or comma), each once. */
export function parseSites(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.split(/[\n,;\t]+/)) {
        const s = raw.trim().replace(/^["']|["']$/g, '');
        if (!s || /\s/.test(s)) continue;
        let url: URL;
        try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { continue; }
        if (!/\.[a-z]{2,}$/i.test(url.hostname)) continue;
        const home = `${url.protocol}//${url.hostname}${url.pathname === '/' ? '/' : url.pathname}`;
        if (!out.includes(home)) out.push(home);
    }
    return out;
}
