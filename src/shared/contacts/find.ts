/**
 * Contacts on a web page (docs/plans/leads-and-sheets-plan.md §1): email addresses, phone numbers,
 * social profiles, the company's name and address, and links to the site's contact pages. Works on any
 * Document: the live page, or one fetched and parsed (`DOMParser`), so it runs in the content script
 * and in tests alike. Only what the site publishes; nothing is guessed.
 */

export type Social = 'linkedin' | 'x' | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'github';

export interface Contacts {
    emails: string[];
    phones: string[];
    socials: Partial<Record<Social, string>>;
    name?: string;
    address?: string;
    /** Same-site links to pages likely to have contact details, best first. */
    contactLinks: string[];
    /** Email → the page it was first found on. */
    emailPages?: Record<string, string>;
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.[a-z]{2,24}/gi;
/** One whole address. */
const EMAIL_ONE = new RegExp(`^${EMAIL.source}$`, 'i');
/** "name [at] domain [dot] com", "name(at)domain.com", "name at domain dot com". */
const WRITTEN = /([a-z0-9._%+-]{1,64})\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([a-z0-9-]+(?:(?:\s*(?:\[dot\]|\(dot\)|\{dot\})\s*|\s+dot\s+|\.(?=[a-z0-9]))[a-z0-9-]+)+)/gi;
const JUNK_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.\w+|yoursite\.\w+|company\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|sentry\.wixpress\.com|test\.com|placeholder\.\w+)$/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|example|test|user|name|email|you|your\.?name)$/i;
const FILE_LIKE = /\.(png|jpe?g|gif|webp|svg|avif|ico|css|js)$/i;

/** An address worth keeping: a real-looking domain, not an image name, a placeholder or a tracker. */
export function isRealEmail(email: string): boolean {
    const [local, domain] = email.split('@');
    if (!local || !domain) return false;
    if (FILE_LIKE.test(email) || /@\d+x\./.test(email)) return false;
    if (JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) return false;
    // Error trackers' keys (32 hex characters) and generated ids.
    if (/^[a-f0-9]{16,}$/i.test(local)) return false;
    return true;
}

function cleanEmail(raw: string): string {
    return raw.trim().replace(/^mailto:/i, '').split('?')[0].replace(/[.,;:)]+$/, '').toLowerCase();
}

/** Cloudflare's hidden address (`data-cfemail` / `/cdn-cgi/l/email-protection#…`): hex, the first byte the key. */
export function decodeCfEmail(hex: string): string {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return '';
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
}

const SOCIAL: { key: Social; host: RegExp; path: RegExp; skip?: RegExp }[] = [
    { key: 'linkedin', host: /(^|\.)linkedin\.com$/, path: /^\/(company|in|school|showcase)\/[^/]+/ },
    { key: 'x', host: /(^|\.)(twitter|x)\.com$/, path: /^\/[A-Za-z0-9_]{1,15}\/?$/, skip: /^\/(intent|share|home|hashtag|i|search|login|signup|explore|settings)\b/ },
    { key: 'facebook', host: /(^|\.)facebook\.com$/, path: /^\/[^/?#]+/, skip: /^\/(sharer|share|dialog|plugins|tr|login|privacy|policies|help)\b/ },
    { key: 'instagram', host: /(^|\.)instagram\.com$/, path: /^\/[A-Za-z0-9_.]+\/?$/, skip: /^\/(p|reel|explore|accounts|stories)\b/ },
    { key: 'youtube', host: /(^|\.)youtube\.com$/, path: /^\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)/ },
    { key: 'tiktok', host: /(^|\.)tiktok\.com$/, path: /^\/@[^/]+/ },
    { key: 'github', host: /^github\.com$/, path: /^\/[A-Za-z0-9-]+\/?$/, skip: /^\/(features|pricing|login|sponsors|about|enterprise)\b/ },
];

/** A social profile's address (the profile itself: no query, no post), or null when the link isn't one. */
export function socialProfile(href: string): { key: Social; url: string } | null {
    let u: URL;
    try { u = new URL(href); } catch { return null; }
    const host = u.hostname.replace(/^(www|m|mobile)\./, '');
    for (const s of SOCIAL) {
        if (!s.host.test(host)) continue;
        if (s.skip?.test(u.pathname)) return null;
        const m = s.path.exec(u.pathname);
        if (!m) return null;
        return { key: s.key, url: `https://${host === 'twitter.com' ? 'x.com' : host}${m[0].replace(/\/$/, '')}` };
    }
    return null;
}

const CONTACT_WORDS: [RegExp, number][] = [
    [/contact|kontakt|contacto|contatto|get-in-touch|reach-us|enquir|inquir/i, 0],
    [/impressum|imprint|legal-notice|mentions-legales/i, 1],
    [/about|team|company|who-we-are|uber-uns|ueber-uns/i, 2],
    [/support|help|locations|offices/i, 3],
];

function* jsonLd(doc: Document): Generator<any> {
    for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
        let data: unknown;
        try { data = JSON.parse(s.textContent || ''); } catch { continue; }
        const stack = [data];
        while (stack.length) {
            const node: any = stack.pop();
            if (Array.isArray(node)) stack.push(...node);
            else if (node && typeof node === 'object') {
                yield node;
                for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
            }
        }
    }
}

