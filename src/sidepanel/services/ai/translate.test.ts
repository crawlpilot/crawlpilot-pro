import { describe, it, expect } from 'vitest';
import { translateChunk, translateCited } from './translate';
import { viewBlockTexts } from './assistant';

const upper = { translate: async (t: string) => t.toUpperCase() };

describe('translating the page and answers', () => {
    it('translates a chunk line by line, keeping each block reference and list markup', async () => {
        const chunk = '# Der Titel [b1]\n- Höchstgeschwindigkeit 3 km/h [b2]\n| 42 | [b3]\n\nNur Text';
        const out = await translateChunk(upper, chunk);
        expect(out).toBe('# DER TITEL [b1]\n- HÖCHSTGESCHWINDIGKEIT 3 KM/H [b2]\n| 42 | [b3]\n\nNUR TEXT');
        expect([...viewBlockTexts([out])]).toEqual([['b1', 'DER TITEL'], ['b2', 'HÖCHSTGESCHWINDIGKEIT 3 KM/H'], ['b3', '42 |']]);
    });

    it('translates an answer around its citation markers', async () => {
        expect(await translateCited(upper, 'It goes 3 mph [b2]. It is red [b4, b5].')).toBe('IT GOES 3 MPH [b2]. IT IS RED [b4, b5].');
    });
});
