/**
 * The recipe store as a worker uses it (`docs/design/crawler.md`):
 * - `GET /resolve?competitor=&pageType=&url=`: the `live` version for the page, chosen by the recipes'
 *   match rules; 404 when no recipe covers it, `{ paused: true }` when its recipe is paused. Cached for
 *   `resolveTtlMs` (a minute), so a rollback reaches every worker within a minute.
 * - `GET /versions/{digest}`: `{ recipeId, version, approved, file }`, the version as a format 3
 *   `.crawlpilot.json`. Cached for good: a version never changes. Its spec is digested again here; a
 *   mismatch is refused.
 * A job may pin a version by digest; in production that version must be approved.
 * Each request has a timeout (`timeoutMs`): a store that hangs is a store that is down.
 */
import { specDigest } from '../recipe/canonical';
import { readRecipeFile } from '../recipe/file';
import type { ProSpec, RunSettings } from '../recipe/types';
import { CrawlError } from './classify';
import type { CrawlJob, RecipeRef } from './types';

export interface ResolvedRecipe extends RecipeRef {
    spec: ProSpec;
    settings: RunSettings;
}

export interface RecipeStore {
    recipeFor(job: CrawlJob): Promise<ResolvedRecipe>;
}

export interface StoreOptions {
    baseUrl: string;
    token: string;
    resolveTtlMs?: number;
    maxVersions?: number;
    /** Resolves kept, one per page URL: the oldest beyond it are dropped. */
    maxResolved?: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
}

interface VersionReply { recipeId: string; version: number; approved: boolean; file: unknown }

export function createRecipeStore(o: StoreOptions): RecipeStore {
    const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const now = o.now ?? Date.now;
    const ttl = o.resolveTtlMs ?? 60_000;
    const maxVersions = o.maxVersions ?? 500;
    const maxResolved = o.maxResolved ?? 10_000;
    const timeoutMs = o.timeoutMs ?? 15_000;
    const root = o.baseUrl.replace(/\/+$/, '');
    const resolved = new Map<string, { at: number; ref: RecipeRef | 'paused' | 'none' }>();
    const versions = new Map<string, Promise<ResolvedRecipe & { approved: boolean }>>();

    async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
        try {
            const res = await doFetch(`${root}${path}`, { headers: { authorization: `Bearer ${o.token}` }, signal: AbortSignal.timeout(timeoutMs) });
            if (res.status >= 500 || res.status === 429) throw new CrawlError('recipe_store', `The recipe store answered ${res.status}.`);
            return { status: res.status, body: res.ok ? await res.json() as T : null };
        } catch (e) {
            if (e instanceof CrawlError) throw e;
            throw new CrawlError('recipe_store', `The recipe store could not be reached (${e instanceof Error ? e.message : String(e)}).`);
        }
    }

    function version(digest: string) {
        let v = versions.get(digest);
        if (!v) {
            v = (async () => {
                const { status, body } = await get<VersionReply>(`/versions/${encodeURIComponent(digest)}`);
                if (!body) throw new CrawlError(status === 404 ? 'no_recipe' : 'recipe_store', `Version ${digest.slice(0, 12)} not found (${status}).`);
                const { spec, settings } = readRecipeFile(JSON.stringify(body.file)).versions[0];
                if (await specDigest(spec) !== digest) throw new CrawlError('recipe_store', `Version ${digest.slice(0, 12)} does not match its digest.`);
                return { recipeId: body.recipeId, version: body.version, digest, spec, settings, approved: body.approved };
            })();
            versions.set(digest, v);
            // A failed read is not kept; the oldest beyond the cap are dropped.
            v.catch(() => versions.delete(digest));
            if (versions.size > maxVersions) versions.delete(versions.keys().next().value!);
        }
        return v;
    }

    return {
        async recipeFor(job) {
            const mode = job.mode ?? 'prod';
            if (job.recipeDigest) {
                const v = await version(job.recipeDigest);
                if (mode === 'prod' && !v.approved) throw new CrawlError('no_recipe', `Pinned version ${v.recipeId} v${v.version} is not approved.`);
                const { approved: _, ...recipe } = v;
                return recipe;
            }
            const key = `${job.competitor}\n${job.pageType}\n${job.url}`;
            let hit = resolved.get(key);
            if (!hit || now() - hit.at > ttl) {
                const q = new URLSearchParams({ competitor: job.competitor, pageType: job.pageType, url: job.url });
                const { status, body } = await get<RecipeRef & { paused?: boolean }>(`/resolve?${q}`);
                const ref = body?.paused ? 'paused' : body ? { recipeId: body.recipeId, version: body.version, digest: body.digest } : 'none';
                if (!body && status !== 404) throw new CrawlError('recipe_store', `The recipe store answered ${status}.`);
                hit = { at: now(), ref };
                resolved.delete(key);
                resolved.set(key, hit);
                if (resolved.size > maxResolved) resolved.delete(resolved.keys().next().value!);
            }
            if (hit.ref === 'none') throw new CrawlError('no_recipe', `No live recipe for ${job.competitor} ${job.pageType} covers ${job.url}.`);
            if (hit.ref === 'paused') throw new CrawlError('paused', `The recipe for ${job.competitor} ${job.pageType} is paused.`);
            const { approved: _, ...recipe } = await version(hit.ref.digest);
            return recipe;
        },
    };
}
