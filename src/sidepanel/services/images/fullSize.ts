/**
 * The full-size original of an image, if there is a larger one: the image the link around it points
 * to, and the CDN rewrites of both (`shared/images/fullsize.ts`). Each candidate is probed; the
 * largest real image wins if it is clearly larger than the one found on the page. Images with no
 * candidate cost no request.
 */
import type { FoundImage, FullSize } from '../../../shared/images/types';
import { fullSizeCandidates } from '../../../shared/images/fullsize';
import type { Probe } from './probe';

/** At most this many candidates are probed per image. */
const MAX_CANDIDATES = 4;
/** A candidate must have this many times the pixels to count as larger (not a re-encode). */
const LARGER = 1.2;

interface Candidate { url: string; via: string }

export function candidatesFor(image: Pick<FoundImage, 'src' | 'linked'>): Candidate[] {
    const out: Candidate[] = [];
    if (image.linked && image.linked !== image.src) out.push({ url: image.linked, via: 'link' });
    for (const c of fullSizeCandidates(image.src)) out.push({ url: c.url, via: c.rule });
    if (image.linked) for (const c of fullSizeCandidates(image.linked)) out.push({ url: c.url, via: `link+${c.rule}` });
    const seen = new Set<string>();
    return out.filter(c => !seen.has(c.url) && seen.add(c.url)).slice(0, MAX_CANDIDATES);
}

export async function findFullSize(
    image: FoundImage,
    probe: (url: string) => Promise<Probe | null>,
): Promise<FullSize | null> {
    const candidates = candidatesFor(image);
    if (!candidates.length) return null;
    let base = image.width * image.height;
    if (!base) {
        const own = await probe(image.src);
        base = own ? own.width * own.height : 0;
    }
    let best: (Probe & { via: string }) | null = null;
    for (const c of candidates) {
        const p = await probe(c.url);
        if (p && p.width * p.height > (best ? best.width * best.height : 0)) best = { ...p, via: c.via };
    }
    if (!best || !best.width || best.width * best.height < base * LARGER) return null;
    return { src: best.url, width: best.width, height: best.height, type: best.type, bytes: best.bytes, via: best.via };
}
