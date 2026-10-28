/**
 * Cleanup changes someone chose to keep, with why: the same change to the same way is never proposed again
 * (`recipe/cleanup.ts`). Keyed by the way's stable id, so it holds across versions.
 */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { CleanupAction } from '../recipe/cleanup';

export interface CleanupDismissal {
    recipeId: string;
    wayId: string;
    action: CleanupAction;
    by: string;
    reason: string;
    at: number;
}

export async function dismissCleanup(d: Omit<CleanupDismissal, 'at'>): Promise<CleanupDismissal> {
    if (!d.reason.trim()) throw new Error('Say why it is kept.');
    const record: CleanupDismissal = { ...d, reason: d.reason.trim(), at: Date.now() };
    const tx = await proTransaction(STORES.dismissals, 'readwrite');
    tx.objectStore(STORES.dismissals).put(record);
    await done(tx);
    return record;
}

export async function listDismissals(recipeId: string): Promise<CleanupDismissal[]> {
    const tx = await proTransaction(STORES.dismissals);
    return req<CleanupDismissal[]>(tx.objectStore(STORES.dismissals).index('recipeId').getAll(recipeId));
}
