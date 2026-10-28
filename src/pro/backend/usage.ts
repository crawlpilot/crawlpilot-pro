/** Fetches a submitted recipe's selector usage from the backend and keeps it (`db/wayStats.ts`). */
import { pro } from '../db';
import type { ProRecipe } from '../recipe/types';
import type { BackendApi } from './types';

/** Days fetched: the 30-day window plus room to say when a way last won. */
const FETCH_DAYS = 90;

export async function refreshWayStats(api: BackendApi, recipe: ProRecipe, now = Date.now()): Promise<number> {
    if (!recipe.remoteId) return 0;
    const since = new Date(now - FETCH_DAYS * 86_400_000).toISOString().slice(0, 10);
    const stats = await api.getWayStats(recipe.remoteId, since);
    await pro.wayStats.save(recipe.id, stats);
    return stats.length;
}
