import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractPage } from './extractPage';
import { PageProbe, readWays, selectAll, textOf } from './ways';

beforeAll(() => { Element.prototype.scrollIntoView = () => undefined; });

const page = () => {
    document.body.innerHTML = `
        <div id="buybox">
            <div id="regularBuybox"><span class="label">Regular Price</span> <span class="price">$12.99</span></div>
            <div class="basis"><span>List Price</span><span class="a-offscreen">$19.99</span></div>
            <script>var x = "not text";</script>
            <p style="display:none">Hidden<br>line</p>
        </div>
        <table><tr><th>Best Sellers Rank</th><td>#4 in Lamps</td></tr><tr><th>Weight</th><td>2 lb</td></tr></table>
        <ul id="crumbs"><li><a href="/c/home">Home</a></li><li><a href="/c/lamps">Lamps</a></li></ul>
        <ul id="bullets"><li><span class="k">Color</span><span class="v">Blue</span></li><li><span class="k">Size</span><span class="v">L</span></li></ul>`;
};

describe('textOf', () => {
    beforeEach(page);

    it('reads every text node, hidden ones too, without scripts, a space at block edges', () => {
        expect(textOf(document.getElementById('buybox')!)).toBe('Regular Price $12.99 List Price$19.99 Hidden line');
    });
});

describe('selectAll', () => {
    beforeEach(page);

    it('supports Jsoup :contains, case-insensitive, at the end, in the middle and before a combinator', () => {
        expect(selectAll('span:contains(regular price)').map(e => e.className)).toEqual(['label']);
        expect(selectAll('#regularBuybox:contains(Regular Price) span.price').map(textOf)).toEqual(['$12.99']);
        expect(selectAll('th:contains(Best Sellers Rank) ~ td').map(textOf)).toEqual(['#4 in Lamps']);
        expect(selectAll('div:contains("List Price") .a-offscreen').map(textOf)).toEqual(['$19.99']);
        expect(selectAll('th:contains(Nope) ~ td')).toEqual([]);
        // The marks used for a moment are gone.
        expect(document.querySelectorAll('[data-cp-contains-1], [data-cp-contains-2], [data-cp-contains-3]')).toHaveLength(0);
    });

    it('unions comma groups in page order, and reads XPath', () => {
        expect(selectAll('td, th').map(textOf)).toEqual(['Best Sellers Rank', '#4 in Lamps', 'Weight', '2 lb']);
        expect(selectAll('//th').map(textOf)).toEqual(['Best Sellers Rank', 'Weight']);
    });
});

describe('PageProbe', () => {
    beforeEach(page);

    it('counts selector and HTML regex matches, and combines them', () => {
        const probe = new PageProbe();
        expect(probe.holds({ kind: 'css', selector: '#crumbs li', op: 'eq', value: 2 })).toBe(true);
        expect(probe.holds({ kind: 'css', selector: 'span:contains(List Price)', op: 'gt', value: 0 })).toBe(true);
        expect(probe.holds({ kind: 'regex', pattern: 'Regular Price', op: 'gt', value: 0 })).toBe(true);
        expect(probe.holds({ kind: 'regex', pattern: 'regular price', op: 'gt', value: 0 })).toBe(false);
        expect(probe.holds({ kind: 'regex', pattern: 'regular price', flags: 'i', op: 'eq', value: 1 })).toBe(true);
        expect(probe.holds({ kind: 'regex', pattern: '(', op: 'eq', value: 0 })).toBe(false);
        expect(probe.holds({ kind: 'all', of: [] })).toBe(true);
        expect(probe.holds({ kind: 'any', of: [] })).toBe(false);
        expect(probe.holds({ kind: 'not', of: { kind: 'css', selector: '#nope', op: 'gt', value: 0 } })).toBe(true);
    });
});

describe('readWays', () => {
    beforeEach(page);

    it('reads text, an attribute, a count, every match, name/value pairs, and skips a way whose condition fails', () => {
        const hits = readWays([
            { selector: '#crumbs a', read: 'text' },
            { selector: '#crumbs a', read: 'attr', attr: 'href', many: true },
            { selector: '#crumbs a', read: 'attr', attr: 'abs:href' },
            { selector: '#crumbs li', read: 'count' },
            { selector: '#nope', read: 'count' },
            { selector: '#bullets li', read: 'pairs', pairs: { key: '.k', value: '.v' }, many: true },
            { selector: '#crumbs a', read: 'pairs', attr: 'href', many: true },
            { selector: '#crumbs a', when: { kind: 'css', selector: '#nope', op: 'gt', value: 0 } },
        ], new PageProbe());
        expect(hits[0]).toEqual({ values: ['Home'] });
        expect(hits[1]).toEqual({ values: ['/c/home', '/c/lamps'] });
        expect(hits[2].values[0]).toMatch(/^https?:\/\/.+\/c\/home$/);
        expect(hits[3]).toEqual({ values: ['2'] });
        expect(hits[4]).toEqual({ values: [] });
        expect(hits[5]).toEqual({ values: [], pairs: [['Color', 'Blue'], ['Size', 'L']] });
        expect(hits[6]).toEqual({ values: [], pairs: [['Home', '/c/home'], ['Lamps', '/c/lamps']] });
        expect(hits[7]).toEqual({ skipped: true, values: [] });
    });
});

describe('extractPage with ways and page rules', () => {
    beforeEach(page);

    it('leaves a field with ways to its caller, with what each way read', async () => {
        const record = await extractPage([
            { id: 'title', name: 'title', action: 'extract', type: 'text', selectors: ['th'] },
            { id: 'price', name: 'price', action: 'extract', type: 'text', selectors: ['#nope'], ways: [{ selector: '#nope' }, { selector: '.price' }] },
        ], { listOutput: 'nested' });
        expect(record.item.title).toBe('Best Sellers Rank');
        expect(record.item.price).toBeNull();
        const step = record.steps.find(s => s.id === 'price')!;
        expect(step.status).toBe('ok');
        expect(step.hits).toEqual([{ values: [] }, { values: ['$12.99'] }]);
    });

    it('reads nothing when a page rule holds', async () => {
        const record = await extractPage([
            { id: 'title', name: 'title', action: 'extract', type: 'text', selectors: ['th'] },
        ], { listOutput: 'nested', pageRules: [{ name: '404', status: 'not_found', when: { kind: 'regex', pattern: 'Best Sellers', op: 'gt', value: 0 } }] });
        expect(record).toMatchObject({ steps: [], rule: { name: '404', status: 'not_found' } });
    });
});
