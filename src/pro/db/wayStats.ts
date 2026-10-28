/**
 * Each way's daily usage as the backend reported it, kept so a recipe's selectors can be judged without
 * asking again. A day reported again replaces the one kept.
 */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { WayDay, WayStats } from '../backend/types';

export interface WayDayRecord extends WayDay {
    recipeId: string;
    field: string;
    wayId: string;
}

export async function saveWayStats(recipeId: string, stats: WayStats[]): Promise<void> {
    const tx = await proTransaction(STORES.wayStats, 'readwrite');
    const store = tx.objectStore(STORES.wayStats);
    for (const { field, wayId, days } of stats) for (const day of days) store.put({ recipeId, field, wayId, ...day } satisfies WayDayRecord);
    await done(tx);
}

export async function listWayStats(recipeId: string): Promise<WayDayRecord[]> {
    const tx = await proTransaction(STORES.wayStats);
    return req<WayDayRecord[]>(tx.objectStore(STORES.wayStats).index('recipeId').getAll(recipeId));
}
