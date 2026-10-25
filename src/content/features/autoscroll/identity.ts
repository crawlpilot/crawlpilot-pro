/**
 * Which item a list element shows (docs/plans/virtual-feeds-plan.md §3.1), so a scrolled list reads each
 * item once though its nodes come and go: a virtual list unmounts items and mounts them again as new
 * nodes (with a freshly signed image URL), or recycles one node for item after item.
 *
 * The key is what the item links to (each link's address without query or hash), else an identity
 * attribute on it (`data-id`, `data-sku`…), else its text and images. Links shared by every item (an
 * "Add to cart" `#`, the author's profile on a feed of one author) don't tell items apart: `withText`
 * adds the text for those.
 */
import { IDENTITY_ATTRIBUTE } from '../../../shared/selectors/stability';

const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);

function links(el: Element): string[] {
    const anchors = el.matches('a[href]') ? [el, ...el.querySelectorAll('a[href]')] : Array.from(el.querySelectorAll('a[href]'));
    const out = new Set<string>();
    for (const a of anchors) {
        try {
            const url = new URL(a.getAttribute('href')!, location.href);
            if (/^https?:$/.test(url.protocol)) out.add(url.origin + url.pathname);
        } catch { /* not a URL */ }
    }
    return [...out];
}

function identity(el: Element): string {
    for (const node of [el, ...el.querySelectorAll('*')].slice(0, 40)) {
        for (const a of Array.from(node.attributes)) if (IDENTITY_ATTRIBUTE.test(a.name) && a.value) return `${a.name}=${a.value}`;
    }
    return '';
}

/** Images by address without query (a re-render signs them anew), and their alt text. */
const images = (el: Element) => Array.from(el.querySelectorAll('img')).slice(0, 4).map(img => {
    const src = (img.getAttribute('src') || '').split(/[?#]/)[0];
    return `${src.startsWith('data:') ? '' : src} ${img.getAttribute('alt') || ''}`.trim();
}).filter(Boolean).join(' ');

/** The item's key; '' for a placeholder (nothing in it yet), which is read once it fills. */
export function itemKey(el: Element, withText = false): string {
    const own = links(el);
    if (own.length) return `l:${own.join(' ')}${withText ? `|${text(el)}` : ''}`;
    const id = identity(el);
    if (id) return `i:${id}`;
    const content = `${text(el)}|${images(el)}`;
    return content === '|' ? '' : `t:${content}`;
}

/**
 * Keys for a list's items over a run. Links alone don't tell items apart when two items share them:
 * two in view at once with the same link key, or an item whose links were seen before on another text
 * (a feed's posts that only link their author). Such link keys add the text from then on, so the same
 * item gets the same key on every later step.
 */
export class ItemKeys {
    private textKeyed = new Set<string>();
    private textOf = new Map<string, string>();

    keys(els: Element[]): string[] {
        const base = els.map(el => itemKey(el));
        const counts = new Map<string, number>();
        base.forEach((k, i) => {
            if (!k.startsWith('l:')) return;
            counts.set(k, (counts.get(k) ?? 0) + 1);
            const t = text(els[i]);
            const before = this.textOf.get(k);
            // An item that filled in since (more text, the same start) is the same item.
            if (before === undefined || t.includes(before)) this.textOf.set(k, t);
            else if (!before.includes(t)) this.textKeyed.add(k);
        });
        for (const [k, n] of counts) if (n > 1) this.textKeyed.add(k);
        return els.map((el, i) => (this.textKeyed.has(base[i]) ? itemKey(el, true) : base[i]));
    }

    key(el: Element): string {
        return this.keys([el])[0];
    }
}

/** In the order they are on screen (top to bottom, then left to right): a recycled list's DOM order isn't. */
export function visualOrder<T extends Element>(els: T[]): T[] {
    const at = new Map(els.map(el => { const r = el.getBoundingClientRect(); return [el, { top: Math.round(r.top), left: r.left, shown: r.width > 0 || r.height > 0 }]; }));
    return els.slice().sort((a, b) => {
        const pa = at.get(a)!, pb = at.get(b)!;
        if (pa.shown !== pb.shown) return pa.shown ? -1 : 1;
        if (!pa.shown) return 0;
        return pa.top - pb.top || pa.left - pb.left;
    });
}
