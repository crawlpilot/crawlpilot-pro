/**
 * The run's clock in a hidden tab: waits are timed by the service worker, not by the page's timers,
 * which Chrome throttles there. Here the page's `setTimeout` is made 20× slower (as a heavy hidden
 * page sees it) while the "worker" answers on time; a recipe with clicks must still finish quickly.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { quiet, sleep, until } from './clock';
import { extractPage } from '../services/page/extractPage';

const realTimeout = globalThis.setTimeout;
let workerCalls = 0;
let frames = 0;

function hiddenTab(workerAnswers = true) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    (globalThis as any).chrome = {
        runtime: {
            id: 'test', lastError: undefined,
            sendMessage: (msg: any, cb: (r: unknown) => void) => {
                workerCalls++;
                if (!workerAnswers) { cb(undefined); return; }
                realTimeout(() => cb({ success: true }), msg.payload.ms);
            },
        },
    };
    // The page's own timers, throttled.
    vi.stubGlobal('setTimeout', ((fn: () => void, ms = 0) => realTimeout(fn, Math.max(ms * 20, 1000))) as any);
}

beforeAll(() => { Element.prototype.scrollIntoView = () => undefined; });
beforeEach(() => { workerCalls = 0; frames = 0; document.addEventListener('crawlpilot:frame', () => frames++); });
afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as any).visibilityState;
    delete (globalThis as any).chrome;
    document.body.innerHTML = '';
});

describe('the run clock in a hidden tab', () => {
    it('sleep is the worker\'s, and runs an animation frame on each tick', async () => {
        hiddenTab();
        const t = performance.now();
        await sleep(200);
        expect(performance.now() - t).toBeLessThan(600);
        expect(workerCalls).toBe(1);
        expect(frames).toBe(1);
    });

    it('no answer from the worker: the page timer, not a spin', async () => {
        hiddenTab(false);
        const t = performance.now();
        await until(() => false, 150);
        // Throttled page timers (≥ 1 s), and only a couple of ticks: no tight loop.
        expect(performance.now() - t).toBeGreaterThanOrEqual(900);
        expect(workerCalls).toBeLessThan(3);
    });

    it('quiet: waits out a burst of changes, in real time', async () => {
        hiddenTab();
        document.body.innerHTML = '<ul id="l"></ul>';
        let n = 0;
        const add = () => { if (n++ < 3) { document.getElementById('l')!.appendChild(document.createElement('li')); realTimeout(add, 80); } };
        add();
        const t = performance.now();
        await quiet(document.body, 200, 3000);
        expect(n).toBeGreaterThanOrEqual(3);
        expect(performance.now() - t).toBeLessThan(1500);
    });

    it('a recipe with clicks finishes in real time though the page\'s timers are 20× slower', async () => {
        hiddenTab();
        document.body.innerHTML = `<h1>Oversized T-shirt</h1>
            <button id="size" aria-expanded="false">Select size</button><div id="sizes"></div>
            <button id="details" aria-expanded="false">Details</button><div id="panel"></div>`;
        // The page answers clicks at once (its handlers and rendering aren't timers).
        document.getElementById('size')!.addEventListener('click', e => {
            (e.currentTarget as HTMLElement).setAttribute('aria-expanded', 'true');
            document.getElementById('sizes')!.innerHTML = '<span class="m">M · in stock</span>';
        });
        document.getElementById('details')!.addEventListener('click', e => {
            (e.currentTarget as HTMLElement).setAttribute('aria-expanded', 'true');
            document.getElementById('panel')!.innerHTML = '<p class="mat">100% cotton</p>';
        });
        const step = (id: string, action: 'click' | 'extract', selector: string) => ({ id, name: id, action, type: 'text', selectors: [selector] });
        const t = performance.now();
        const record = await extractPage([
            step('title', 'extract', 'h1'),
            step('open_size', 'click', '#size'), step('size', 'extract', '.m'),
            step('open_details', 'click', '#details'), step('material', 'extract', '.mat'),
        ], { clickWaitMs: 2000 });
        const took = performance.now() - t;
        expect(record.item).toMatchObject({ title: 'Oversized T-shirt', size: 'M · in stock', material: '100% cotton' });
        expect(record.steps.map(s => s.status)).toEqual(['ok', 'clicked', 'ok', 'clicked', 'ok']);
        // On the page's throttled timers each click's settle alone would take ≥ 6 s (300 ms × 20).
        expect(took).toBeLessThan(2500);
        expect(workerCalls).toBeGreaterThan(0);
    }, 20_000);
});
