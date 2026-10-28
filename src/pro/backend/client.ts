/**
 * The backend client (`docs/design/LLD.md` §8): JSON over HTTPS with a bearer token. Network errors,
 * 429 and 5xx are tried again (3 tries, 0.5 s then 1 s apart); other errors are not. Every failure is a
 * `BackendError` whose kind the UI can say plainly.
 */
import { BackendError, type BackendApi, type BackendErrorKind, type CrawlStatus, type WayStats } from './types';

export interface ClientOptions {
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
    /** Waits between tries (tests pass one that does not wait). */
    sleep?: (ms: number) => Promise<void>;
}

const TRIES = 3;
const BACKOFF_MS = [500, 1000];

function kindOf(status: number): BackendErrorKind {
    if (status === 401 || status === 403) return 'auth';
    if (status === 400 || status === 422) return 'invalid';
    if (status === 409) return 'conflict';
    return 'unavailable';
}

const retryable = (status: number) => status === 429 || status >= 500;

export function createClient({ baseUrl, token, fetch: doFetch = (...a) => fetch(...a), sleep = ms => new Promise(r => setTimeout(r, ms)) }: ClientOptions): BackendApi {
    const root = baseUrl.replace(/\/+$/, '');

    async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            let res: Response;
            try {
                res = await doFetch(`${root}${path}`, {
                    method,
                    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
                    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
                });
            } catch (e) {
                if (attempt < TRIES) { await sleep(BACKOFF_MS[attempt - 1]); continue; }
                throw new BackendError('unavailable', `The backend could not be reached (${e instanceof Error ? e.message : String(e)}).`);
            }
            if (res.ok) return await res.json() as T;
            if (retryable(res.status) && attempt < TRIES) { await sleep(BACKOFF_MS[attempt - 1]); continue; }
            const payload = await res.json().catch(() => ({})) as { error?: string; message?: string; errors?: string[] };
            const message = payload.error ?? payload.message ?? `The backend answered ${res.status}.`;
            throw new BackendError(kindOf(res.status), message, res.status, payload.errors);
        }
    }

    return {
        createRecipe: input => call('POST', '/recipes', input),
        uploadVersion: (recipeId, file, digest) => call('POST', `/recipes/${encodeURIComponent(recipeId)}/versions`, file, { 'idempotency-key': digest }),
        reviewVersion: (recipeId, version, review) => call('POST', `/recipes/${encodeURIComponent(recipeId)}/versions/${version}/review`, review),
        startCrawl: (recipeId, input) => call('POST', `/recipes/${encodeURIComponent(recipeId)}/crawls`, input),
        getCrawl: crawlId => call<CrawlStatus>('GET', `/crawls/${encodeURIComponent(crawlId)}`),
        getWayStats: (recipeId, since) => call<WayStats[]>('GET', `/recipes/${encodeURIComponent(recipeId)}/ways/stats?since=${encodeURIComponent(since)}`),
        setLive: (recipeId, version, reason) => call('POST', `/recipes/${encodeURIComponent(recipeId)}/labels/live`, { version, reason }),
    };
}
