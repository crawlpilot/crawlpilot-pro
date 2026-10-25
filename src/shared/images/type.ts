/**
 * An image's MIME type from its URL alone: a `data:` URL's own type, the path's extension, or a CDN's
 * format parameter (`fm=webp`, `format=png`, Cloudinary `f_webp`). '' when the URL doesn't say:
 * the file's `content-type` decides once it is fetched.
 */

const BY_EXTENSION: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', png: 'image/png', apng: 'image/png',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', jxl: 'image/jxl',
};

const FORMAT_PARAMS = ['fm', 'format', 'f', 'ext', 'type'];

export function typeFromExtension(ext: string): string {
    return BY_EXTENSION[ext.toLowerCase()] ?? '';
}

export function guessType(url: string): string {
    if (url.startsWith('data:')) return /^data:([^;,]+)/.exec(url)?.[1]?.toLowerCase() ?? '';
    let parsed: URL;
    try { parsed = new URL(url); } catch { return ''; }
    const ext = /\.([a-z0-9]{2,5})$/i.exec(parsed.pathname)?.[1];
    if (ext && typeFromExtension(ext)) return typeFromExtension(ext);
    for (const name of FORMAT_PARAMS) {
        const value = parsed.searchParams.get(name);
        if (value && typeFromExtension(value)) return typeFromExtension(value);
    }
    const cloudinary = /\/f_([a-z0-9]+)[,/]/i.exec(parsed.pathname)?.[1];
    if (cloudinary && typeFromExtension(cloudinary)) return typeFromExtension(cloudinary);
    // An extension inside the path (`/photo.jpg/w_300`, `/image.png?…` behind a rewrite).
    const inner = /\.(jpe?g|png|gif|webp|avif|svg)(?=[/_.?-])/i.exec(parsed.pathname)?.[1];
    return inner ? typeFromExtension(inner) : '';
}

/** The short name shown on cards and used in file names: `jpg`, `png`, `webp`, …; '' when unknown. */
export function typeLabel(type: string): string {
    if (!type) return '';
    const sub = type.split('/')[1] ?? '';
    return sub === 'jpeg' ? 'jpg' : sub === 'svg+xml' ? 'svg' : sub === 'x-icon' ? 'ico' : sub;
}

/** Whether a link's URL points at an image file. */
export function looksLikeImageUrl(url: string): boolean {
    try {
        const { pathname } = new URL(url);
        return /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|jxl)$/i.test(pathname);
    } catch {
        return false;
    }
}
