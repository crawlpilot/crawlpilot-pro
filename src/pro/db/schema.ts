/**
 * Pro's IndexedDB database, separate from the public `crawl-pilot` one (`docs/design/LLD.md` §3).
 * Repositories in this folder are the only code that names a store.
 *
 * | Store      | Key                  | Indexes                         |
 * |------------|----------------------|---------------------------------|
 * | `recipes`  | `id`                 | `site`, `updatedAt`             |
 * | `versions` | `[recipeId,version]` | `recipeId`, `digest`            |
 * | `labelLog` | auto                 | `recipeId`                      |
 * | `samples`  | `[recipeId,url]`     | `recipeId`                      |
 * | `drafts`   | `recipeId`           |                                 |
 */
export const PRO_DB_NAME = 'crawlpilot-pro';
export const PRO_DB_VERSION = 1;

export const STORES = {
    recipes: 'recipes',
    versions: 'versions',
    labelLog: 'labelLog',
    samples: 'samples',
    drafts: 'drafts',
} as const;

export function upgrade(db: IDBDatabase, oldVersion: number): void {
    if (oldVersion < 1) {
        const recipes = db.createObjectStore(STORES.recipes, { keyPath: 'id' });
        recipes.createIndex('site', 'site');
        recipes.createIndex('updatedAt', 'updatedAt');
        const versions = db.createObjectStore(STORES.versions, { keyPath: ['recipeId', 'version'] });
        versions.createIndex('recipeId', 'recipeId');
        versions.createIndex('digest', 'digest');
        db.createObjectStore(STORES.labelLog, { keyPath: 'id', autoIncrement: true }).createIndex('recipeId', 'recipeId');
        db.createObjectStore(STORES.samples, { keyPath: ['recipeId', 'url'] }).createIndex('recipeId', 'recipeId');
        db.createObjectStore(STORES.drafts, { keyPath: 'recipeId' });
    }
}
