import { describe, expect, it } from 'vitest';
import type { Condition } from '../../shared/types/ways';
import { conditionProblems, countOf, describe as sentence, emptyGroups, escapeRegex, fromGroup, groupOf, literalOf, newLeaf, withCount, withTarget, type Leaf } from './conditions';

const text = (t: string): Leaf => ({ kind: 'regex', in: 'text', pattern: escapeRegex(t), flags: 'i', op: 'gt', value: 0 });
const css = (selector: string): Leaf => ({ kind: 'css', selector, op: 'gt', value: 0 });

describe('conditions as people build them', () => {
    it('keeps plain text as an escaped regex and reads it back as text', () => {
        expect(literalOf(escapeRegex('Price: $9.99 (each)'))).toBe('Price: $9.99 (each)');
        expect(literalOf('Sold\\s+out')).toBeNull();
    });

    it('turns counts into comparisons and back', () => {
        const leaf = text('x');
        expect(countOf(leaf)).toEqual({ choice: 'found', n: 0 });
        expect(withCount(leaf, 'absent', 0)).toMatchObject({ op: 'eq', value: 0 });
        expect(countOf(withCount(leaf, 'atLeast', 3))).toEqual({ choice: 'atLeast', n: 3 });
        expect(withCount(leaf, 'fewerThan', 2.7)).toMatchObject({ op: 'lt', value: 2 });
        expect(countOf({ ...leaf, op: 'lt', value: 1 })).toEqual({ choice: 'absent', n: 0 });
    });

    it('moves a test to another target, keeping what it can', () => {
        expect(withTarget(text('Sorry'), 'url')).toMatchObject({ kind: 'regex', in: 'url', pattern: 'Sorry' });
        expect(withTarget(text('Sorry'), 'css')).toEqual({ kind: 'css', selector: '', op: 'gt', value: 0 });
        expect(newLeaf()).toMatchObject({ kind: 'regex', in: 'text', pattern: '' });
    });

    it('groups: all, any and none (NOR), and a lone test is a group of one', () => {
        const a = text('Not found'), b = css('#captcha');
        expect(fromGroup('all', [a])).toBe(a);
        expect(fromGroup('any', [a, b])).toEqual({ kind: 'any', of: [a, b] });
        expect(fromGroup('none', [a, b])).toEqual({ kind: 'not', of: { kind: 'any', of: [a, b] } });
        expect(fromGroup('none', [a])).toEqual({ kind: 'not', of: a });
        expect(groupOf(fromGroup('none', [a, b]))).toEqual({ mode: 'none', items: [a, b] });
        expect(groupOf(a)).toEqual({ mode: 'all', items: [a] });
    });

    it('reads as a sentence', () => {
        expect(sentence(text('Not found'))).toBe('the visible text has "Not found"');
        expect(sentence(withCount(css('.item'), 'absent', 0))).toBe('".item" is not on the page');
        expect(sentence(withCount(css('.item'), 'atLeast', 2))).toBe('at least 2 ".item"');
        expect(sentence({ kind: 'regex', in: 'url', pattern: '/search', op: 'gt', value: 0 })).toBe('the URL has "/search"');
        expect(sentence({ kind: 'regex', pattern: 'a.+b', op: 'eq', value: 0 })).toBe('the HTML source does not have /a.+b/');
        const nested: Condition = { kind: 'any', of: [{ kind: 'all', of: [text('A'), text('B')] }, css('#c')] };
        expect(sentence(nested)).toBe('any of: (all of: the visible text has "A"; the visible text has "B"); "#c" is on the page');
        expect(sentence(fromGroup('none', [text('A'), css('#c')]))).toBe('none of: the visible text has "A"; "#c" is on the page');
    });

    it('says what a condition lacks, and warns of empty groups without refusing them', () => {
        expect(conditionProblems({ kind: 'all', of: [newLeaf(), css(' '), { kind: 'regex', pattern: 'a(', op: 'gt', value: 0 }] }, 'Rule "x"')).toEqual([
            'Rule "x": a condition has nothing to look for.', 'Rule "x": a condition has no selector.', 'Rule "x": /a(/ is not a valid regex.',
        ]);
        expect(conditionProblems({ kind: 'any', of: [] }, 'r')).toEqual([]);
        expect(emptyGroups({ kind: 'any', of: [] })).toEqual(['never']);
        expect(emptyGroups(fromGroup('none', []))).toEqual(['always']);
    });
});
