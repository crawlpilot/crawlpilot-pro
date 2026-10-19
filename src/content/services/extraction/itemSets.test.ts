import { describe, it, expect, beforeEach } from 'vitest';
import { expandItemSet, itemFingerprint } from './itemSets';
import type { ListMatch } from './items';

const card = (n: number, cls = 'product-card') =>
    `<li class="${cls}" data-product-id="${n}"><img src="/p${n}.jpg"><h3>Lamp ${n}</h3><span class="price">$${n}9.99</span><a href="/p/${n}">View</a></li>`;

/** What `findList` would return for the list holding `el`: its parent and the parent's children. */
function siblingsOf(el: Element): ListMatch {
    const container = el.parentElement as HTMLElement;
    const siblings = Array.from(container.children) as HTMLElement[];
    return { isContainer: true, container, siblings, childCount: siblings.length };
}

const clickIn = (selector: string, n = 0) => document.querySelectorAll(selector)[n].querySelector('h3, a')!;

beforeEach(() => { document.body.innerHTML = ''; });

describe('itemFingerprint', () => {
    it('names the clicked item by what most items share; a different cell among them does not block it', () => {
        document.body.innerHTML = `<ul>${card(1)}<li class="ad-cell"><img src="/ad.jpg"><p>Sponsored</p></li>${card(2)}${card(3)}</ul>`;
        const items = Array.from(document.querySelectorAll('li'));
        expect(itemFingerprint(items, items[0])).toBe('li.product-card');
    });

    it('uses an identity attribute when nothing else names the items, and gives up on bare wrappers', () => {
        document.body.innerHTML = '<div><div data-sku="1">a</div><div data-sku="2">b</div></div>';
        expect(itemFingerprint(Array.from(document.querySelectorAll('[data-sku]')))).toBe('div[data-sku]');
        document.body.innerHTML = '<div><div>a</div><div>b</div></div>';
        expect(itemFingerprint(Array.from(document.body.firstElementChild!.children))).toBeNull();
    });
});

describe('expandItemSet', () => {
    it('joins a grid rendered as one list per row into one set', () => {
        document.body.innerHTML = `<main><h2>Results</h2><div class="grid">
            <div><ul class="row">${card(1)}${card(2)}${card(3)}</ul></div>
            <div><ul class="row">${card(4)}${card(5)}${card(6)}</ul></div>
            <div><ul class="row">${card(7)}${card(8)}</ul></div></div></main>`;
        const clicked = clickIn('li.product-card', 4);
        const set = expandItemSet(siblingsOf(clicked.closest('li')!), clicked);
        expect(set.siblings.map(s => s.getAttribute('data-product-id'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        expect(set.container!.className).toBe('grid');
        expect(set.groups).toHaveLength(1);
        expect(set.groups[0]).toMatchObject({ kind: 'results', heading: 'Results' });
    });

    it('a sponsored shelf is its own group; clicking it chooses the results and keeps the shelf as an alternative', () => {
        document.body.innerHTML = `
            <section class="shelf"><span>Sponsored</span><ul class="shelf-row">${card(91)}${card(92)}${card(93)}</ul></section>
            <section><h2>All results</h2><ol class="results">${card(1)}${card(2)}${card(3)}${card(4)}${card(5)}</ol></section>`;
        const clicked = clickIn('.shelf li.product-card');
        const set = expandItemSet(siblingsOf(clicked.closest('li')!), clicked);
        expect(set.groups.map(g => [g.kind, g.items.length])).toEqual([['sponsored', 3], ['results', 5]]);
        expect(set.siblings).toHaveLength(5);
        expect(set.chosen).toBe(1);
        expect(set.clicked).toBe(0);
    });

    it('an ad cell inside the results grid does not make the grid sponsored', () => {
        document.body.innerHTML = `<ul class="results"><li class="ad"><a href="/ad"><img src="/ad.png"></a><small>Sponsored</small></li>${card(1)}${card(2)}${card(3)}</ul>`;
        const clicked = clickIn('li.product-card');
        expect(expandItemSet(siblingsOf(clicked.closest('li')!), clicked).groups[0].kind).toBe('results');
    });

    it('finds the named tile inside bare layout cells', () => {
        const tile = (n: number) => `<div><div data-item-id="${n}" role="group"><img src="/${n}.jpg"><span>Item ${n}</span><span>$${n}.00</span></div></div>`;
        document.body.innerHTML = `<nav><ul><li class="menu"><a href="/a">A</a></li><li class="menu"><a href="/b">B</a></li></ul></nav>
            <div class="stack">${tile(1)}${tile(2)}${tile(3)}</div>`;
        const clicked = document.querySelectorAll('[data-item-id] span')[2];
        const set = expandItemSet(siblingsOf(clicked.closest('[data-item-id]')!.parentElement!), clicked);
        expect(set.siblings.map(s => s.getAttribute('data-item-id'))).toEqual(['1', '2', '3']);
        expect(set.container!.className).toBe('stack');
    });
});
