import { AUTHOR_ATTRIBUTES, isNamingClass, isStableAttributeValue } from '../../../shared/selectors/stability';

/** A node's stable label (part of a field's signature) and a CSS step that matches it. */
export interface NodeStep {
    label: string;
    css: string;
}

const PLAIN_IDENT = /^-?[_a-zA-Z][\w-]*$/;

function attrSelector(attr: string, value: string): string {
    return `[${attr}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * Label and CSS step for a node. Priority: author attribute (`AUTHOR_ATTRIBUTES`) > semantic tag >
 * first naming class > tag+role > bare tag. Hashed, state and utility classes (by name or by how
 * widely the page uses them) are skipped so the label survives redeploys.
 */
export function nodeStep(t: Element): NodeStep {
    const cached = stepCache?.get(t);
    if (cached) return cached;
    const step = computeStep(t);
    stepCache?.set(t, step);
    return step;
}

let stepCache: WeakMap<Element, NodeStep> | null = null;

/** Memoises `nodeStep` while set (see `withAtomCache`); null turns it off. */
export function setStepCache(cache: WeakMap<Element, NodeStep> | null) {
    stepCache = cache;
}

/** A hook that ends in a position: `slider-image-3`, `item_12`, `slide2`. */
const INDEXED = /^(.*[a-z][-_]?)(\d{1,3})$/i;

function computeStep(t: Element): NodeStep {
    for (const attr of AUTHOR_ATTRIBUTES) {
        const val = t.getAttribute(attr);
        if (!val || !isStableAttributeValue(attr, val)) continue;
        // The position is not part of what the node is: gallery slides `…-image-0` to `…-image-12`
        // are one kind of node, read as one field (a list), not a field per position.
        const indexed = INDEXED.exec(val);
        if (indexed) return { label: `${indexed[1]}#`, css: `[${attr}^="${indexed[1].replace(/["\\]/g, '\\$&')}"]` };
        return { label: val, css: attrSelector(attr, val) };
    }

    const tag = t.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === 'a' || tag === 'img' || tag === 'time' || tag === 'button') {
        return { label: tag, css: tag };
    }

    const classes = (t.getAttribute('class') || '').split(/\s+/).filter(c =>
        c && !/^(js|data)-/.test(c) && isNamingClass(c, t.ownerDocument ?? document)
    );
    if (classes.length > 0) {
        const c = classes[0];
        // `[class~="x"]` covers class names that aren't plain identifiers (Tailwind `w-1/2`, `md:flex`).
        return { label: c, css: PLAIN_IDENT.test(c) ? `.${c}` : attrSelector('class~', c) };
    }

    const role = t.getAttribute('role');
    if (role) return { label: `${tag}[${role}]`, css: `${tag}${attrSelector('role', role)}` };

    return { label: tag, css: tag };
}
