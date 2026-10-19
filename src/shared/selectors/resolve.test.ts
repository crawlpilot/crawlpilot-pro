import { describe, it, expect, beforeEach } from 'vitest';
import { resolveOne, resolveItems, resolveContainer, normalizeChain, looksLikeXPath } from './resolve';

describe('looksLikeXPath', () => {
    it('detects xpath-shaped strings', () => {
        expect(looksLikeXPath('//div[@id="x"]')).toBe(true);
        expect(looksLikeXPath('./div')).toBe(true);
        expect(looksLikeXPath('(//div)[1]')).toBe(true);
    });
    it('rejects css selectors', () => {
        expect(looksLikeXPath('.card')).toBe(false);
        expect(looksLikeXPath('div.item')).toBe(false);
    });
});

describe('normalizeChain', () => {
    it('normalizes strings, SelectorMetadata, and SelectorDefinition shapes', () => {
        const chain = normalizeChain([
            '.foo',
            { selector: '.bar', strategy: 'Minimal' },
            { value: '//div', type: 'xpath' },
            { value: '.baz', type: 'css' },
            null,
            undefined,
            { selector: '' },
        ]);
        expect(chain).toEqual([
            { value: '.foo', kind: 'css' },
            { value: '.bar', kind: 'css', strategy: 'Minimal' },
            { value: '//div', kind: 'xpath' },
            { value: '.baz', kind: 'css' },
        ]);
    });
});

describe('resolveOne / resolveItems / resolveContainer', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="root">
                <div class="card">A</div>
                <div class="card">B</div>
                <div class="card">C</div>
                <div class="stale-hash-xyz1">D</div>
            </div>
            <section class="results"><p>stale</p></section>
            <section class="list"><article>1</article><article>2</article></section>
        `;
    });

    it('resolveOne takes the first entry that names one element, and says which', () => {
        expect(resolveOne(['.nope', '.card', '.stale-hash-xyz1'])).toMatchObject({ used: 2 });
        expect(resolveOne(['.nope', '.stale-hash-xyz1']).result?.textContent).toBe('D');
        expect(resolveOne(['//div[@class="stale-hash-xyz1"]']).result?.textContent).toBe('D');
    });

    it('resolveOne settles for an entry matching several only when none names one', () => {
        const { result, used } = resolveOne(['.nope', '.card']);
        expect(result?.textContent).toBe('A');
        expect(used).toBe(1);
        expect(resolveOne(['.nope', '.still-nope'])).toEqual({ result: null, used: -1 });
    });

    it('resolveItems returns the first entry with matches under the container', () => {
        const root = document.getElementById('root')!;
        expect(resolveItems(['.nope', '.card'], root)).toMatchObject({ used: 1 });
        expect(resolveItems(['.nope', '.card'], root).result).toHaveLength(3);
        expect(resolveItems([], root)).toEqual({ result: [], used: -1 });
    });

    it('resolveContainer passes over an entry whose element no longer holds the items', () => {
        const { result, used } = resolveContainer(['section.results', 'section.list'], [':scope > article']);
        expect(result?.className).toBe('list');
        expect(used).toBe(1);
        expect(resolveContainer(['section.results'], []).result?.className).toBe('results');
    });
});
