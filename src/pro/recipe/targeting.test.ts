import { describe, expect, it } from 'vitest';
import { matchesRules, uncoveredSamples } from './targeting';

describe('match rules', () => {
    const rules = { include: ['https://www.zara.com/*-p*.html*'], exclude: ['*/kids/*'] };

    it('match the whole URL by glob, case aside, and an exclude wins', () => {
        expect(matchesRules('https://www.zara.com/uk/en/shirt-p0123.html?v1=9', rules)).toBe(true);
        expect(matchesRules('HTTPS://WWW.ZARA.COM/uk/en/shirt-p0123.html', rules)).toBe(true);
        expect(matchesRules('https://www.zara.com/uk/en/kids/shirt-p0123.html', rules)).toBe(false);
        expect(matchesRules('https://www.zara.com/uk/en/woman-l1066.html', rules)).toBe(false);
        expect(matchesRules('https://evil.example/?u=https://www.zara.com/x-p1.html', rules)).toBe(false);
    });

    it('treat everything but * literally', () => {
        expect(matchesRules('https://a.com/x?y=1', { include: ['https://a.com/x?y=1'] })).toBe(true);
        expect(matchesRules('https://aXcom/x', { include: ['https://a.com/*'] })).toBe(false);
    });

    it('list the sample pages they leave out', () => {
        const samples = ['https://www.zara.com/uk/en/a-p1.html', 'https://www.zara.com/uk/en/kids/b-p2.html'];
        expect(uncoveredSamples(rules, samples)).toEqual([samples[1]]);
        expect(uncoveredSamples(undefined, samples)).toEqual([]);
    });
});
