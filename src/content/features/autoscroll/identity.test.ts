import { describe, expect, it } from 'vitest';
import { itemKey, ItemKeys } from './identity';

const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('item identity', () => {
    it('an item is known by its links, not by its image URL or node', () => {
        const a = el('<a href="/u/p/C1/?utm=x#top"><img src="/img/c1.png?sig=aaa" alt=""></a>');
        const again = el('<a href="/u/p/C1/"><img src="/img/c1.png?sig=bbb" alt=""></a>');
        expect(itemKey(a)).toBe(itemKey(again));
        expect(itemKey(a)).not.toBe(itemKey(el('<a href="/u/p/C2/"></a>')));
    });

    it('an identity attribute, else text and images; nothing in it yet is a placeholder', () => {
        expect(itemKey(el('<span data-item-id="42">x</span>'))).toBe('i:data-item-id=42');
        expect(itemKey(el('<b>Lamp</b> <img src="/a.png?v=1" alt="lamp">'))).toBe('t:Lamp|/a.png lamp');
        expect(itemKey(el('<div></div>'))).toBe('');
    });

    it('links every item shares tell items apart by their text from then on', () => {
        const keys = new ItemKeys();
        const post = (text: string) => el(`<a href="/alpha/">alpha</a> <span>${text}</span>`);
        // Alone on screen at different times: the second post's text differs, so its link no longer identifies it.
        const [first] = keys.keys([post('Post 1')]);
        const [second] = keys.keys([post('Post 2')]);
        expect(second).not.toBe(first);
        // Two at once with the same links: text keyed.
        const both = new ItemKeys().keys([post('A'), post('B')]);
        expect(both[0]).not.toBe(both[1]);
        // The same item filling in (more text) is the same item.
        const filling = new ItemKeys();
        const [early] = filling.keys([el('<a href="/p/C9/"></a><span>Post</span>')]);
        const [late] = filling.keys([el('<a href="/p/C9/"></a><span>Post 9: at the coast</span>')]);
        expect(late).toBe(early);
    });
});
