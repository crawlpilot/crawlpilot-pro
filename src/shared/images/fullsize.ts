/**
 * Where the full-size original of a resized image probably is. Image CDNs put the size in the URL
 * (`_300x300`, `-300x200.jpg`, `w_300`, `?w=300`, `._AC_SX300_`); taking it out, or asking for the
 * largest size, usually gives the original. These are guesses: every candidate is checked by
 * fetching its first bytes (`probe.ts`) before it is used, so a rule that no longer matches a CDN
 * costs a request, never a wrong file.
 *
 * Each rule is a pure function of the URL: it returns the rewritten URL or `null` when it doesn't
 * apply. `fullSizeCandidates` returns every distinct rewrite, most specific rule first.
 */

interface Rule {
    name: string;
    rewrite: (url: URL) => string | null;
}

const IMAGE_EXT = '(jpe?g|png|gif|webp|avif)';

/** A copy of `url` with these query parameters removed; `null` if none was there. */
function withoutParams(url: URL, names: string[]): string | null {
    const copy = new URL(url.href);
    let removed = false;
    for (const name of names) if (copy.searchParams.has(name)) { copy.searchParams.delete(name); removed = true; }
    return removed ? copy.href.replace(/\?$/, '') : null;
}

function withPath(url: URL, pathname: string): string | null {
    if (pathname === url.pathname) return null;
    const copy = new URL(url.href);
    copy.pathname = pathname;
    return copy.href;
}

function withQuery(url: URL, set: Record<string, string>): string | null {
    const copy = new URL(url.href);
    for (const [k, v] of Object.entries(set)) copy.searchParams.set(k, v);
    return copy.href === url.href ? null : copy.href;
}

const hostIs = (url: URL, ...hosts: string[]) => hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));

/** Size and crop parameters many image services take. */
const SIZE_PARAMS = ['w', 'h', 'width', 'height', 'fit', 'crop', 'resize', 'size', 'max-w', 'max-h', 'maxwidth', 'maxheight', 'dpr', 'q', 'quality', 'rect', 'cs', 'auto', 'fm', 'format', 'ixlib', 'ixid', 'sw', 'sh', 'scale', 'mode', 'odnHeight', 'odnWidth', 'odnBg', 'imwidth', 'impolicy', 'tr'];

