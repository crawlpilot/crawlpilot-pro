/**
 * Bot protection, identified (`docs/design/crawler.md`, Block identification): which vendor guards a site,
 * and whether a response is that vendor's challenge, captcha, block page, rate limit or waiting room.
 * - Evidence: the status, response headers, cookie names (never values), the page's script and frame URLs,
 *   where the navigation went (redirects, final URL), the title and visible text.
 * - A signature is one vendor's mark. `presence` marks say a site uses the vendor: Cloudflare's `__cf_bm`
 *   cookie, DataDome's tag script. They are on every page of such a site, blocked or not, so they are
 *   reported (`protection`) but never make a block. The other kinds make one.
 * - Marks that also show up on ordinary pages (a captcha widget on a login form, "access denied" in a help
 *   text) count only on a suspicious page: an error status, or a short page, as interstitials are.
 * - A finding's confidence: `high` for a vendor's own block marker (a header it sends only when it blocks,
 *   its challenge frame), `medium` for its wording on a suspicious page, `low` for generic wording or a bare
 *   403. Two marks of one vendor make it `high` (not two generic wordings). A generic finding on a site with one known vendor is put
 *   down to that vendor.
 * Identification only: what is found is reported and waited out (`governor.ts`), never worked around.
 */

export type BlockKind = 'presence' | 'challenge' | 'captcha' | 'block' | 'rate_limit' | 'queue' | 'soft_block';
export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
    status?: number;
    /** Names in lower case. */
    headers: Record<string, string>;
    cookies: string[];
    /** Script and frame URLs. */
    resources: string[];
    /** Redirects and the final URL. */
    navigation: string[];
    title: string;
    text: string;
    /** An error status, or a short page: where interstitial marks count. */
    suspicious: boolean;
}

export interface BlockFinding {
    vendor: string;
    kind: Exclude<BlockKind, 'presence'>;
    confidence: Confidence;
    signals: string[];
}

interface Signature {
    vendor: string;
    kind: BlockKind;
    confidence: Confidence;
    signal: string;
    /** Counts only on a suspicious page. */
    suspect?: boolean;
    status?: number[];
    header?: [RegExp, RegExp];
    cookie?: RegExp;
    resource?: RegExp;
    navigation?: RegExp;
    /** The title or the visible text. */
    text?: RegExp;
}

const any = /[\s\S]*/;
const h = (name: string | RegExp, value: RegExp = any): [RegExp, RegExp] => [typeof name === 'string' ? new RegExp(`^${name}$`) : name, value];

/** Generic vendors: not a protection product, and put down to the site's vendor when it has one. */
const GENERIC = new Set(['unknown']);

