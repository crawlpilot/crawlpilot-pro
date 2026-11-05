import { describe, expect, it } from 'vitest';
import { shownValue, sourceOf, verdictOf } from './present';
import type { FieldResult } from './readPage';

const result = (extra: Partial<FieldResult>): FieldResult => ({ fieldId: 'f', name: 'f', status: 'ok', raw: null, value: null, cleaned: null, filled: true, ok: true, ...extra });

describe('a field as Check shows it', () => {
    it('shows money with its currency, and says when there is none', () => {
        const price = result({ value: 79, cleaned: '£79.00', currency: 'GBP' });
        expect(shownValue(price, 'money')).toBe('79.00 GBP');
        expect(verdictOf(price, 'money')).toEqual({ tone: 'ok', text: 'money, GBP' });
        expect(verdictOf(result({ value: 79, cleaned: '79', currency: null }), 'money').text).toBe('money, no currency');
    });

    it('shows what was read when it doesn\'t check out, with the reason', () => {
        const date = result({ value: 'next week', cleaned: 'next week', ok: false, problem: 'not a date' });
        expect(shownValue(date, 'date')).toBe('next week');
        expect(verdictOf(date, 'date')).toEqual({ tone: 'bad', text: 'not a date' });
        expect(verdictOf(result({ filled: false, ok: false, problem: 'required, but empty' }), 'text')).toEqual({ tone: 'bad', text: 'required, but empty' });
    });

    it('shows an empty field as empty, lists by their items, and the source in words', () => {
        expect(shownValue(result({ filled: false }), 'text')).toBe('—');
        expect(verdictOf(result({ filled: false }), 'text')).toEqual({ tone: 'empty', text: 'empty' });
        expect(shownValue(result({ value: ['S', 'M', 'L', 'XL'] }), 'list')).toBe('4 items: S, M, L, …');
        expect(shownValue(result({ value: true }), 'boolean')).toBe('yes');
        expect([sourceOf('data'), sourceOf('ok'), sourceOf('healed'), sourceOf('not-found')]).toEqual(['page data', 'selector', 'selector, healed', 'not found']);
    });
});
