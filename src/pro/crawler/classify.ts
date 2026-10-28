/**
 * What an attempt's response, or its failure, means: an error class, whether it is worth another try, the
 * page status the documents carry, and, for a block, what gave it away. Rules:
 * - a navigation error is classed by Chromium's net error (DNS, connection, TLS, proxy, timeout);
 * - 407 is the proxy refusing its credentials; 429 is rate limiting (with `Retry-After` when sent);
 * - a challenge or captcha is found from the status, headers, title and visible text. On a 2xx page the
 *   text markers count only when the page is short, as block pages are: shop pages often load a captcha
 *   script for a newsletter form, and that is not a block;
 * - 404 and 410 are final; other 4xx are final; 5xx is retried;
 * - a 2xx page with almost no text is empty (a page that has not rendered), tried again once.
 */
import type { ErrorClass, PageStatus } from './types';

export interface Observation {
    /** The navigation's error message, when there was no response. */
    error?: string;
    status?: number;
    /** Response headers, names in lower case. */
    headers?: Record<string, string>;
    title?: string;
    /** The page's visible text, or its start. */
    text?: string;
}

export interface Classification {
    errorClass: ErrorClass;
    retryable: boolean;
    pageStatus: PageStatus;
    blockSignal?: string;
    retryAfterMs?: number;
}

/** Response headers kept on request events: they explain caching, blocks and rate limits. */
export const KEEP_HEADERS = [
    'server', 'content-type', 'content-length', 'content-language', 'cache-control', 'age', 'via', 'date',
    'location', 'retry-after', 'x-cache', 'x-served-by', 'x-amz-cf-pop', 'x-amz-cf-id',
    'cf-ray', 'cf-cache-status', 'cf-mitigated', 'x-datadome', 'x-iinfo', 'x-akamai-transformed', 'akamai-grn',
] as const;

/** Visible text shorter than this, on a 2xx page, is a page that did not render. */
export const MIN_TEXT = 80;
/** Text markers on a 2xx page count only below this length: block pages are short. */
const SHORT_PAGE = 2000;

const NET_ERRORS: [RegExp, ErrorClass][] = [
    [/Page crashed|Target crashed/i, 'page_crashed'],
    [/Target page, context or browser has been closed|Browser has been closed|browser has disconnected|Browser closed|Failed to launch|browserType\.launch/i, 'browser'],
    [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ENOTFOUND/i, 'dns'],
    [/ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CERTIFICATE_INVALID|ERR_NO_SUPPORTED_PROXIES|ERR_SOCKS_CONNECTION_FAILED/i, 'proxy'],
    [/ERR_PROXY_AUTH|ERR_PROXY_AUTHENTICATION|407/i, 'proxy_auth'],
    [/ERR_CERT_|ERR_SSL_|ERR_BAD_SSL/i, 'tls'],
    [/Timeout .*exceeded|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT/i, 'timeout'],
    [/ERR_CONNECTION_(REFUSED|RESET|CLOSED|ABORTED|FAILED)|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ECONNREFUSED|ECONNRESET/i, 'connection'],
    [/ERR_TOO_MANY_REDIRECTS|ERR_ABORTED|ERR_INVALID_RESPONSE|ERR_BLOCKED_BY/i, 'navigation'],
];

const CAPTCHA: [RegExp, string][] = [
    [/\bcaptcha\b|recaptcha|hcaptcha|cf-turnstile|px-captcha|captcha-delivery/i, 'captcha'],
];

