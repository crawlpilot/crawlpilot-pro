import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHIM = readFileSync(resolve(__dirname, '../../../public/visible-shim.js'), 'utf8');

describe('visible-shim.js (a hidden run tab that behaves like a visible one)', () => {
    it('acts only in a tab that starts hidden', () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        new Function(SHIM)();
        expect((window as any).__crawlpilotVisible).toBeUndefined();
        delete (document as any).visibilityState;
    });

    it('reports the page visible and focused, swallows visibilitychange, and runs animation frames', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        new Function(SHIM)();
        // The tab's own "hidden" (set above on the instance) is gone once the page asks the prototype.
        delete (document as any).visibilityState;
        expect(document.visibilityState).toBe('visible');
        expect(document.hidden).toBe(false);
        expect(document.hasFocus()).toBe(true);

        let heard = 0;
        document.addEventListener('visibilitychange', () => heard++);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(heard).toBe(0);

        // An animation driven by elapsed time reaches its end.
        const done = await new Promise<number>(res => {
            const start = performance.now();
            let frames = 0;
            const step = (now: number) => { frames++; if (now - start < 50) requestAnimationFrame(step); else res(frames); };
            requestAnimationFrame(step);
        });
        expect(done).toBeGreaterThan(1);
        const id = requestAnimationFrame(() => { throw new Error('cancelled frame ran'); });
        cancelAnimationFrame(id);
        await new Promise(r => setTimeout(r, 40));
    });
});
