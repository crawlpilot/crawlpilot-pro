/**
 * File names for saved images, from a template. Tokens:
 *
 * - `{name}`: the file's own name from its URL (`IMG_0042`); `image` when the URL has none
 * - `{n}`: its number in the selection, zero-padded (`007` of 250)
 * - `{site}`: the page's host without `www.`
 * - `{page}`: the page title
 * - `{alt}`: its alt text, title or caption
 * - `{heading}`: the heading above it on the page
 * - `{width}`, `{height}`: its size in pixels (empty when unknown)
 * - `{date}`: today, `2026-10-19`
 *
 * `/` makes folders. Each part is made safe for Windows, macOS and Linux and for `chrome.downloads`
 * (no reserved names, no leading dots, no `..`), and a part that comes out empty is dropped. The
 * extension comes from the file's real type. Names are unique within a run (`photo`, `photo-2`).
 */
import type { FoundImage } from '../../../shared/images/types';

export const NAMING_PRESETS = {
    original: { label: 'Original file names', template: '{name}' },
    numbered: { label: 'Page title / number', template: '{page}/{n}' },
    described: { label: 'Number and alt text', template: '{n}-{alt}' },
    sections: { label: 'Section / original name', template: '{heading}/{name}' },
} as const;

export interface NameContext {
    image: FoundImage;
    /** 1-based position in the selection. */
    n: number;
    total: number;
    pageTitle: string;
    date: string;
}

const PART_MAX = 80;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function safePart(text: string): string {
    const part = text
        .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-{2,}/g, '-')
        .trim()
        .slice(0, PART_MAX)
        .replace(/^[.\s-]+|[.\s-]+$/g, '');
    return RESERVED.test(part) ? `_${part}` : part;
}

/** The last path segment of the URL without its extension, decoded. */
function urlName(src: string): string {
    if (src.startsWith('data:') || src.startsWith('blob:')) return '';
    try {
        const segment = new URL(src).pathname.split('/').filter(Boolean).pop() ?? '';
        return decodeURIComponent(segment).replace(/\.[a-z0-9]{2,5}$/i, '');
    } catch {
        return '';
    }
}

function site(pageUrl: string): string {
    try { return new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** The template filled in for one image: a relative path without the extension. */
export function renderName(template: string, ctx: NameContext): string {
    const { image } = ctx;
    const values: Record<string, string> = {
        name: urlName(image.src) || 'image',
        n: String(ctx.n).padStart(String(ctx.total).length, '0'),
        site: site(image.pageUrl),
        page: ctx.pageTitle,
        alt: image.alt || image.title || image.caption || '',
        heading: image.heading || '',
        width: image.width ? String(image.width) : '',
        height: image.height ? String(image.height) : '',
        date: ctx.date,
    };
    const filled = template.replace(/\{(\w+)\}/g, (whole, token: string) => token in values ? values[token].replace(/\//g, '-') : whole);
    const parts = filled.split('/').map(safePart).filter(Boolean);
    const file = parts.pop();
    // Every token of the file part was empty: number it.
    return [...parts, file || `image-${values.n}`].join('/');
}

/** Makes names unique within a run (case-insensitively: Windows and macOS file systems ignore case). */
export class NameBook {
    private readonly used = new Set<string>();

    claim(path: string, ext: string): string {
        let candidate = `${path}.${ext}`;
        for (let i = 2; this.used.has(candidate.toLowerCase()); i++) candidate = `${path}-${i}.${ext}`;
        this.used.add(candidate.toLowerCase());
        return candidate;
    }
}

export function today(): string {
    return new Date().toISOString().slice(0, 10);
}
