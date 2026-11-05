/** Test runs: one per test, found by the recipe and the digest of the spec that was tested. */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import { expectations, pageOutcome } from '../runner/outcome';
import type { PageResult } from '../runner/testPage';

export interface TestRun {
    id?: number;
    recipeId: string;
    /** The tested spec's digest: the run counts for every version with this spec. */
    digest: string;
    /** One page (this page) or several sample pages. */
    kind: 'page' | 'pages';
    results: PageResult[];
    /** Every page reached and every field ok on it. */
    passed: boolean;
    at: number;
}

/** Runs kept per recipe and spec: the newest. */
const KEEP = 20;

export async function saveTest(run: Omit<TestRun, 'id'>): Promise<TestRun> {
    const tx = await proTransaction(STORES.tests, 'readwrite');
    const store = tx.objectStore(STORES.tests);
    const id = await req(store.add(run)) as number;
    const keys = await req(store.index('recipeDigest').getAllKeys([run.recipeId, run.digest]));
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) store.delete(old);
    await done(tx);
    return { ...run, id };
}

/** The newest run of this spec, of a kind or any. */
export async function latestTest(recipeId: string, digest: string, kind?: TestRun['kind']): Promise<TestRun | undefined> {
    const tx = await proTransaction(STORES.tests);
    const runs = await req<TestRun[]>(tx.objectStore(STORES.tests).index('recipeDigest').getAll([recipeId, digest]));
    return runs.filter(r => !kind || r.kind === kind).sort((a, b) => b.at - a.at)[0];
}

/**
 * Every page as it should be: read with every field ok, or, for a sample kept to hit a page rule, that rule held.
 * A page where a rule held unexpectedly, or another product, does not pass.
 */
export function passed(results: PageResult[], samples?: { url: string; expectRule?: string }[]): boolean {
    const expect = expectations(samples);
    return results.length > 0 && results.every(r => pageOutcome(r, expect.get(r.url)).ok);
}
