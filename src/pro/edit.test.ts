import { describe, expect, it } from 'vitest';
import { competitorOf } from './edit';

describe('a competitor suggested from the site', () => {
    it('is the name before the site\'s ending, country endings included', () => {
        expect(competitorOf('www.zara.com')).toBe('zara');
        expect(competitorOf('shop.example.co.uk')).toBe('example');
        expect(competitorOf('www.target.com.au')).toBe('target');
        expect(competitorOf('Walmart.com:443')).toBe('walmart');
        expect(competitorOf('localhost')).toBe('localhost');
    });

    it('is nothing for an IP address', () => {
        expect(competitorOf('127.0.0.1:8000')).toBe('');
        expect(competitorOf('10.0.0.5')).toBe('');
    });
});
