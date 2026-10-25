import { describe, it, expect } from 'vitest';
import { pickProblems, statedCount } from './pickCheck';

describe('pick check (L6)', () => {
    it('reads what the page says it shows', () => {
        document.body.innerHTML = '<div><span>1-24 of over 7,047 results for "laptop"</span></div>';
        expect(statedCount()).toEqual({ shown: 24, total: 7047 });
        document.body.innerHTML = '<p>Showing 18 of 120</p>';
        expect(statedCount()).toEqual({ shown: 18, total: 120 });
        document.body.innerHTML = '<h2>(36) products</h2>';
        expect(statedCount()).toEqual({ total: 36 });
        document.body.innerHTML = '<p>Free shipping on 35 items or more, details inside this long promotional banner text</p>';
        expect(statedCount()).toBeUndefined();
    });

    it('warns when the list is far smaller than what the page shows, and only then', () => {
        document.body.innerHTML = '<h1>1–18 of 1,204 results</h1>';
        expect(pickProblems(4)[0]).toMatch(/This list has 4 items, but the page says it shows 18 \(of 1,204\)/);
        expect(pickProblems(18)).toEqual([]);
        // A large total alone says nothing about one page.
        document.body.innerHTML = '<h1>7,047 results</h1>';
        expect(pickProblems(4)).toEqual([]);
    });
});