export const SIGNATURES: Signature[] = [
    // Cloudflare
    { vendor: 'Cloudflare', kind: 'presence', confidence: 'high', signal: 'server: cloudflare', header: h('server', /cloudflare/i) },
    { vendor: 'Cloudflare', kind: 'presence', confidence: 'high', signal: 'cf-ray', header: h('cf-ray') },
    { vendor: 'Cloudflare', kind: 'presence', confidence: 'high', signal: 'Cloudflare cookie', cookie: /^(__cf_bm|cf_clearance|__cflb|_cfuvid)$/ },
    { vendor: 'Cloudflare', kind: 'challenge', confidence: 'high', signal: 'cf-mitigated: challenge', header: h('cf-mitigated', /challenge/i) },
    { vendor: 'Cloudflare', kind: 'challenge', confidence: 'high', signal: 'Cloudflare challenge script', suspect: true, resource: /\/cdn-cgi\/challenge-platform\/(?:h\/[a-z]\/)?orchestrate\// },
    { vendor: 'Cloudflare', kind: 'challenge', confidence: 'medium', signal: 'Cloudflare challenge page', suspect: true, text: /just a moment\.\.\.|checking your browser before accessing|checking if the site connection is secure|verify you are human by completing|enable javascript and cookies to continue|cf-chl/i },
    { vendor: 'Cloudflare', kind: 'captcha', confidence: 'medium', signal: 'Turnstile frame', suspect: true, resource: /challenges\.cloudflare\.com/ },
    { vendor: 'Cloudflare', kind: 'block', confidence: 'high', signal: 'Cloudflare error 1020/1010/1012', suspect: true, text: /error (?:code:? )?10(?:10|12|20)\b/i },
    { vendor: 'Cloudflare', kind: 'block', confidence: 'medium', signal: 'Cloudflare block page', suspect: true, text: /attention required!?\s*\|\s*cloudflare|sorry, you have been blocked/i },
    { vendor: 'Cloudflare', kind: 'rate_limit', confidence: 'high', signal: 'Cloudflare error 1015', suspect: true, text: /error (?:code:? )?1015\b|you are being rate limited/i },

    // Akamai
    { vendor: 'Akamai', kind: 'presence', confidence: 'high', signal: 'Akamai header', header: h(/^(akamai-grn|x-akamai-transformed|akamai-cache-status)$/) },
    { vendor: 'Akamai', kind: 'presence', confidence: 'high', signal: 'server: AkamaiGHost', header: h('server', /akamaighost|akamainetstorage/i) },
    { vendor: 'Akamai', kind: 'presence', confidence: 'high', signal: 'Akamai Bot Manager cookie', cookie: /^(_abck|bm_sz|ak_bmsc|bm_sv|bm_mi|bm_so)$/ },
    { vendor: 'Akamai', kind: 'block', confidence: 'high', signal: 'Akamai reference', suspect: true, text: /reference\s*#\s*\d+\.[0-9a-f]+\.\d+/i },
    { vendor: 'Akamai', kind: 'block', confidence: 'medium', signal: '403 from AkamaiGHost', status: [403], header: h('server', /akamaighost/i) },
    { vendor: 'Akamai', kind: 'challenge', confidence: 'high', signal: 'Akamai crypto challenge', suspect: true, resource: /\/_sec\/cp_challenge\// },
    { vendor: 'Akamai', kind: 'challenge', confidence: 'high', signal: 'sec_cpt cookie', suspect: true, cookie: /^sec_cpt$/ },

    // DataDome
    { vendor: 'DataDome', kind: 'presence', confidence: 'high', signal: 'x-datadome', header: h('x-datadome') },
    { vendor: 'DataDome', kind: 'presence', confidence: 'high', signal: 'DataDome cookie', cookie: /^datadome$/ },
    { vendor: 'DataDome', kind: 'presence', confidence: 'high', signal: 'DataDome tag', resource: /js\.datadome\.co|datadome\.co\/tags\.js/ },
    { vendor: 'DataDome', kind: 'captcha', confidence: 'high', signal: 'DataDome captcha frame', resource: /(?:geo|ct|interstitial)\.captcha-delivery\.com/ },
    { vendor: 'DataDome', kind: 'block', confidence: 'high', signal: '403 with x-datadome', status: [403], header: h('x-datadome') },
    { vendor: 'DataDome', kind: 'block', confidence: 'medium', signal: 'x-dd-b', header: h('x-dd-b') },

    // HUMAN (PerimeterX)
    { vendor: 'HUMAN', kind: 'presence', confidence: 'high', signal: 'PerimeterX cookie', cookie: /^_px(?:2|3|hd|vid|cvid|de)?$/ },
    { vendor: 'HUMAN', kind: 'presence', confidence: 'high', signal: 'PerimeterX sensor', resource: /client\.perimeterx\.net|client\.px-cloud\.net|px-cdn\.net/ },
    { vendor: 'HUMAN', kind: 'captcha', confidence: 'high', signal: 'PerimeterX captcha', resource: /captcha\.px-cdn\.net|captcha\.px-cloud\.net/ },
    { vendor: 'HUMAN', kind: 'captcha', confidence: 'high', signal: 'Press & Hold', suspect: true, text: /press (?:&|and) hold|px-captcha/i },
    { vendor: 'HUMAN', kind: 'block', confidence: 'medium', signal: 'PerimeterX block page', suspect: true, text: /access to this page has been denied|px-block/i },

    // Imperva (Incapsula)
    { vendor: 'Imperva', kind: 'presence', confidence: 'high', signal: 'x-iinfo', header: h('x-iinfo') },
    { vendor: 'Imperva', kind: 'presence', confidence: 'high', signal: 'x-cdn: Imperva', header: h('x-cdn', /incapsula|imperva/i) },
    { vendor: 'Imperva', kind: 'presence', confidence: 'high', signal: 'Incapsula cookie', cookie: /^(visid_incap_|incap_ses_|nlbi_)|^reese84$/ },
    { vendor: 'Imperva', kind: 'block', confidence: 'high', signal: 'Incapsula incident', suspect: true, text: /incapsula incident id|request unsuccessful\. incapsula/i },
    { vendor: 'Imperva', kind: 'challenge', confidence: 'high', signal: 'Incapsula resource', suspect: true, resource: /_incapsula_resource/i },

    // Kasada
    { vendor: 'Kasada', kind: 'presence', confidence: 'high', signal: 'Kasada cookie', cookie: /^KP_UIDz/ },
    { vendor: 'Kasada', kind: 'presence', confidence: 'medium', signal: 'x-kpsdk header', header: h(/^x-kpsdk-/) },
    { vendor: 'Kasada', kind: 'challenge', confidence: 'high', signal: '429 with x-kpsdk', status: [429], header: h(/^x-kpsdk-/) },
    { vendor: 'Kasada', kind: 'challenge', confidence: 'medium', signal: 'Kasada script', suspect: true, resource: /\/149e9513-01fa-4fb0-aad4-566afd725d1b\/|\/ips\.js(?:\?|$)/ },

    // AWS WAF (and CloudFront)
    { vendor: 'AWS WAF', kind: 'presence', confidence: 'high', signal: 'aws-waf-token cookie', cookie: /^aws-waf-token$/ },
    { vendor: 'AWS WAF', kind: 'presence', confidence: 'high', signal: 'AWS WAF script', resource: /\.awswaf\.com\// },
    { vendor: 'AWS WAF', kind: 'captcha', confidence: 'high', signal: 'x-amzn-waf-action: captcha', header: h('x-amzn-waf-action', /captcha/i) },
    { vendor: 'AWS WAF', kind: 'challenge', confidence: 'high', signal: 'x-amzn-waf-action: challenge', header: h('x-amzn-waf-action', /challenge/i) },
    { vendor: 'AWS WAF', kind: 'block', confidence: 'medium', signal: 'CloudFront block page', status: [403], text: /request blocked[\s\S]*cloudfront|generated by cloudfront/i },

    // F5 (BIG-IP ASM / Advanced WAF)
    { vendor: 'F5', kind: 'presence', confidence: 'medium', signal: 'F5 ASM cookie', cookie: /^TS01[0-9a-f]{6}$/i },
    { vendor: 'F5', kind: 'block', confidence: 'high', signal: 'F5 support ID page', suspect: true, text: /the requested url was rejected\. please consult with your administrator|your support id is:?\s*\d+/i },

    // Radware Bot Manager (ShieldSquare)
    { vendor: 'Radware', kind: 'presence', confidence: 'high', signal: 'Radware cookie', cookie: /^__uzm[abcdf]$/ },
    { vendor: 'Radware', kind: 'captcha', confidence: 'high', signal: 'Radware validation', navigation: /validate\.perfdrive\.com|radwarebotmanager/i },

    // Sucuri
    { vendor: 'Sucuri', kind: 'presence', confidence: 'high', signal: 'Sucuri header', header: h(/^x-sucuri-(id|cache)$/) },
    { vendor: 'Sucuri', kind: 'presence', confidence: 'high', signal: 'server: Sucuri', header: h('server', /sucuri/i) },
    { vendor: 'Sucuri', kind: 'block', confidence: 'high', signal: 'x-sucuri-block', header: h('x-sucuri-block') },
    { vendor: 'Sucuri', kind: 'block', confidence: 'medium', signal: 'Sucuri block page', suspect: true, text: /sucuri website firewall|access denied - sucuri/i },

    // Queue-it: a waiting room, not a block.
    { vendor: 'Queue-it', kind: 'presence', confidence: 'high', signal: 'Queue-it cookie', cookie: /^QueueITAccepted/ },
    { vendor: 'Queue-it', kind: 'queue', confidence: 'high', signal: 'redirected to the Queue-it waiting room', navigation: /^https?:\/\/[^/]+\.queue-it\.net\// },

    // Captcha widgets: on a suspicious page, the page is the captcha.
    { vendor: 'reCAPTCHA', kind: 'captcha', confidence: 'medium', signal: 'reCAPTCHA frame', suspect: true, resource: /google\.com\/recaptcha|recaptcha\.net\/recaptcha|gstatic\.com\/recaptcha/ },
    { vendor: 'hCaptcha', kind: 'captcha', confidence: 'medium', signal: 'hCaptcha frame', suspect: true, resource: /hcaptcha\.com/ },
    { vendor: 'GeeTest', kind: 'captcha', confidence: 'medium', signal: 'GeeTest', suspect: true, resource: /geetest\.com/ },
    { vendor: 'Arkose', kind: 'captcha', confidence: 'medium', signal: 'Arkose challenge', suspect: true, resource: /arkoselabs\.com|funcaptcha/ },

    // Generic wording.
    { vendor: 'unknown', kind: 'captcha', confidence: 'medium', signal: 'captcha wording', suspect: true, text: /\bcaptcha\b/i },
    { vendor: 'unknown', kind: 'block', confidence: 'low', signal: 'block wording', suspect: true, text: /access denied|request blocked|you have been blocked|unusual traffic|are you a (?:robot|human)|bot detection|automated (?:access|queries)|verify (?:that )?you are (?:a )?human/i },
];

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
/** Among findings of one confidence, the one that says most about what to do. */
const KIND_ORDER: BlockFinding['kind'][] = ['queue', 'rate_limit', 'captcha', 'block', 'challenge', 'soft_block'];

function matches(s: Signature, e: Evidence): boolean {
    if (s.suspect && !e.suspicious) return false;
    if (s.status && (e.status === undefined || !s.status.includes(e.status))) return false;
    if (s.header && !Object.entries(e.headers).some(([n, v]) => s.header![0].test(n) && s.header![1].test(v))) return false;
    if (s.cookie && !e.cookies.some(c => s.cookie!.test(c))) return false;
    if (s.resource && !e.resources.some(u => s.resource!.test(u))) return false;
    if (s.navigation && !e.navigation.some(u => s.navigation!.test(u))) return false;
    if (s.text && !s.text.test(e.title) && !s.text.test(e.text)) return false;
    return true;
}

/** The vendors present, and what this response is, when it is a block of some kind. */
export function identify(e: Evidence): { protection: string[]; finding?: BlockFinding } {
    const hits = SIGNATURES.filter(s => matches(s, e));
    const protection = [...new Set(hits.filter(s => !GENERIC.has(s.vendor) && s.kind === 'presence').map(s => s.vendor))];
    const blocks = hits.filter(s => s.kind !== 'presence');
    if (!blocks.length) return { protection };
    const byVendor = new Map<string, Signature[]>();
    for (const s of blocks) byVendor.set(s.vendor, [...(byVendor.get(s.vendor) ?? []), s]);
    const findings: BlockFinding[] = [...byVendor.entries()].map(([vendor, list]) => {
        const best = Math.max(...list.map(s => RANK[s.confidence]));
        // Two marks of one product agree; two generic wordings are still only wording.
        const confidence: Confidence = best === 2 || (list.length >= 2 && !GENERIC.has(vendor)) ? 'high' : best === 1 ? 'medium' : 'low';
        const kind = KIND_ORDER.find(k => list.some(s => s.kind === k))!;
        return { vendor, kind, confidence, signals: list.map(s => s.signal) };
    });
    findings.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || (GENERIC.has(a.vendor) ? 1 : 0) - (GENERIC.has(b.vendor) ? 1 : 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const finding = { ...findings[0], signals: findings.flatMap(f => f.signals) };
    // Generic wording on a site with one known vendor: that vendor's page.
    if (GENERIC.has(finding.vendor) && protection.length === 1) finding.vendor = protection[0];
    const vendors = new Set([...protection, ...findings.map(f => f.vendor).filter(v => !GENERIC.has(v))]);
    return { protection: [...vendors], finding };
}

/** Cookie names from `Set-Cookie` (Playwright joins several with a newline). Values are never kept. */
export function cookieNames(setCookie: string | undefined): string[] {
    if (!setCookie) return [];
    return setCookie.split('\n').map(line => line.split('=')[0].trim()).filter(Boolean);
}
