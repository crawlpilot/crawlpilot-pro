import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { extractPage } from './extractPage';
import type { ElementDefinition } from './types';

beforeAll(() => { Element.prototype.scrollIntoView = () => undefined; });

/** Tabs that render the open panel only (React-style): opening Reviews removes the specs. */
function tabsPage() {
    document.body.innerHTML = `
        <h1>Desk Lamp</h1>
        <div role="tablist">
            <button role="tab" id="t-specs" aria-selected="false" aria-controls="p">Specifications</button>
            <button role="tab" id="t-reviews" aria-selected="false" aria-controls="p">Reviews</button>
        </div>
        <section id="p"></section>`;
    const panel = document.getElementById('p')!;
    const open = (tab: string, html: string) => () => setTimeout(() => {
        document.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.id === tab)));
        panel.innerHTML = html;
    }, 50);
    document.getElementById('t-specs')!.addEventListener('click', open('t-specs', '<table class="specs"><tbody><tr><td>Wattage</td><td>40 W</td></tr><tr><td>Cable</td><td>2 m</td></tr></tbody></table>'));
    document.getElementById('t-reviews')!.addEventListener('click', open('t-reviews', '<p class="reviews">128 reviews</p>'));
}

const step = (id: string, action: 'click' | 'extract', selector: string, type = 'text'): ElementDefinition => ({ id, name: id, action, type, selectors: [selector] });

describe('Page Extractor steps', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('run in the recipe\'s order: what a click reveals is read before the next click hides it', async () => {
        tabsPage();
        const record = await extractPage([
            step('title', 'extract', 'h1'),
            step('open_specs', 'click', '#t-specs'),
            step('specs', 'extract', 'table.specs', 'table'),
            step('open_reviews', 'click', '#t-reviews'),
            step('reviews', 'extract', 'p.reviews'),
        ], { clickWaitMs: 300 });
        expect(record.item.title).toBe('Desk Lamp');
        expect(String(record.item.specs)).toContain('40 W');
        expect(record.item.reviews).toBe('128 reviews');
        expect(record.steps.map(s => `${s.id}:${s.status}`)).toEqual(['title:ok', 'open_specs:clicked', 'specs:ok', 'open_reviews:clicked', 'reviews:ok']);
        // A click step is not a column.
        expect(record.item).not.toHaveProperty('open_specs');
    });

    it('does not click a control that is already open (a second click would close it)', async () => {
        document.body.innerHTML = '<button id="b" aria-expanded="true">Specs</button><div id="s">40 W</div>';
        let clicks = 0;
        document.getElementById('b')!.addEventListener('click', () => clicks++);
        const record = await extractPage([step('open', 'click', '#b'), step('s', 'extract', '#s')], { clickWaitMs: 200 });
        expect(clicks).toBe(0);
        expect(record.steps[0].status).toBe('already-open');
        expect(record.item.s).toBe('40 W');
    });

    it('opens what the control\'s markup says when clicking changes nothing; reports a click that does nothing', async () => {
        document.body.innerHTML = `
            <details><summary id="sum">More</summary><p id="more">Made in Portugal</p></details>
            <button id="b" aria-expanded="false" aria-controls="panel">Specs</button><div id="panel" hidden><span id="w">40 W</span></div>
            <button id="dead">Nothing</button>`;
        // A script-driven page ignoring the summary's default toggle.
        document.getElementById('sum')!.addEventListener('click', e => e.preventDefault());
        const record = await extractPage([
            step('open_more', 'click', '#sum'), step('more', 'extract', '#more'),
            step('open_specs', 'click', '#b'), step('w', 'extract', '#w'),
            step('dead', 'click', '#dead'),
        ], { clickWaitMs: 200 });
        expect(record.steps.map(s => s.status)).toEqual(['opened', 'ok', 'opened', 'ok', 'no-effect']);
        expect(document.querySelector('details')!.hasAttribute('open')).toBe(true);
        expect((document.getElementById('panel') as HTMLElement).hidden).toBe(false);
    });
});
