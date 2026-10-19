/**
 * One Image Downloader scan of the page: a quick read of what is there, then on request a deep scan
 * that scrolls the page so lazy images load, a live watch, and a size pass for images whose size the
 * markup doesn't give.
 *
 * After the first full read only what changes is read again: nodes added, and elements whose
 * `src`/`srcset`/`style`/`class` changed or whose image finished loading, batched every 250 ms. The deep
 * scan scrolls whichever element actually scrolls (often a feed `div`, not the window), waits until
 * the page goes quiet instead of a fixed delay, and stops when the end stops growing.
 */
import type { FoundImage, ImageBatch, ImageScanProgress } from '../../../shared/images/types';
import { ImageCollector } from './collect';

const FLUSH_MS = 250;
/** The page is settled when nothing has changed or loaded for this long… */
const QUIET_MS = 300;
/** …or after this long, whichever is first. */
const SETTLE_MAX_MS = 2000;
const SETTLE_MIN_MS = 120;
/** Steps at the bottom with no growth before the scroll ends (an infinite feed that stopped). */
const END_STEPS = 2;
const MAX_STEPS = 400;
/** Above this many changed roots, one full read is cheaper. */
const FULL_READ_AT = 1500;
const MEASURE_LIMIT = 400;
const MEASURE_CONCURRENCY = 6;
const MEASURE_TIMEOUT_MS = 8000;
const OBSERVED_ATTRIBUTES = ['src', 'srcset', 'style', 'class', 'data-src', 'data-srcset', 'data-lazy-src', 'data-original', 'poster', 'href'];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The element the page scrolls with: the document, or the largest scrolling container when the document doesn't. */
export function mainScroller(doc: Document): Element {
    const root = doc.scrollingElement || doc.documentElement;
    if (root.scrollHeight - root.clientHeight > 200) return root;
    let best: Element = root;
    let area = 0;
    for (const el of Array.from(doc.body?.querySelectorAll('*') ?? [])) {
        if (el.scrollHeight - el.clientHeight <= 200) continue;
        const overflow = doc.defaultView!.getComputedStyle(el).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') continue;
        const a = el.clientWidth * el.clientHeight;
        if (a > area) { area = a; best = el; }
    }
    return best;
}

export class ImageScanSession {
    readonly collector: ImageCollector;
    private observer: MutationObserver | null = null;
    private pending = new Set<Element>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastActivity = 0;
    private live = false;
    private readonly onLoad = (e: Event) => {
        if (e.target instanceof Element && e.target.tagName === 'IMG') this.touch(e.target);
    };

    constructor(private readonly emit: (batch: ImageBatch) => void, private readonly doc: Document = document) {
        this.collector = new ImageCollector(doc);
    }

    /** Reads the whole page. What it finds is the reply, so it isn't streamed too. */
    quick(): FoundImage[] {
        this.collector.scan(this.doc);
        this.collector.take();
        return this.collector.all();
    }

    /** Streams new images until `unwatch` (`live`: kept after a deep scan ends). */
    watch(live = false) {
        this.live = this.live || live;
        if (this.observer) return;
        this.observer = new MutationObserver(records => {
            for (const r of records) {
                if (r.type === 'attributes') this.touch(r.target as Element);
                else for (const node of Array.from(r.addedNodes)) if (node.nodeType === Node.ELEMENT_NODE) this.touch(node as Element);
            }
        });
        this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
        this.doc.addEventListener('load', this.onLoad, true);
    }

    unwatch() {
        this.live = false;
        this.observer?.disconnect();
        this.observer = null;
        this.doc.removeEventListener('load', this.onLoad, true);
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.flush();
    }

    private touch(el: Element) {
        this.lastActivity = Date.now();
        this.pending.add(el);
        this.timer ??= setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_MS);
    }

    /** Reads what changed and sends what is new or better. */
    flush() {
        const roots = [...this.pending].filter(el => el.isConnected);
        this.pending.clear();
        if (roots.length > FULL_READ_AT) this.collector.scan(this.doc);
        else for (const el of roots) if (!roots.some(other => other !== el && other.contains(el))) this.collector.scan(el);
        this.send();
    }

    private send() {
        const batch = this.collector.take();
        if (batch.added.length || batch.updated.length) this.emit(batch);
    }

    /** Waits until the page has been quiet for `QUIET_MS` (lazy loaders done), at most `SETTLE_MAX_MS`. */
    private async settle(signal: AbortSignal) {
        const start = Date.now();
        await wait(SETTLE_MIN_MS);
        while (!signal.aborted && Date.now() - start < SETTLE_MAX_MS && Date.now() - this.lastActivity < QUIET_MS) await wait(50);
    }

    /** Scrolls to the end and back, reading what loads. */
    async deep(signal: AbortSignal, onProgress: (p: ImageScanProgress) => void): Promise<FoundImage[]> {
        this.watch();
        const scroller = mainScroller(this.doc);
        const isRoot = scroller === (this.doc.scrollingElement || this.doc.documentElement);
        const view = this.doc.defaultView!;
        const origin = scroller.scrollTop;
        const viewport = isRoot ? view.innerHeight : scroller.clientHeight;
        const scrollTo = (top: number) => { if (isRoot) view.scrollTo({ top, behavior: 'instant' as ScrollBehavior }); else scroller.scrollTop = top; };

        let stuck = 0;
        for (let step = 0; step < MAX_STEPS && !signal.aborted; step++) {
            const height = scroller.scrollHeight;
            scrollTo(scroller.scrollTop + Math.round(viewport * 0.85));
            this.lastActivity = Date.now();
            await this.settle(signal);
            this.flush();
            const max = scroller.scrollHeight - scroller.clientHeight;
            onProgress({ phase: 'scrolling', percent: max > 0 ? Math.min(100, Math.round(scroller.scrollTop / max * 100)) : 100, found: this.collector.size });
            const atEnd = scroller.scrollTop >= max - 2;
            stuck = atEnd && scroller.scrollHeight <= height ? stuck + 1 : 0;
            if (stuck >= END_STEPS) break;
        }
        scrollTo(origin);
        this.flush();
        if (!this.live) this.unwatch();
        return this.collector.all();
    }

    /** Loads images of unknown size to read their natural size. Streams the sizes as updates. */
    async measure(signal: AbortSignal) {
        const todo = this.collector.all().filter(i => !i.width || !i.height).slice(0, MEASURE_LIMIT);
        let next = 0;
        const worker = async () => {
            while (next < todo.length && !signal.aborted) {
                const image = todo[next++];
                const size = await naturalSize(image.src, this.doc);
                if (size) this.collector.setSize(image.src, size.width, size.height);
                if (next % 12 === 0) this.send();
            }
        };
        await Promise.all(Array.from({ length: MEASURE_CONCURRENCY }, worker));
        this.send();
    }
}

function naturalSize(src: string, doc: Document): Promise<{ width: number; height: number } | null> {
    return new Promise(resolve => {
        const img = new (doc.defaultView!.Image)();
        const done = (size: { width: number; height: number } | null) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(size); };
        const timer = setTimeout(() => done(null), MEASURE_TIMEOUT_MS);
        img.onload = () => done(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
        img.onerror = () => done(null);
        img.src = src;
    });
}
