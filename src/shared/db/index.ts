/**
 * The extension's database. Callers use `db.tables` (datasets and rows) and `db.jobs` (runs and
 * their recipes); only `shared/db` knows the stores (`schema.ts`).
 */
import { database, done, transaction } from './idb';
import { STORES } from './schema';
import { tables } from './tables';
import { jobs } from './jobs';

/** Deletes every record in every store ("Delete all data" in Settings). */
async function clearAll(): Promise<void> {
    const names = Object.values(STORES);
    const tx = await transaction(names, 'readwrite');
    names.forEach(name => tx.objectStore(name).clear());
    await done(tx);
}

export const db = {
    open: async () => { await database(); },
    tables,
    jobs,
    clearAll,
};

export type { SaveOptions } from './tables';
export type { JobWithRecipe, RecipeRuns } from './jobs';
