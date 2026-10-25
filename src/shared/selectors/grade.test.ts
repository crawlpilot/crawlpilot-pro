import { describe, it, expect } from 'vitest';
import { gradeSelector } from './grade';
import { toSnippet } from './snippets';

describe('gradeSelector', () => {
    it.each([
        ['[data-testid="price"]', 1, 'strong', 'test id'],
        ['#productTitle', 1, 'strong', 'id'],
        ['[aria-label="Add to cart"]', 1, 'strong', 'label'],
        ['.product-card .price', 12, 'strong', 'class'],
        ["//th[normalize-space()='Weight']/following-sibling::td[1]", 1, 'strong', 'text'],
    ] as const)('%s is %s (%s)', (sel, n, grade, family) => {
        const g = gradeSelector(sel, n);
        expect(g.grade).toBe(grade);
        expect(g.family).toBe(family);
    });

    it.each([
        ['div:nth-child(3) > span', 'position'],
        ['/html/body/div[2]/div[1]/span[3]', 'absolute'],
        ['.css-dy3i81', 'build-generated'],
        ['.flex.items-center', 'styling classes'],
        ['#ember1234', 'generated'],
        ['div > div > div > span', 'structure'],
    ])('%s is fragile (%s)', (sel, why) => {
        const g = gradeSelector(sel, 1);
        expect(g.grade).toBe('fragile');
        expect(g.reason).toContain(why);
    });

    it('zero matches is broken', () => {
        expect(gradeSelector('.price', 0).grade).toBe('broken');
    });

    it('a field selector matching many elements is fragile', () => {
        const g = gradeSelector('.price', 5, 1);
        expect(g.grade).toBe('fragile');
        expect(g.reason).toMatch(/matches 5 elements/);
    });
});

describe('toSnippet', () => {
    it('writes CSS and XPath for each library', () => {
        expect(toSnippet('playwright', '.price')).toBe("const text = await page.locator('.price').first().innerText();");
        expect(toSnippet('playwright', '//h1', true)).toContain("'xpath=//h1'");
        expect(toSnippet('scrapy', '.title', true)).toContain("response.css('.title ::text')");
        expect(toSnippet('selenium', "//a[@id='x']")).toContain('By.XPATH, "//a[@id=\'x\']"');
        expect(toSnippet('puppeteer', '//h1')).toContain("'xpath///h1'");
        expect(toSnippet('beautifulsoup', '//h1')).toContain('lxml');
    });
});
