/**
 * Health of a recipe's crawls (`docs/design/HLD.md` §5.4): each finished crawl against the baseline of the
 * version it ran, that is the fill on the pages its spec was tested on before submit.
 */
import { pro } from './db';
import type { CrawlRecord } from './db/crawls';
import { baselineOf, crawlHealth, type CrawlHealth } from './recipe/health';
import type { ProRecipe } from './recipe/types';

export async function healthOf(crawl: CrawlRecord): Promise<CrawlHealth | null> {
    if (crawl.last?.status !== 'done') return null;
    const version = await pro.versions.get(crawl.recipeId, crawl.version);
    const run = version && await pro.tests.latest(crawl.recipeId, version.digest, 'pages');
    return crawlHealth(run ? baselineOf(run.results) : undefined, crawl.last);
}

/** The newest finished crawl of the live version, and its health. */
export async function recipeHealth(recipe: ProRecipe): Promise<CrawlHealth | null> {
    const crawl = (await pro.crawls.list(recipe.id)).find(c => c.version === recipe.labels.live && c.last?.status === 'done');
    return crawl ? healthOf(crawl) : null;
}
