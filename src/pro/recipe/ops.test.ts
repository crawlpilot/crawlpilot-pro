import { describe, expect, it } from 'vitest';
import { applyProOps, opSummary } from './ops';

describe('applyProOps', () => {
    it('runs the public text ops in order', () => {
        expect(applyProOps('  Price: $1,299.00 ', [{ op: 'trim' }, { op: 'regex', pattern: '\\$([\\d,.]+)' }])).toBe('1,299.00');
    });

    it('splits text into a list, and later text ops run on each item', () => {
        const v = applyProOps('Cotton 98%\n Elastane 2% \n\n', [{ op: 'splitList', sep: '\\n' }, { op: 'upper' }]);
        expect(v).toEqual(['COTTON 98%', 'ELASTANE 2%']);
        expect(applyProOps('a, b ,c', [{ op: 'splitList', sep: ',' }])).toEqual(['a', 'b', 'c']);
    });

    it('turns "Name: value" lines or list items into an object', () => {
        expect(applyProOps('Fit: Relaxed\nLength: Regular\nno colon here', [{ op: 'toObject', sep: ':' }])).toEqual({ Fit: 'Relaxed', Length: 'Regular' });
        expect(applyProOps(['Origin - Portugal', 'Care - 30°'], [{ op: 'toObject', sep: '-' }])).toEqual({ Origin: 'Portugal', Care: '30°' });
        expect(applyProOps('Made in: Turkey: Izmir', [{ op: 'toObject', sep: ':' }])).toEqual({ 'Made in': 'Turkey: Izmir' });
    });

    it('leaves values it cannot clean as they are', () => {
        expect(applyProOps(null, [{ op: 'trim' }])).toBeNull();
        expect(applyProOps({ a: 1 }, [{ op: 'upper' }])).toEqual({ a: 1 });
    });

    it('describes each step in a few words', () => {
        expect(opSummary({ op: 'split', sep: '/', index: 1 })).toBe('Split & pick "/" #1');
        expect(opSummary({ op: 'splitList', sep: '\\n' })).toBe('Text to list (\\n)');
    });
});