export const RULES: Rule[] = [
    {
        name: 'shopify',
        rewrite: url => hostIs(url, 'shopify.com', 'shopifycdn.com') || url.pathname.includes('/cdn/shop/')
            ? (withPath(url, url.pathname.replace(new RegExp(`_(\\d+x\\d*|\\d*x\\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(_crop_[a-z]+)?(@\\dx)?\\.${IMAGE_EXT}$`, 'i'), '.$4'))
                ?? withoutParams(url, ['width', 'height', 'crop']))
            : null,
    },
    {
        name: 'wordpress',
        rewrite: url => {
            if (hostIs(url, 'wp.com')) return withoutParams(url, ['resize', 'fit', 'w', 'h', 'ssl', 'quality', 'strip', 'crop']);
            return url.pathname.includes('/wp-content/')
                ? withPath(url, url.pathname.replace(new RegExp(`-\\d+x\\d+\\.${IMAGE_EXT}$`, 'i'), '.$1'))
                : null;
        },
    },
    {
        name: 'cloudinary',
        rewrite: url => {
            if (!hostIs(url, 'cloudinary.com') && !url.pathname.includes('/image/upload/')) return null;
            const [before, after] = url.pathname.split('/image/upload/');
            if (after === undefined) return null;
            const parts = after.split('/');
            const transform = /^[a-z]{1,3}_[^/]+$/;
            let i = 0;
            while (i < parts.length - 1 && parts[i].split(',').every(p => transform.test(p))) i++;
            return i ? withPath(url, `${before}/image/upload/${parts.slice(i).join('/')}`) : null;
        },
    },
    {
        name: 'amazon',
        rewrite: url => hostIs(url, 'media-amazon.com', 'ssl-images-amazon.com', 'images-amazon.com')
            ? withPath(url, url.pathname.replace(new RegExp(`\\._[^/]*_\\.${IMAGE_EXT}$`, 'i'), '.$1'))
            : null,
    },
    {
        name: 'wix',
        rewrite: url => {
            if (!hostIs(url, 'wixstatic.com')) return null;
            const m = /^(\/media\/[^/]+)\/v1\//.exec(url.pathname);
            return m ? withPath(url, m[1]) : null;
        },
    },
    {
        name: 'squarespace',
        rewrite: url => hostIs(url, 'squarespace-cdn.com', 'squarespace.com') ? withQuery(url, { format: '2500w' }) : null,
    },
    {
        name: 'pinterest',
        rewrite: url => hostIs(url, 'pinimg.com') ? withPath(url, url.pathname.replace(/^\/(\d+x\d*|\d*x\d+)\//, '/originals/')) : null,
    },
    {
        name: 'twitter',
        rewrite: url => {
            if (!hostIs(url, 'twimg.com')) return null;
            const m = new RegExp(`^(.*)\\.${IMAGE_EXT}(:\\w+)?$`).exec(url.pathname);
            if (m) { const copy = new URL(url.href); copy.pathname = m[1]; copy.search = `?format=${m[2]}&name=orig`; return copy.href; }
            return url.searchParams.has('name') ? withQuery(url, { name: 'orig' }) : null;
        },
    },
    {
        name: 'etsy',
        rewrite: url => hostIs(url, 'etsystatic.com') ? withPath(url, url.pathname.replace(/\/il_\d+x\d+\./, '/il_fullxfull.')) : null,
    },
    {
        name: 'ebay',
        rewrite: url => hostIs(url, 'ebayimg.com') ? withPath(url, url.pathname.replace(new RegExp(`/s-l\\d+\\.${IMAGE_EXT}$`, 'i'), '/s-l1600.$1')) : null,
    },
    {
        name: 'flickr',
        rewrite: url => hostIs(url, 'staticflickr.com') ? withPath(url, url.pathname.replace(/_[sqtmnwzc]\.(jpg|png)$/, '_b.$1')) : null,
    },
    {
        name: 'google',
        rewrite: url => {
            if (!hostIs(url, 'googleusercontent.com', 'ggpht.com', 'blogspot.com', 'bp.blogspot.com')) return null;
            const sized = url.pathname.replace(/=[swh]\d+[^/]*$/, '=s0');
            return withPath(url, sized !== url.pathname ? sized : url.pathname.replace(/\/[swh]\d+(-[a-z0-9-]+)?\//, '/s0/'));
        },
    },
    {
        name: 'youtube',
        rewrite: url => hostIs(url, 'ytimg.com') ? withPath(url, url.pathname.replace(/\/(default|mqdefault|hqdefault|sddefault|hq720)\.jpg$/, '/maxresdefault.jpg')) : null,
    },
    {
        name: 'medium',
        rewrite: url => hostIs(url, 'medium.com') ? withPath(url, url.pathname.replace(/\/resize:[^/]+\//, '/').replace(/\/max\/\d+\//, '/max/4096/')) : null,
    },
    {
        name: 'gravatar',
        rewrite: url => hostIs(url, 'gravatar.com') ? withQuery(url, { s: '2048' }) : null,
    },
    {
        // Any host: a `-300x200` suffix (WordPress-style themes on other hosts) and size parameters.
        name: 'generic',
        rewrite: url => withoutParams(url, SIZE_PARAMS) ?? withPath(url, url.pathname.replace(new RegExp(`[-_]\\d{2,4}x\\d{2,4}\\.${IMAGE_EXT}$`, 'i'), '.$1')),
    },
];

export interface FullSizeCandidate { url: string; rule: string }

export function fullSizeCandidates(src: string): FullSizeCandidate[] {
    let url: URL;
    try { url = new URL(src); } catch { return []; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    const out: FullSizeCandidate[] = [];
    const seen = new Set([src]);
    for (const rule of RULES) {
        let rewritten: string | null = null;
        try { rewritten = rule.rewrite(url); } catch { /* malformed for this rule */ }
        if (rewritten && !seen.has(rewritten)) { seen.add(rewritten); out.push({ url: rewritten, rule: rule.name }); }
    }
    return out;
}