const ORG = /^(Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|LegalService|MedicalBusiness|NGO|EducationalOrganization|.*Business)$/;

function addressOf(a: any): string | undefined {
    if (!a) return undefined;
    if (typeof a === 'string') return a.trim() || undefined;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry];
    const s = parts.filter(p => typeof p === 'string' && p.trim()).join(', ');
    return s || undefined;
}

function phoneOf(raw: string): string {
    const s = raw.replace(/^tel:/i, '').split('?')[0];
    const decoded = (() => { try { return decodeURIComponent(s); } catch { return s; } })();
    const plus = decoded.trim().startsWith('+');
    const digits = decoded.replace(/[^\d]/g, '');
    return digits.length >= 6 && digits.length <= 15 ? `${plus ? '+' : ''}${digits}` : '';
}

/** The page's text without scripts and styles (trackers' keys and code live there). */
function visibleText(doc: Document): string {
    if (!doc.body) return '';
    const out: string[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.parentElement?.closest('script, style, noscript, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.textContent || '');
    return out.join(' ').replace(/\u00a0/g, ' ');
}

/** The contacts on `doc`, read from `pageUrl`. */
export function findContacts(doc: Document, pageUrl: string): Contacts {
    const emails = new Set<string>();
    const phones = new Set<string>();
    const socials: Partial<Record<Social, string>> = {};
    let name: string | undefined;
    let address: string | undefined;
    const add = (raw: string) => { const e = cleanEmail(raw); if (EMAIL_ONE.test(e) && isRealEmail(e)) emails.add(e); };

    let base: URL | null = null;
    try { base = new URL(pageUrl); } catch { /* links stay relative */ }
    const links: { url: string; rank: number }[] = [];

    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') || '';
        if (/^mailto:/i.test(href)) { add(decodeURIComponent(href.replace(/^mailto:/i, '')).split(',')[0]); continue; }
        if (/^tel:/i.test(href)) { const p = phoneOf(href); if (p) phones.add(p); continue; }
        const cf = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(href);
        if (cf) { add(decodeCfEmail(cf[1])); continue; }
        let abs: URL;
        try { abs = new URL(href, base ?? undefined); } catch { continue; }
        const social = socialProfile(abs.href);
        if (social) { socials[social.key] ??= social.url; continue; }
        // Same-site pages likely to hold contacts, by their address or words.
        if (base && abs.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '') && abs.pathname !== base.pathname) {
            const words = `${abs.pathname} ${a.textContent || ''}`;
            const hit = CONTACT_WORDS.find(([re]) => re.test(words));
            if (hit) links.push({ url: `${abs.origin}${abs.pathname}`, rank: hit[1] });
        }
    }
    for (const el of Array.from(doc.querySelectorAll('[data-cfemail]'))) add(decodeCfEmail(el.getAttribute('data-cfemail') || ''));

    const text = visibleText(doc);
    for (const m of text.matchAll(EMAIL)) add(m[0]);
    for (const m of text.matchAll(WRITTEN)) {
        const domain = m[2].replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*/gi, '.').replace(/\s+/g, '');
        if (/\.[a-z]{2,24}$/i.test(domain)) add(`${m[1]}@${domain}`);
    }

    for (const node of jsonLd(doc)) {
        const types = [node['@type']].flat().filter((t: unknown): t is string => typeof t === 'string');
        if (typeof node.email === 'string') add(node.email);
        if (typeof node.telephone === 'string') { const p = phoneOf(node.telephone); if (p) phones.add(p); }
        for (const same of [node.sameAs].flat()) if (typeof same === 'string') { const s = socialProfile(same); if (s) socials[s.key] ??= s.url; }
        if (types.some(t => ORG.test(t))) {
            name ??= typeof node.name === 'string' ? node.name.trim() : undefined;
            address ??= addressOf(node.address);
        }
    }
    name ??= doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()
        || (doc.title || '').split(/\s[|–—-]\s/).map(s => s.trim()).filter(Boolean).pop();

    const contactLinks = [...new Map(links.sort((a, b) => a.rank - b.rank).map(l => [l.url, l])).keys()].slice(0, 6);
    const list = [...emails];
    return { emails: list, phones: [...phones], socials, ...(name ? { name } : {}), ...(address ? { address } : {}), contactLinks, emailPages: Object.fromEntries(list.map(e => [e, pageUrl])) };
}

