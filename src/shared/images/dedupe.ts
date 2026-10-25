/**
 * The same picture listed more than once, folded into one entry:
 *
 * - **URL variants** (free, no request): one file at several sizes (`?w=300` and `?w=1200`, a Shopify
 *   `_300x300`, a WordPress `-300x200`) shares a canonical URL: the full-size rewrite of
 *   `shared/images/fullsize.ts`.
 * - **Look-alikes** (after hashing the pixels, `dhash.ts`): the same picture under unrelated URLs,
 *   another CDN or format.
 *
 * Each group keeps its largest image (the earliest on the page on a tie), with the others' URLs in
 * `duplicates`; the result is in page order.
 */
import type { FoundImage } from './types';
import { fullSizeCandidates } from './fullsize';
import { hammingDistance, SAME_PICTURE } from './dhash';

/** The URL with its size taken out; inline images are their own. */
export function canonicalUrl(src: string): string {
    if (src.startsWith('data:') || src.startsWith('blob:')) return src;
    return fullSizeCandidates(src)[0]?.url ?? src;
}

const pixels = (i: FoundImage) => { const s = i.full ?? i; return s.width * s.height; };

export function foldDuplicates(images: FoundImage[], hashes: ReadonlyMap<string, string> = new Map()): FoundImage[] {
    const parent = images.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (a: number, b: number) => { parent[find(a)] = find(b); };

    const byUrl = new Map<string, number>();
    images.forEach((img, i) => {
        for (const key of [canonicalUrl(img.src), img.full?.src].filter((k): k is string => !!k)) {
            const seen = byUrl.get(key);
            if (seen === undefined) byUrl.set(key, i); else join(i, seen);
        }
    });
    const hashed = images.map((img, i) => [i, hashes.get(img.src)] as const).filter((e): e is readonly [number, string] => !!e[1]);
    for (let a = 0; a < hashed.length; a++) {
        for (let b = a + 1; b < hashed.length; b++) {
            if (hammingDistance(hashed[a][1], hashed[b][1]) <= SAME_PICTURE) join(hashed[a][0], hashed[b][0]);
        }
    }

    const groups = new Map<number, FoundImage[]>();
    images.forEach((img, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), img]));
    const kept: FoundImage[] = [];
    for (const members of groups.values()) {
        if (members.length === 1) { kept.push(members[0]); continue; }
        const best = members.reduce((a, b) => (pixels(b) > pixels(a) || (pixels(b) === pixels(a) && b.order < a.order) ? b : a));
        kept.push({ ...best, duplicates: members.filter(m => m !== best).map(m => m.src) });
    }
    return kept.sort((a, b) => a.order - b.order);
}
