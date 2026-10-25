import { afterEach, describe, expect, it } from 'vitest';
import { SelectionPath, visibleSteps, type RectOf } from './path';

afterEach(() => { document.body.innerHTML = ''; });

/** Boxes from `data-box="top left width height"`; none means no box (display: contents, hidden). */
const rectOf: RectOf = el => {
    const [top, left, width, height] = (el.getAttribute('data-box') ?? '0 0 0 0').split(' ').map(Number);
    return { top, left, width, height };
};

const ids = (els: HTMLElement[]) => els.map(e => e.id);

function card() {
    document.body.innerHTML = `
        <div id="grid" data-box="0 0 900 600">
          <div id="card1" data-box="0 0 300 300">
            <div id="wrap" data-box="0 0 300 300">
              <div id="contents">
                <div id="block" data-box="200 10 200 40">
                  <span id="price" data-box="200 10 80 20">$24.99</span>
                  <span id="was" data-box="220 10 80 20">$30.00</span>
                </div>
              </div>
              <h3 id="title" data-box="150 10 280 30">Desk lamp</h3>
            </div>
          </div>
          <div id="spacer" data-box="0 300 10 300"></div>
          <div id="card2" data-box="0 310 300 300"><h3 data-box="150 320 280 30">Floor lamp</h3></div>
        </div>`;
}

describe('the selection path', () => {
    it('only steps that change the outline: a wrapper with the same box, or no box, is not a step', () => {
        card();
        expect(ids(visibleSteps(document.getElementById('price')!, rectOf))).toEqual(['price', 'block', 'card1', 'grid']);
    });

    it('wider then narrower returns to where the cursor started, and below it into its first child', () => {
        card();
        const path = new SelectionPath(document.getElementById('price')!, rectOf);
        expect(path.wider()).toBe(true);
        expect(path.wider()).toBe(true);
        expect(path.current.id).toBe('card1');
        path.narrower();
        path.narrower();
        expect(path.current.id).toBe('price');
        // At the start: into a child that looks different (the block's first part).
        const block = new SelectionPath(document.getElementById('block')!, rectOf);
        expect(block.narrower()).toBe(true);
        expect(block.current.id).toBe('price');
        expect(block.narrower()).toBe(false);
    });

    it('next / previous at the same level skip empty spacers; the path above stays', () => {
        card();
        const path = new SelectionPath(document.getElementById('price')!, rectOf);
        path.wider();
        path.wider();
        expect(path.current.id).toBe('card1');
        expect(path.sibling(1)).toBe(true);
        expect(path.current.id).toBe('card2');
        expect(path.wider()).toBe(true);
        expect(path.current.id).toBe('grid');
        // Siblings of the price inside its block.
        const price = new SelectionPath(document.getElementById('price')!, rectOf);
        expect(price.sibling(1)).toBe(true);
        expect(price.current.id).toBe('was');
        expect(price.sibling(1)).toBe(false);
    });

    it('a breadcrumb jumps to its step', () => {
        card();
        const path = new SelectionPath(document.getElementById('price')!, rectOf);
        expect(path.at(3)).toBe(true);
        expect(path.current.id).toBe('grid');
        expect(path.at(9)).toBe(false);
    });
});
