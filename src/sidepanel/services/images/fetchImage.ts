/**
 * An image's bytes, from wherever they can be had:
 *
 * 1. `data:` URLs are decoded here.
 * 2. **Direct**, from the side panel: with the site's host permission it isn't held back by CORS, and
 *    `credentials: 'include'` sends the browser's cookies for the image's host. Timeouts, 429s and
 *    5xx are retried with backoff (honouring `Retry-After`).
 * 3. **From the page** (its content script), when direct fails with a block, a login, a network error
 *    or an HTML page instead of an image: the page's fetch carries its own `Referer` (hotlink
 *    protection) and session, and is the only way to read the page's `blob:` URLs. The bytes come
 *    back as a data URL.
 *
 * The bytes decide the type (`sniffType`); a response that isn't an image fails as `not-image`.
 * Every failure has a reason the panel can show.
 */
import { sniffType } from '../../../shared/images/sniff';

export type FailReason = 'login' | 'blocked' | 'not-found' | 'timeout' | 'not-image' | 'server' | 'network' | 'too-large' | 'save' | 'stopped';

export class FetchFailure extends Error {
    constructor(readonly reason: FailReason, readonly status?: number, readonly retryAfter?: number) {
        super(status ? `${reason} (HTTP ${status})` : reason);
    }
}

export interface Fetched {
    bytes: Uint8Array;
    type: string;
    via: 'direct' | 'page' | 'inline';
}

/** Fetches `url` in the page; `null` when there is no page to ask. */
export type InPage = (url: string) => Promise<{ dataUrl: string } | { error: string; status?: number }>;

export interface FetchOptions {
    signal: AbortSignal;
    inPage?: InPage;
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}

const HEADERS_TIMEOUT_MS = 20_000;
const BODY_TIMEOUT_MS = 90_000;
const MAX_BYTES = 200 * 1024 * 1024;
const ATTEMPTS = 3;
const BACKOFF_MS = 600;
const RETRY_AFTER_MAX_MS = 15_000;
/** Direct failures worth asking the page about. */
const PAGE_CAN_HELP: FailReason[] = ['login', 'blocked', 'network', 'not-image', 'not-found'];

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function decodeDataUrl(url: string): Uint8Array {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const body = url.slice(comma + 1);
    if (meta.endsWith(';base64')) {
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
}

function failureFor(status: number, retryAfter: string | null): FetchFailure {
    const after = retryAfter ? (Number(retryAfter) * 1000 || Math.max(0, Date.parse(retryAfter) - Date.now()) || undefined) : undefined;
    if (status === 401) return new FetchFailure('login', status);
    if (status === 404 || status === 410) return new FetchFailure('not-found', status);
    if (status === 429 || status >= 500) return new FetchFailure('server', status, after);
    return new FetchFailure('blocked', status);
}

function typed(bytes: Uint8Array, via: Fetched['via']): Fetched {
    const type = sniffType(bytes);
    if (!type) throw new FetchFailure('not-image');
    return { bytes, type, via };
}

async function direct(url: string, signal: AbortSignal, fetchFn: typeof fetch): Promise<Fetched> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    let timer = setTimeout(() => { timedOut = true; controller.abort(); }, HEADERS_TIMEOUT_MS);
    try {
        const response = await fetchFn(url, { credentials: 'include', signal: controller.signal, cache: 'force-cache' });
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, BODY_TIMEOUT_MS);
        if (!response.ok) throw failureFor(response.status, response.headers.get('retry-after'));
        if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new FetchFailure('too-large', response.status);
        return typed(new Uint8Array(await response.arrayBuffer()), 'direct');
    } catch (e) {
        if (e instanceof FetchFailure) throw e;
        if (signal.aborted) throw new FetchFailure('stopped');
        throw new FetchFailure(timedOut ? 'timeout' : 'network');
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}

async function fromPage(url: string, inPage: InPage): Promise<Fetched> {
    const reply = await inPage(url);
    if ('error' in reply) throw reply.status ? failureFor(reply.status, null) : new FetchFailure('network');
    return typed(decodeDataUrl(reply.dataUrl), 'page');
}

export async function fetchImage(url: string, { signal, inPage, fetchFn = fetch, sleep = wait }: FetchOptions): Promise<Fetched> {
    if (url.startsWith('data:')) return typed(decodeDataUrl(url), 'inline');
    if (url.startsWith('blob:')) {
        if (!inPage) throw new FetchFailure('network');
        return fromPage(url, inPage);
    }
    let failure: FetchFailure | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        if (signal.aborted) throw new FetchFailure('stopped');
        try {
            return await direct(url, signal, fetchFn);
        } catch (e) {
            failure = e as FetchFailure;
            const retry = failure.reason === 'timeout' || failure.reason === 'server' || (failure.reason === 'network' && attempt === 1);
            if (!retry || attempt === ATTEMPTS) break;
            await sleep(Math.min(failure.retryAfter ?? BACKOFF_MS * 2 ** (attempt - 1), RETRY_AFTER_MAX_MS));
        }
    }
    if (inPage && failure && PAGE_CAN_HELP.includes(failure.reason) && !signal.aborted) {
        try {
            return await fromPage(url, inPage);
        } catch {
            // The page couldn't either: the direct reason is the more telling one.
        }
    }
    throw failure ?? new FetchFailure('network');
}
