/**
 * What a site's good pages usually look like, to tell a soft block from a page (`docs/design/crawler.md`,
 * Block identification). Some blocks come back as 200 with an ordinary-looking page that no vendor mark gives
 * away: a "please try later" stub, an empty shell. Per host and page type, the worker keeps a running typical
 * length of the visible text of pages the recipe read data from. A page that loads, gives the recipe nothing,
 * and is much shorter than typical is a soft block. A page of usual length that gives nothing is left alone:
 * that is more likely a recipe that no longer fits than a block, and Pro's maintenance flags it.
 */

export interface BaselineOptions {
    /** Good pages seen before the typical length is trusted. */
    minSamples?: number;
    /** A page shorter than this share of typical is a soft block when it gives no data. */
    shortShare?: number;
    /** Weight of a new page in the running typical length. */
    alpha?: number;
    /** Keys kept: the oldest beyond it are dropped. */
    maxKeys?: number;
}

export class PageBaselines {
    private typical = new Map<string, { samples: number; length: number }>();
    private minSamples: number;
    private shortShare: number;
    private alpha: number;
    private maxKeys: number;

    constructor(o: BaselineOptions = {}) {
        this.minSamples = o.minSamples ?? 5;
        this.shortShare = o.shortShare ?? 0.3;
        this.alpha = o.alpha ?? 0.2;
        this.maxKeys = o.maxKeys ?? 5000;
    }

    /** A page the recipe read data from. */
    good(key: string, textLength: number) {
        const t = this.typical.get(key);
        const next = t ? { samples: t.samples + 1, length: t.length + this.alpha * (textLength - t.length) } : { samples: 1, length: textLength };
        this.typical.delete(key);
        this.typical.set(key, next);
        if (this.typical.size > this.maxKeys) this.typical.delete(this.typical.keys().next().value!);
    }

    /** A page that gave no data: how short it is against typical, when that makes it a soft block. */
    softBlock(key: string, textLength: number): { share: number; typical: number } | undefined {
        const t = this.typical.get(key);
        if (!t || t.samples < this.minSamples || t.length <= 0) return undefined;
        const share = textLength / t.length;
        return share < this.shortShare ? { share, typical: Math.round(t.length) } : undefined;
    }
}
