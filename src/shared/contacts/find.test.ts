import { describe, it, expect } from 'vitest';
import { decodeCfEmail, findContacts, isRealEmail, mergeContacts, rankEmails, siteDomain, socialProfile } from './find';

const page = (html: string) => new DOMParser().parseFromString(`<!doctype html><html><head><title>Acme Tools | Home</title></head><body>${html}</body></html>`, 'text/html');

describe('finding contacts on a page', () => {
    it('emails from links, text, written-out forms, Cloudflare and JSON-LD; junk left out', () => {
        // "info@acme.co" hidden by Cloudflare with key 0x42.
        const cf = '42' + [...'info@acme.co'].map(c => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
        const doc = page(`
            <a href="mailto:Sales@Acme.co?subject=Hi">Email sales</a>
            <p>Write to jane.doe@acme.co or press [at] acme [dot] co. Our office is in London.</p>
            <a href="/cdn-cgi/l/email-protection#${cf}">[email protected]</a>
            <img src="logo@2x.png"><p>logo@2x.png you@example.com noreply@acme.co</p>
            <script>var dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/1"; var x = "hidden@script.com";</script>
            <script type="application/ld+json">{"@type":"Organization","name":"Acme Tools Ltd","email":"hello@acme.co","telephone":"+44 20 7946 0000",
              "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"London","postalCode":"N1 1AA","addressCountry":"GB"},
              "sameAs":["https://www.linkedin.com/company/acme-tools/","https://twitter.com/acmetools"]}</script>`);
        const c = findContacts(doc, 'https://acme.co/');
        expect(c.emails.sort()).toEqual(['hello@acme.co', 'info@acme.co', 'jane.doe@acme.co', 'press@acme.co', 'sales@acme.co']);
        expect(c.phones).toEqual(['+442079460000']);
        expect(c.name).toBe('Acme Tools Ltd');
        expect(c.address).toBe('1 Main St, London, N1 1AA, GB');
        expect(c.socials).toEqual({ linkedin: 'https://linkedin.com/company/acme-tools', x: 'https://x.com/acmetools' });
    });

    it('social profiles, not share links or posts; contact pages ranked', () => {
        const doc = page(`
            <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
            <a href="https://www.facebook.com/AcmeTools?ref=footer">Facebook</a>
            <a href="https://www.instagram.com/p/Cx1/">a post</a><a href="https://instagram.com/acme.tools/">Instagram</a>
            <a href="https://www.youtube.com/@acmetools/videos">YouTube</a>
            <a href="/about-us">About</a><a href="/contact">Contact us</a><a href="/blog/post-1">Blog</a><a href="https://other.com/contact">Other</a>
            <a href="tel:+1 (555) 010-9999">Call</a>`);
        const c = findContacts(doc, 'https://www.acme.co/');
        expect(c.socials).toEqual({ facebook: 'https://facebook.com/AcmeTools', instagram: 'https://instagram.com/acme.tools', youtube: 'https://youtube.com/@acmetools' });
        expect(c.contactLinks).toEqual(['https://www.acme.co/contact', 'https://www.acme.co/about-us']);
        expect(c.phones).toEqual(['+15550109999']);
        expect(c.name).toBe('Home');
    });

    it('ranks own-domain role addresses first; knows a site domain', () => {
        expect(rankEmails(['jane@acme.co.uk', 'acme@gmail.com', 'sales@acme.co.uk', 'info@shop.acme.co.uk'], 'www.acme.co.uk'))
            .toEqual(['info@shop.acme.co.uk', 'sales@acme.co.uk', 'jane@acme.co.uk', 'acme@gmail.com']);
        expect(siteDomain('shop.acme.co.uk')).toBe('acme.co.uk');
        expect(siteDomain('www.acme.com')).toBe('acme.com');
        expect(isRealEmail('a1b2c3d4e5f60718293a4b5c6d7e8f90@sentry.io')).toBe(false);
        expect(decodeCfEmail('zz')).toBe('');
        expect(socialProfile('https://x.com/intent/tweet?text=hi')).toBeNull();
    });

    it('merges a site\'s pages: each email once, with the page it was found on', () => {
        const home = findContacts(page('<a href="mailto:info@acme.co">x</a>'), 'https://acme.co/');
        const contact = findContacts(page('<p>info@acme.co, sales@acme.co</p><a href="https://github.com/acme">GitHub</a>'), 'https://acme.co/contact');
        const all = mergeContacts([home, contact]);
        expect(all.emails).toEqual(['info@acme.co', 'sales@acme.co']);
        expect(all.emailPages).toEqual({ 'info@acme.co': 'https://acme.co/', 'sales@acme.co': 'https://acme.co/contact' });
        expect(all.socials.github).toBe('https://github.com/acme');
    });
});
