/**
 * Submit a version to the crawler backend (`docs/design/HLD.md` §5.3): only when it is ready (the gate
 * is checked here, not only in the UI). The recipe is created on the backend the first time; the
 * version goes up as a one-version `.crawlpilot.json` keyed by its digest (a retry is a no-op); a crawl
 * starts on its pages; the version is marked submitted and `live` moves to it, there and here.
 */
import { pro } from '../db';
import type { CrawlRecord } from '../db/crawls';
import { writeRecipeFile } from '../recipe/file';
import { readiness } from '../recipe/ready';
import type { ProRecipe, Version } from '../recipe/types';
import { BackendError, type BackendApi, type Schedule } from './types';

export async function submitVersion(api: BackendApi, recipe: ProRecipe, version: Version, schedule: Schedule, author: string): Promise<CrawlRecord> {
    const run = await pro.tests.latest(recipe.id, version.digest, 'pages');
    const ready = readiness(run?.results, version);
    if (!ready.ready) throw new BackendError('invalid', `Not ready to submit. ${ready.reasons.join(' ')}`);

    let remoteId = recipe.remoteId;
    if (!remoteId) {
        const { name, site, kind, competitor, pageType, matchRules } = recipe;
        remoteId = (await api.createRecipe({ name, site, kind, competitor, pageType, matchRules })).id;
        await pro.recipes.setRemoteId(recipe.id, remoteId);
    }
    const file = writeRecipeFile({ ...recipe, labels: {} }, [version], await pro.samples.list(recipe.id));
    const upload = await api.uploadVersion(remoteId, file, version.digest);
    if (!upload.accepted) throw new BackendError('invalid', 'The backend did not accept the version.', undefined, upload.errors);

    const { crawlId } = await api.startCrawl(remoteId, { version: version.version, pages: version.pages, schedule });
    const crawl: CrawlRecord = { crawlId, recipeId: recipe.id, version: version.version, schedule, startedAt: Date.now() };
    await pro.crawls.save(crawl);
    await pro.versions.markSubmitted(recipe.id, version.version);
    await api.setLive(remoteId, version.version, `Submitted v${version.version}`);
    await pro.recipes.moveLabel(recipe.id, 'live', version.version, author, 'Submitted to the backend');
    return crawl;
}

/** Reads each crawl's status from the backend and keeps it. A crawl that failed to read keeps its last. */
export async function refreshCrawls(api: BackendApi, recipeId: string): Promise<CrawlRecord[]> {
    const crawls = await pro.crawls.list(recipeId);
    for (const crawl of crawls) {
        try {
            crawl.last = await api.getCrawl(crawl.crawlId);
            crawl.checkedAt = Date.now();
            await pro.crawls.save(crawl);
        } catch (e) {
            if (e instanceof BackendError && e.kind === 'auth') throw e;
        }
    }
    return pro.crawls.list(recipeId);
}
