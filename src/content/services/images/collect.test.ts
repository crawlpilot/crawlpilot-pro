import { describe, it, expect, beforeEach } from 'vitest';
import { ImageCollector, cssImages } from './collect';
import { imageCandidates } from './source';
import { guessType, typeLabel } from '../../../shared/images/type';

const BASE = 'https://shop.test';
const byOrigin = (c: ImageCollector) => Object.fromEntries(c.all().map(i => [i.src.replace(BASE, ''), i.origin]));

beforeEach(() => {
    document.head.innerHTML = `<base href="${BASE}/">`;
    document.body.innerHTML = '';
});

describe('imageCandidates', () => {
    it('takes the widest srcset entry, not the one shown, and keeps the rest as variants', () => {
        document.body.innerHTML = '<img src="/s.jpg" srcset="/s.jpg 300w, /l.jpg 1600w, /m.jpg 800w" width="300" height="200">';
        const c = imageCandidates(document.querySelector('img')!);
        expect(c.src).toBe(`${BASE}/l.jpg`);
        expect(c.width).toBe(1600);
        expect(c.variants).toEqual(expect.arrayContaining([`${BASE}/s.jpg`, `${BASE}/m.jpg`]));
    });

    it('prefers a zoom attribute, reads <picture> sources and lazy attributes behind a placeholder', () => {
        document.body.innerHTML = '<img src="/t.jpg" data-zoom-image="/zoom.jpg">';
        expect(imageCandidates(document.querySelector('img')!).src).toBe(`${BASE}/zoom.jpg`);
        document.body.innerHTML = '<picture><source type="image/avif" srcset="/a-1x.avif 1x, /a-2x.avif 2x"><img src="/fallback.jpg"></picture>';
        expect(imageCandidates(document.querySelector('img')!).src).toBe(`${BASE}/a-2x.avif`);
        document.body.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/real.jpg">';
        const lazy = imageCandidates(document.querySelector('img')!);
        expect(lazy.src).toBe(`${BASE}/real.jpg`);
        expect(lazy.variants).toEqual([]);
    });
});

describe('cssImages', () => {
    it('reads every url(), and one image per image-set() (the densest)', () => {
        expect(cssImages('url("a.png"), linear-gradient(red, blue), url(b.jpg)')).toEqual([{ src: 'a.png', variants: [] }, { src: 'b.jpg', variants: [] }]);
        expect(cssImages('image-set(url("x1.jpg") 1x, url("x2.jpg") 2x)')).toEqual([{ src: 'x2.jpg', variants: ['x1.jpg'] }]);
        expect(cssImages('none')).toEqual([]);
    });
});

describe('ImageCollector', () => {
    it('finds every kind of image on the page', () => {
        document.head.innerHTML = `<base href="${BASE}/">
            <meta property="og:image" content="/og.jpg">
            <link rel="icon" href="/favicon.png" sizes="32x32">
            <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', image: ['/ld-1.jpg', { '@type': 'ImageObject', url: '/ld-2.jpg' }] })}</script>
            <style>.badge::after { content: ''; background-image: url("/badge.png"); }</style>`;
        document.body.innerHTML = `
            <h2>Gallery</h2>
            <figure><a href="/full/one.jpg"><img src="/thumb/one.jpg" alt="One"></a><figcaption>First photo</figcaption></figure>
            <a href="/files/two.png">two.png</a>
            <div style="background-image: url('/bg.jpg')"></div>
            <span class="badge"></span>
            <svg width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80"/><image href="/in-svg.png" width="40" height="40"/></svg>
            <svg width="16" height="16"><path d="M0 0h16v16z"/></svg>
            <video poster="/poster.jpg"></video>
            <input type="image" src="/button.png">
            <object data="/diagram.png" type="image/png"></object>
            <noscript><img src="/noscript.jpg"></noscript>
            <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
            <div style="display:none"><img src="/slide-2.jpg"></div>`;
        const c = new ImageCollector(document);
        c.scan();
        const batch = c.take();

        expect(byOrigin(c)).toMatchObject({
            '/og.jpg': 'meta', '/favicon.png': 'icon', '/ld-1.jpg': 'meta', '/ld-2.jpg': 'meta', '/badge.png': 'pseudo',
            '/thumb/one.jpg': 'img', '/files/two.png': 'link', '/bg.jpg': 'background', '/in-svg.png': 'svg-image',
            '/poster.jpg': 'video', '/button.png': 'input', '/diagram.png': 'object', '/noscript.jpg': 'noscript', '/slide-2.jpg': 'img',
        });
        const svgs = c.all().filter(i => i.origin === 'svg');
        expect(svgs).toHaveLength(1); // the 16px icon is left out
        expect(svgs[0]).toMatchObject({ width: 120, height: 80, type: 'image/svg+xml' });
        expect(c.all().some(i => i.src.startsWith('data:image/gif'))).toBe(false);
        expect(batch.added).toHaveLength(c.size);

        const one = c.all().find(i => i.src.endsWith('/thumb/one.jpg'))!;
        expect(one).toMatchObject({ linked: `${BASE}/full/one.jpg`, alt: 'One', caption: 'First photo', heading: 'Gallery', hidden: false, type: 'image/jpeg' });
        expect(c.all().find(i => i.src.endsWith('/slide-2.jpg'))!.hidden).toBe(true);
    });

    it('reads open shadow roots and same-origin frames', () => {
        const host = document.createElement('div');
        host.attachShadow({ mode: 'open' }).innerHTML = '<img src="/shadow.jpg">';
        document.body.append(host);
        const frame = document.createElement('iframe');
        document.body.append(frame);
        frame.contentDocument!.body.innerHTML = `<img src="${BASE}/framed.jpg">`;
        const c = new ImageCollector(document);
        c.scan();
        expect(Object.keys(byOrigin(c))).toEqual(expect.arrayContaining(['/shadow.jpg', '/framed.jpg']));
    });

    it('reads a changed subtree incrementally: new images added, known ones updated once', () => {
        document.body.innerHTML = '<div id="feed"><img src="/a.jpg"></div>';
        const c = new ImageCollector(document);
        c.scan();
        expect(c.take().added).toHaveLength(1);
        const feed = document.getElementById('feed')!;
        feed.innerHTML = '<a href="/a-full.jpg"><img src="/a.jpg"></a><img src="/b.jpg">';
        c.scan(feed);
        const batch = c.take();
        expect(batch.added.map(i => i.src)).toEqual([`${BASE}/b.jpg`]);
        expect(batch.updated.map(i => [i.src, i.linked])).toEqual([[`${BASE}/a.jpg`, `${BASE}/a-full.jpg`]]);
        c.scan(feed);
        expect(c.take()).toEqual({ added: [], updated: [] });

        c.setSize(`${BASE}/b.jpg`, 1200, 800);
        expect(c.take().updated.map(i => [i.width, i.height])).toEqual([[1200, 800]]);
    });
});

describe('guessType', () => {
    it('reads data URLs, extensions, CDN format parameters and Cloudinary transforms', () => {
        expect(guessType('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe('image/svg+xml');
        expect(guessType('https://a.test/p/photo.JPEG?w=200')).toBe('image/jpeg');
        expect(guessType('https://images.test/abc?fm=webp&w=400')).toBe('image/webp');
        expect(guessType('https://res.cloudinary.com/x/image/upload/f_avif,q_auto/v1/shoe')).toBe('image/avif');
        expect(guessType('https://cdn.test/image?id=42')).toBe('');
        expect(typeLabel('image/jpeg')).toBe('jpg');
        expect(typeLabel('image/svg+xml')).toBe('svg');
    });
});
