/** Backend crawls started from Pro, and the last status read for each. */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { CrawlStatus, Schedule } from '../backend/types';

export interface CrawlRecord {
    crawlId: string;
    recipeId: string;
    version: number;
    schedule: Schedule;
    startedAt: number;
    last?: CrawlStatus;
    checkedAt?: number;
}

export async function saveCrawl(crawl: CrawlRecord): Promise<void> {
    const tx = await proTransaction(STORES.crawls, 'readwrite');
    tx.objectStore(STORES.crawls).put(crawl);
    await done(tx);
}

/** A recipe's crawls, the newest first. */
export async function listCrawls(recipeId: string): Promise<CrawlRecord[]> {
    const tx = await proTransaction(STORES.crawls);
    const all = await req<CrawlRecord[]>(tx.objectStore(STORES.crawls).index('recipeId').getAll(recipeId));
    return all.sort((a, b) => b.startedAt - a.startedAt);
}
