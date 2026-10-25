import { describe, expect, it } from 'vitest';
import zara from '../../shared/samples/recipes/zara-product.json';
import type { PageSpec } from '../../shared/types/database';
import { fromPageSpec } from '../recipe/fromPublic';
import type { Field } from '../recipe/types';
import { checkField } from './check';
import { pageTestRequest, readPageResult, summarize } from './testPage';

const field = (over: Partial<Field>): Field => ({ id: 'f', name: 'f', type: 'text', read: 'text', ways: [], ops: [], ...over });

describe('checkField', () => {
    it('cleans, then types the value', () => {
        expect(checkField(field({ type: 'money' }), '₹ 2,990.00')).toMatchObject({ value: 2990, currency: 'INR', ok: true, filled: true });
        expect(checkField(field({ type: 'integer', ops: [{ op: 'regex', pattern: '(\\d+) reviews' }] }), '4.5 stars · 128 reviews')).toMatchObject({ value: 128, ok: true });
        expect(checkField(field({ type: 'url' }), '/p/1', 'https://shop.test/a')).toMatchObject({ value: 'https://shop.test/p/1', ok: true });
        expect(checkField(field({ type: 'number' }), 'call us')).toMatchObject({ ok: false, problem: 'not a number', filled: true });
    });

    it('reads lists and objects, and checks their shape', () => {
        expect(checkField(field({ type: 'list' }), '["a","b"]')).toMatchObject({ value: ['a', 'b'], ok: true });
        expect(checkField(field({ type: 'list', ops: [{ op: 'splitList', sep: ',' }] }), 'a, b')).toMatchObject({ value: ['a', 'b'], ok: true });
        expect(checkField(field({ type: 'object', ops: [{ op: 'toObject', sep: ':' }] }), 'Fit: Slim')).toMatchObject({ value: { Fit: 'Slim' }, ok: true });
        expect(checkField(field({ type: 'list' }), 'just text')).toMatchObject({ ok: false, problem: 'not a list' });
    });

    it('an empty field is fine unless required', () => {
        expect(checkField(field({}), '')).toEqual({ value: null, cleaned: null, filled: false, ok: true });
        expect(checkField(field({ required: true }), null)).toMatchObject({ filled: false, ok: false, problem: 'required, but empty' });
        expect(checkField(field({ required: true, type: 'list' }), '[]')).toMatchObject({ ok: false });
    });
});

describe('page test', () => {
    const spec = fromPageSpec(zara.spec as unknown as PageSpec).spec;

    it('asks for nested lists, so every field is under its own id', () => {
        const req = pageTestRequest(spec, { listOutput: 'rows', requestDelay: 1 }, 'https://zara.test/p');
        expect(req.config.listOutput).toBe('nested');
        expect(req.elements).toHaveLength(spec.steps.length);
    });

    it('reads each field from the reply with how it was found', () => {
        const fields = spec.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
        const title = fields.find(f => f.name === 'title')!, images = fields.find(f => f.name === 'images')!;
        const click = spec.steps.find(s => s.kind === 'click')!;
        const clickId = click.kind === 'click' ? click.click.id : '';
        const result = readPageResult(spec, 'https://zara.test/p', { [title.id]: 'Straight jeans', [images.id]: '["a.jpg","b.jpg"]' },
            [{ id: title.id, name: 'title', action: 'extract', status: 'data' }, { id: clickId, name: 'button', action: 'click', status: 'clicked' }]);

        expect(result.fields.find(f => f.name === 'title')).toMatchObject({ status: 'data', value: 'Straight jeans', ok: true });
        expect(result.fields.find(f => f.name === 'images')).toMatchObject({ value: ['a.jpg', 'b.jpg'], ok: true });
        expect(result.fields.find(f => f.name === 'origin')).toMatchObject({ status: 'not-found', filled: false });
        expect(result.clicks).toEqual([{ name: 'button', status: 'clicked' }]);
        expect(summarize(result)).toEqual({ filled: 2, ok: fields.length, total: fields.length });
    });
});
