import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { sniffType } from '../../../shared/images/sniff';
import type { FoundImage } from '../../../shared/images/types';
import { NameBook, renderName } from './naming';
import { runPool } from './pool';
import { fetchImage, FetchFailure, type InPage } from './fetchImage';
import { saveImages, type SaveDeps } from './save';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const ascii = (text: string) => new TextEncoder().encode(text);

const image = (src: string, extra: Partial<FoundImage> = {}): FoundImage =>
    ({ src, variants: [], width: 0, height: 0, type: '', origin: 'img', hidden: false, order: 0, pageUrl: 'https://www.shop.test/p/1', ...extra });

const noWait = async () => {};

/** A Blob's bytes (jsdom's Blob has no `arrayBuffer()`). */
const bytesOf = (blob: Blob) => new Promise<Uint8Array>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
});

describe('sniffType', () => {
    it('knows images by their bytes and nothing else', () => {
        expect(sniffType(JPEG)).toBe('image/jpeg');
        expect(sniffType(PNG)).toBe('image/png');
        expect(sniffType(ascii('GIF89a....'))).toBe('image/gif');
        expect(sniffType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
        expect(sniffType(ascii('\0\0\0\x1cftypavif'))).toBe('image/avif');
        expect(sniffType(ascii('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
        expect(sniffType(ascii('<!doctype html><html><body>Hotlinking not allowed</body></html>'))).toBe('');
    });
});

describe('file names', () => {
    const ctx = (img: FoundImage, n = 7) => ({ image: img, n, total: 250, pageTitle: 'Desk lamps: our picks', date: '2026-10-19' });

    it('fills tokens, makes folders, and keeps names safe on every OS', () => {
        const img = image('https://cdn.test/a/IMG%200042.JPG?w=300', { alt: 'Brass lamp / walnut base', heading: 'Lamps', width: 1200, height: 800 });
        expect(renderName('{name}', ctx(img))).toBe('IMG 0042');
        expect(renderName('{site}/{page}/{n}', ctx(img))).toBe('shop.test/Desk lamps- our picks/007');
        expect(renderName('{n}-{alt}-{width}x{height}', ctx(img))).toBe('007-Brass lamp - walnut base-1200x800');
        expect(renderName('{heading}/{name}', ctx(image('data:image/png;base64,AAAA')))).toBe('image');
        expect(renderName('{alt}', ctx(image('https://cdn.test/x.jpg')))).toBe('image-007');
        expect(renderName('../{alt}', ctx(image('https://cdn.test/x.jpg', { alt: 'CON' })))).toBe('_CON');
    });

    it('never reuses a name, ignoring case', () => {
        const book = new NameBook();
        expect([book.claim('photo', 'jpg'), book.claim('Photo', 'jpg'), book.claim('photo', 'png'), book.claim('photo', 'jpg')])
            .toEqual(['photo.jpg', 'Photo-2.jpg', 'photo.png', 'photo-3.jpg']);
    });
});

describe('runPool', () => {
    it('runs everything, at most N at once and at most M per host', async () => {
        const active = new Map<string, number>();
        let peak = 0;
        const peakPerHost = new Map<string, number>();
        const done: number[] = [];
        const items = Array.from({ length: 20 }, (_, i) => ({ i, host: i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'c' }));
        await runPool(items, it => it.host, async it => {
            active.set(it.host, (active.get(it.host) ?? 0) + 1);
            peakPerHost.set(it.host, Math.max(peakPerHost.get(it.host) ?? 0, active.get(it.host)!));
            peak = Math.max(peak, [...active.values()].reduce((a, b) => a + b, 0));
            await new Promise(r => setTimeout(r, 2));
            active.set(it.host, active.get(it.host)! - 1);
            done.push(it.i);
        }, { concurrency: 4, perKey: 2 });
        expect(done.sort((a, b) => a - b)).toEqual(items.map(it => it.i));
        expect(peak).toBeLessThanOrEqual(4);
        expect(Math.max(...peakPerHost.values())).toBe(2);
    });
});

/** A fetch answering from a list of responses, one per call. */
function scripted(...responses: (() => Response)[]) {
    const calls: RequestInit[] = [];
    const fn = (async (_url: string, init: RequestInit) => { calls.push(init); return responses[Math.min(calls.length - 1, responses.length - 1)](); }) as unknown as typeof fetch;
    return { fn, calls };
}

describe('fetchImage', () => {
    const signal = new AbortController().signal;

    it('retries 5xx and 429 with backoff, honouring Retry-After, and sends cookies', async () => {
        const waits: number[] = [];
        const { fn, calls } = scripted(
            () => new Response('busy', { status: 503 }),
            () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
            () => new Response(JPEG, { headers: { 'content-type': 'application/octet-stream' } }),
        );
        const got = await fetchImage('https://cdn.test/a.jpg', { signal, fetchFn: fn, sleep: async ms => { waits.push(ms); } });
        expect(got).toMatchObject({ type: 'image/jpeg', via: 'direct' });
        expect(waits).toEqual([600, 2000]);
        expect(calls[0].credentials).toBe('include');
    });

    it('asks the page when the server wants a login or a referrer; reports the direct reason when the page fails too', async () => {
        const pageOk: InPage = async () => ({ dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}` });
        const pageNo: InPage = async () => ({ error: 'HTTP 403', status: 403 });
        const login = scripted(() => new Response('', { status: 401 }));
        expect(await fetchImage('https://x.test/private.png', { signal, fetchFn: login.fn, inPage: pageOk, sleep: noWait })).toMatchObject({ type: 'image/png', via: 'page' });
        const html = scripted(() => new Response('<html>no hotlinking</html>', { headers: { 'content-type': 'text/html' } }));
        await expect(fetchImage('https://x.test/hot.jpg', { signal, fetchFn: html.fn, inPage: pageNo, sleep: noWait })).rejects.toMatchObject({ reason: 'not-image' });
        const gone = scripted(() => new Response('', { status: 404 }));
        await expect(fetchImage('https://x.test/gone.jpg', { signal, fetchFn: gone.fn, sleep: noWait })).rejects.toMatchObject({ reason: 'not-found', status: 404 });
    });

    it('decodes data: URLs here and needs the page for blob: URLs', async () => {
        const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
        expect(await fetchImage(svg, { signal })).toMatchObject({ type: 'image/svg+xml', via: 'inline' });
        await expect(fetchImage('blob:https://x.test/1234', { signal })).rejects.toBeInstanceOf(FetchFailure);
    });
});

describe('saveImages', () => {
    const files: Record<string, Uint8Array> = {
        'https://cdn.test/one.jpg': JPEG,
        'https://cdn.test/two': PNG, // no extension: the bytes give .png
        'https://cdn.test/one.jpg?v=2': JPEG, // same name: made unique
    };
    const deps = (saved: [string, Blob][]): SaveDeps => ({
        fetch: async url => {
            if (url.includes('blocked')) throw new FetchFailure('blocked', 403);
            return { bytes: files[url], type: sniffType(files[url]), via: 'direct' };
        },
        download: async (blob, filename) => { saved.push([filename, blob]); },
    });
    const images = [...Object.keys(files), 'https://cdn.test/blocked.jpg'].map(src => image(src));
    const base = { template: '{name}', pageTitle: 'Lamps', signal: new AbortController().signal };

    it('folder: one file each under CrawlPilot/<site>, real extensions, failures with reasons', async () => {
        const saved: [string, Blob][] = [];
        const progress: number[] = [];
        const report = await saveImages(images, { ...base, mode: 'folder', onProgress: p => progress.push(p.done + p.failed) }, deps(saved));
        expect(saved.map(([name]) => name).sort()).toEqual(['CrawlPilot/shop.test/one-2.jpg', 'CrawlPilot/shop.test/one.jpg', 'CrawlPilot/shop.test/two.png']);
        expect(report).toMatchObject({ done: 3, failed: 1, total: 4, stopped: false, failures: [{ src: 'https://cdn.test/blocked.jpg', reason: 'blocked', status: 403 }] });
        expect(progress[progress.length - 1]).toBe(4);
    });

    it('zip: one archive holding every saved file', async () => {
        const saved: [string, Blob][] = [];
        const report = await saveImages(images, { ...base, mode: 'zip', template: '{n}' }, deps(saved));
        expect(saved).toHaveLength(1);
        expect(saved[0][0]).toMatch(/^shop\.test-images-\d{4}-\d\d-\d\d\.zip$/);
        const entries = unzipSync(await bytesOf(saved[0][1]));
        expect(Object.keys(entries).sort()).toEqual(['1.jpg', '2.png', '3.jpg']);
        expect([...entries['2.png']]).toEqual([...PNG]);
        expect(report.done).toBe(3);
    });

    it('stop: what never started is reported as stopped, nothing lost from the count', async () => {
        const controller = new AbortController();
        const many = Array.from({ length: 30 }, (_, i) => image(`https://cdn.test/${i}.jpg`));
        const report = await saveImages(many, { ...base, mode: 'folder', signal: controller.signal, onProgress: p => { if (p.done === 3) controller.abort(); } }, {
            fetch: async () => { await new Promise(r => setTimeout(r, 1)); return { bytes: JPEG, type: 'image/jpeg', via: 'direct' }; },
            download: async () => {},
        });
        expect(report.stopped).toBe(true);
        expect(report.done + report.failed).toBe(30);
        expect(report.failures.every(f => f.reason === 'stopped')).toBe(true);
        expect(report.done).toBeLessThan(30);
    });
});