/** A site's contacts as the content script reads them (`content/services/contacts/site.ts`). */
export interface SiteContacts {
    contacts: Contacts;
    pages: string[];
    /** Pages that had almost no text when fetched: built by script, to be opened instead. */
    thin: string[];
}

/** Contacts from several pages of one site as one. */
export function mergeContacts(parts: Contacts[]): Contacts {
    const out: Contacts = { emails: [], phones: [], socials: {}, contactLinks: [], emailPages: {} };
    for (const p of parts) {
        for (const e of p.emails) if (!out.emails.includes(e)) { out.emails.push(e); out.emailPages![e] = p.emailPages?.[e] ?? ''; }
        for (const ph of p.phones) if (!out.phones.includes(ph)) out.phones.push(ph);
        for (const [k, v] of Object.entries(p.socials) as [Social, string][]) out.socials[k] ??= v;
        out.name ??= p.name;
        out.address ??= p.address;
        for (const l of p.contactLinks) if (!out.contactLinks.includes(l)) out.contactLinks.push(l);
    }
    return out;
}

/** The site's own domain, for telling its addresses from others ("shop.acme.co.uk" → "acme.co.uk"). */
export function siteDomain(host: string): string {
    const parts = host.toLowerCase().replace(/^www\./, '').split('.');
    const twoLevel = /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2] ?? '') && (parts[parts.length - 1] ?? '').length === 2;
    return parts.slice(twoLevel ? -3 : -2).join('.');
}

const ROLES = ['info', 'contact', 'hello', 'sales', 'enquiries', 'inquiries', 'office', 'team', 'hi', 'support', 'admin', 'mail', 'help'];

/** Own-domain addresses first (role addresses in ROLES order, then people), then others. */
export function rankEmails(emails: string[], host: string): string[] {
    const own = siteDomain(host);
    const score = (e: string) => {
        const [local, domain] = e.split('@');
        const mine = domain === own || domain.endsWith(`.${own}`);
        const role = ROLES.indexOf(local);
        return (mine ? 0 : 1000) + (role >= 0 ? role : 100);
    };
    return [...emails].sort((a, b) => score(a) - score(b));
}

export function isOwnDomain(email: string, host: string): boolean {
    const own = siteDomain(host);
    const domain = email.split('@')[1] ?? '';
    return domain === own || domain.endsWith(`.${own}`);
}
