/**
 * What an attempt's response, or its failure, means: an error class, whether it is worth another try, the
 * page status the documents carry, and, for a block, what gave it away. Rules:
 * - a navigation error is classed by Chromium's net error (DNS, connection, TLS, proxy, timeout);
 * - 407 is the proxy refusing its credentials; 429 is rate limiting (with `Retry-After` when sent);
 * - bot protection is identified by `detect.ts`: the vendors a site uses (`protection`), and whether this
 *   response is a challenge, captcha, block page, rate limit or waiting room (`block`, with the vendor and a
 *   confidence). Marks that ordinary pages carry too count only on an error status or a short page: shop
 *   pages often load a captcha script for a newsletter form, and that is not a block;
 * - a bare 403 is a block of low confidence;
 * - 404 and 410 are final; other 4xx are final; 5xx is retried;
 * - a 2xx page with almost no text is empty (a page that has not rendered), tried again once.
 */
import { cookieNames, identify, type BlockFinding } from './detect';
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
    /** Cookie names the page set (from the response and the browser); values are never read. */
    cookies?: string[];
    /** The page's script and frame URLs. */
    resources?: string[];
    /** Redirects and the final URL. */
    navigation?: string[];
}

export interface Classification {
    errorClass: ErrorClass;
    retryable: boolean;
    pageStatus: PageStatus;
    blockSignal?: string;
    retryAfterMs?: number;
    /** What kind of block, from which vendor, how sure. */
    block?: BlockFinding;
    /** Bot protection vendors seen on the response, blocked or not. */
    protection?: string[];
}

/** Response headers kept on request events: they explain caching, blocks and rate limits. */
export const KEEP_HEADERS = [
    'server', 'content-type', 'content-length', 'content-language', 'cache-control', 'age', 'via', 'date',
    'location', 'retry-after', 'x-cache', 'x-served-by', 'x-amz-cf-pop', 'x-amz-cf-id',
    'cf-ray', 'cf-cache-status', 'cf-mitigated', 'x-datadome', 'x-dd-b', 'x-iinfo', 'x-cdn', 'x-akamai-transformed', 'akamai-grn',
    'x-amzn-waf-action', 'x-sucuri-id', 'x-sucuri-block',
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
    waiting_room: { retryable: true, pageStatus: 'blocked' },
    blocked: { retryable: true, pageStatus: 'blocked' },
    captcha: { retryable: true, pageStatus: 'blocked' },
    not_found: { retryable: false, pageStatus: 'not_found' },
    gone: { retryable: false, pageStatus: 'not_found' },
    client_error: { retryable: false, pageStatus: 'error' },
    server_error: { retryable: true, pageStatus: 'error' },
    unavailable: { retryable: false, pageStatus: 'unavailable' },
    mismatch: { retryable: false, pageStatus: 'mismatch' },
    empty_page: { retryable: true, pageStatus: 'error' },
    robots_disallowed: { retryable: false, pageStatus: 'error' },
    extraction: { retryable: true, pageStatus: 'error' },
    no_recipe: { retryable: false, pageStatus: 'error' },
    recipe_store: { retryable: true, pageStatus: 'error' },
    paused: { retryable: false, pageStatus: 'error' },
    expired: { retryable: false, pageStatus: 'error' },
    setup_failed: { retryable: true, pageStatus: 'error' },
    missing_context: { retryable: false, pageStatus: 'error' },
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

export function classify(o: Observation, now = Date.now()): Classification {
    if (o.error && o.status === undefined) {
        const hit = NET_ERRORS.find(([re]) => re.test(o.error!));
        return classOf(hit ? hit[1] : 'unknown');
    }
    const status = o.status ?? 0;
    const headers = o.headers ?? {};
    if (status === 407) return classOf('proxy_auth');

    const text = o.text ?? '';
    const failed = status >= 400;
    const { protection, finding } = identify({
        status, headers, title: o.title ?? '', text,
        cookies: [...new Set([...cookieNames(headers['set-cookie']), ...(o.cookies ?? [])])],
        resources: o.resources ?? [], navigation: o.navigation ?? [],
        suspicious: failed || text.length < SHORT_PAGE,
    });
    const seen = protection.length ? { protection } : {};
    const retryAfter = retryAfterMs(headers['retry-after'], now);
    const blockOf = (f: BlockFinding) => ({ ...seen, block: f, blockSignal: [`status ${status}`, ...f.signals].join(' + '), ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}) });

    if (finding) {
        if (finding.kind === 'queue') return classOf('waiting_room', blockOf(finding));
        if (finding.kind === 'rate_limit') return classOf('rate_limited', blockOf(finding));
        return classOf(finding.kind === 'captcha' ? 'captcha' : 'blocked', blockOf(finding));
    }
    if (status === 429) return classOf('rate_limited', { ...seen, blockSignal: 'status 429', ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}) });
    if (status === 403) return classOf('blocked', blockOf({ vendor: protection[0] ?? 'unknown', kind: 'block', confidence: 'low', signals: [] }));
    if (status === 404) return classOf('not_found', seen);
    if (status === 410) return classOf('gone', seen);
    if (status >= 500) return classOf('server_error', { ...seen, retryAfterMs: retryAfter });
    if (failed) return classOf('client_error', seen);
    if (text.trim().length < MIN_TEXT) return classOf('empty_page', seen);
    return classOf('none', seen);
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
