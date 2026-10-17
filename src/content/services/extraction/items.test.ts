import { describe, it, expect, beforeAll } from 'vitest';
import { findList, findListInside, itemOf, keepItems } from './items';

// jsdom has no layout: give every element a box so the rendered-box checks pass.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 100; } });
});

const card = (i: number) => `
    <div class="card">
        <a class="title" href="/p/${i}"><span class="name">Product ${i}</span></a>
        <span class="price">$${i}.99</span>
        <span class="rating">4.${i} out of 5 stars</span>
    </div>`;

function page(html: string) {
    document.body.innerHTML = html;
}

describe('findList / itemOf', () => {
    it('finds the grid around a deep element and the card it belongs to', () => {
        page(`<main><div class="results">
            ${[1, 2, 3, 4, 5, 6].map(card).join('')}
        </div><footer>About</footer></main>`);
        const name = document.querySelectorAll('.name')[2] as HTMLElement;
        const list = findList(name);
        expect(list.container?.className).toBe('results');
        expect(list.siblings).toHaveLength(6);
        expect(itemOf(name, list.container!)).toBe(document.querySelectorAll('.card')[2]);
    });

    it('returns no list for an element outside any repetition', () => {
        page(`<main><h1 id="t">Title</h1><p>Intro</p></main>`);
        expect(findList(document.getElementById('t')!).isContainer).toBe(false);
    });
});

describe('keepItems', () => {
    it('drops headers, widgets and spacers between the cards', () => {
        page(`<div class="results">
            <div class="header"><h2>Results</h2></div>
            ${[1, 2, 3].map(card).join('')}
            <div class="spacer"></div>
            ${[4, 5, 6].map(card).join('')}
            <div class="widget"><h3>Related searches</h3><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a></div>
        </div>`);
        const children = Array.from(document.querySelector('.results')!.children) as HTMLElement[];
        const items = keepItems(children);
        expect(items.map(e => e.className)).toEqual(Array(6).fill('card'));
    });

    it('keeps everything when too few look alike', () => {
        page(`<div><p>a</p><span>b</span><em>c</em></div>`);
        const children = Array.from(document.querySelector('div')!.children) as HTMLElement[];
        expect(keepItems(children)).toHaveLength(3);
    });
});

describe('findListInside', () => {
    it('finds a table of records inside a clicked section', () => {
        page(`<section id="s"><h2>Specs</h2><table><tbody>
            <tr><th>Weight</th><td>2 kg</td></tr>
            <tr><th>Size</th><td>15 in</td></tr>
            <tr><th>Color</th><td>Black</td></tr>
        </tbody></table></section>`);
        const list = findListInside(document.getElementById('s')!);
        expect(list.container?.tagName).toBe('TBODY');
        expect(list.containerType).toBe('table');
        expect(list.childCount).toBe(3);
    });

    it('leaves a list of single images to the array classifier', () => {
        page(`<ul id="g"><li><img src="a.jpg"></li><li><img src="b.jpg"></li><li><img src="c.jpg"></li></ul>`);
        expect(findListInside(document.getElementById('g')!).isContainer).toBe(false);
    });
});
