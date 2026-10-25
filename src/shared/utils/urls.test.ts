import { describe, expect, it } from 'vitest';
import { urlsFromText } from './urls';

describe('urlsFromText', () => {
    it('reads lines and CSV cells, strips quotes, drops non-http and duplicates', () => {
        const text = 'https://a.test/1\r\n"https://a.test/2",Lamp\nname,url\tftp://x.test\n  https://a.test/1  \nhttps://a.test/3\tother';
        expect(urlsFromText(text)).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/3']);
        expect(urlsFromText('')).toEqual([]);
    });
});
