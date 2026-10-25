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
 * | `tests`    | auto                 | `[recipeId,digest]`, `recipeId` |
 *
 * v2 adds `tests`: test runs, keyed by the tested spec's digest, so a draft tested in the editor counts
 * for the version it is saved as.
 */
export const PRO_DB_NAME = 'crawlpilot-pro';
export const PRO_DB_VERSION = 2;

export const STORES = {
    recipes: 'recipes',
    versions: 'versions',
    labelLog: 'labelLog',
    samples: 'samples',
    drafts: 'drafts',
    tests: 'tests',
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
    if (oldVersion < 2) {
        const tests = db.createObjectStore(STORES.tests, { keyPath: 'id', autoIncrement: true });
        tests.createIndex('recipeDigest', ['recipeId', 'digest']);
        tests.createIndex('recipeId', 'recipeId');
    }
}
