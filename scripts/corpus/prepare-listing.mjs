/**
 * Turns a saved listing page into a corpus fixture (`src/test/fixtures/corpus/<name>.html.gz`):
 *
 * - scripts removed, except JSON data (`application/ld+json`, `application/json`): saved pages would
 *   otherwise boot their apps;
 * - stylesheets **kept and inlined** (fetched once, `url()` made absolute), unlike the older corpus
 *   pages: hidden text is told apart by how it renders (clipped, 1 px), and the picker needs real layout;
 * - iframes, preloads and prefetches removed;
 * - a `<base href>` for the site, so links and images resolve to the real site.
 *
 * Usage: node scripts/corpus/prepare-listing.mjs <saved.html> <https://site.origin/page> <name>
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const [input, pageUrl, name] = process.argv.slice(2);
if (!input || !pageUrl || !name) {
    console.error('Usage: node scripts/corpus/prepare-listing.mjs <saved.html> <page url> <name>');
    process.exit(1);
}

let html = fs.readFileSync(input, 'utf8');
const base = new URL(pageUrl);

const absolutize = (css, from) => css.replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g, (_, q, u) => {
    try { return `url(${q}${new URL(u, from).href}${q})`; } catch { return _; }
});

// Scripts, except JSON data.
html = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (whole, attrs) => (/type=["']application\/(ld\+)?json["']/i.test(attrs) ? whole : ''));
html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/<iframe\b[^>]*\/?>/gi, '');
html = html.replace(/<link\b[^>]*rel=["'](?:preload|prefetch|modulepreload|preconnect|dns-prefetch)["'][^>]*>/gi, '');

// Stylesheets, inlined.
const links = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map(m => m[0]);
let inlined = 0;
for (const link of links) {
    const href = /href=["']([^"']+)["']/i.exec(link)?.[1];
    if (!href) continue;
    const url = new URL(href.replace(/&amp;/g, '&'), base).href;
    try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const css = absolutize(await res.text(), url);
        html = html.replace(link, () => `<style data-from="${url}">${css}</style>`);
        inlined++;
    } catch (e) {
        console.warn(`Stylesheet not inlined (${e.message}): ${url}`);
        html = html.replace(link, '');
    }
}

// Links and images resolve to the real site.
html = html.replace(/<base\b[^>]*>/gi, '');
html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base.origin}/">`);

const out = path.join('src/test/fixtures/corpus', `${name}.html.gz`);
fs.writeFileSync(out, gzipSync(html, { level: 9 }));
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB gzipped, ${inlined}/${links.length} stylesheets inlined`);