const CHALLENGE: [RegExp, string][] = [
    [/just a moment\.\.\.|attention required!?\s*\|\s*cloudflare|cf-chl|challenge-platform|checking your browser/i, 'Cloudflare challenge'],
    [/datadome/i, 'DataDome'],
    [/perimeterx|press (?:&|and) hold|px-block/i, 'PerimeterX'],
    [/incapsula incident|_incapsula_resource|imperva/i, 'Imperva'],
    [/reference\s*#\s*\d+\.[0-9a-f]+\.\d+/i, 'Akamai reference'],
    [/access denied|request blocked|you have been blocked|unusual traffic|are you a (?:robot|human)|bot detection|automated (?:access|queries)/i, 'block page'],
];

const BLOCK_HEADERS: [string, RegExp, string][] = [
    ['cf-mitigated', /challenge/i, 'cf-mitigated: challenge'],
    ['x-datadome', /./, 'x-datadome'],
];

const RULES: Record<ErrorClass, { retryable: boolean; pageStatus: PageStatus }> = {
    none: { retryable: false, pageStatus: 'ok' },
    dns: { retryable: true, pageStatus: 'error' },
    connection: { retryable: true, pageStatus: 'error' },
    tls: { retryable: false, pageStatus: 'error' },
    timeout: { retryable: true, pageStatus: 'timeout' },
    navigation: { retryable: false, pageStatus: 'error' },
    browser: { retryable: true, pageStatus: 'error' },
    page_crashed: { retryable: true, pageStatus: 'error' },
    proxy: { retryable: true, pageStatus: 'error' },
    proxy_auth: { retryable: true, pageStatus: 'error' },
    rate_limited: { retryable: true, pageStatus: 'blocked' },
    blocked: { retryable: true, pageStatus: 'blocked' },
    captcha: { retryable: true, pageStatus: 'blocked' },
    not_found: { retryable: false, pageStatus: 'not_found' },
    gone: { retryable: false, pageStatus: 'not_found' },
    client_error: { retryable: false, pageStatus: 'error' },
    server_error: { retryable: true, pageStatus: 'error' },
    empty_page: { retryable: true, pageStatus: 'error' },
    robots_disallowed: { retryable: false, pageStatus: 'error' },
    extraction: { retryable: true, pageStatus: 'error' },
    no_recipe: { retryable: false, pageStatus: 'error' },
    recipe_store: { retryable: true, pageStatus: 'error' },
    paused: { retryable: false, pageStatus: 'error' },
    unknown: { retryable: true, pageStatus: 'error' },
};

export function classOf(errorClass: ErrorClass, extra: Partial<Classification> = {}): Classification {
    return { errorClass, ...RULES[errorClass], ...extra };
}

/** `Retry-After` as milliseconds: seconds, or an HTTP date. */
export function retryAfterMs(value: string | undefined, now = Date.now()): number | undefined {
    if (!value) return undefined;
    if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
    const at = Date.parse(value);
    return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function marker(list: [RegExp, string][], ...texts: (string | undefined)[]): string | undefined {
    for (const [re, name] of list) if (texts.some(t => t && re.test(t))) return name;
    return undefined;
}

export function classify(o: Observation, now = Date.now()): Classification {
    if (o.error && o.status === undefined) {
        const hit = NET_ERRORS.find(([re]) => re.test(o.error!));
        return classOf(hit ? hit[1] : 'unknown');
    }
    const status = o.status ?? 0;
    const headers = o.headers ?? {};
    if (status === 407) return classOf('proxy_auth');
    if (status === 429) return classOf('rate_limited', { blockSignal: 'status 429', retryAfterMs: retryAfterMs(headers['retry-after'], now) });

    const text = o.text ?? '';
    const failed = status >= 400;
    const short = text.length < SHORT_PAGE;
    const header = BLOCK_HEADERS.find(([name, re]) => headers[name] !== undefined && re.test(headers[name]));
    const captcha = (failed || short) ? marker(CAPTCHA, o.title, text) : undefined;
    const challenge = (failed || short) ? marker(CHALLENGE, o.title, text) : undefined;
    const signal = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' + ');

    if (captcha) return classOf('captcha', { blockSignal: signal(status ? `status ${status}` : undefined, header?.[2], captcha) });
    if (header || challenge) return classOf('blocked', { blockSignal: signal(`status ${status}`, header?.[2], challenge) });
    if (status === 403) return classOf('blocked', { blockSignal: 'status 403' });
    if (status === 404) return classOf('not_found');
    if (status === 410) return classOf('gone');
    if (status >= 500) return classOf('server_error', { retryAfterMs: retryAfterMs(headers['retry-after'], now) });
    if (failed) return classOf('client_error');
    if (text.trim().length < MIN_TEXT) return classOf('empty_page');
    return classOf('none');
}

/** The kept headers of a response, and every header name. */
export function keepHeaders(headers: Record<string, string>): { headers: Record<string, string>; headerNames: string[] } {
    const kept: Record<string, string> = {};
    for (const name of KEEP_HEADERS) if (headers[name] !== undefined) kept[name] = headers[name].slice(0, 512);
    return { headers: kept, headerNames: Object.keys(headers).sort() };
}

/** A failure the worker raises itself (no recipe, the store down, the page script failing), with its class. */
export class CrawlError extends Error {
    constructor(readonly errorClass: ErrorClass, message: string) {
        super(message);
    }
}
