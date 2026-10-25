import { describe, expect, it } from 'vitest';
import type { PageResult } from '../runner/testPage';
import { readiness } from './ready';

const page = (url: string, fields: [string, boolean, string?][], error?: string): PageResult => ({
    url, clicks: [], ...(error ? { error } : {}),
    fields: fields.map(([name, ok, problem]) => ({ fieldId: name, name, status: 'ok', raw: 'x', value: 'x', cleaned: 'x', filled: ok, ok, ...(problem ? { problem } : {}) })),
});
const run = (results: PageResult[]) => results;

describe('readiness', () => {
    it('is ready after a clean test on 3 pages', () => {
        expect(readiness(run(['a', 'b', 'c'].map(u => page(u, [['title', true]]))))).toEqual({ ready: true, reasons: [] });
    });

    it('says every reason it is not', () => {
        expect(readiness(undefined).reasons).toEqual(['Not tested on sample pages yet.']);
        const r = readiness(run([
            page('a', [['title', true], ['price', false, 'not a money']]),
            page('b', [['title', false, 'required, but empty'], ['price', false, 'not a money']]),
            page('c', [], 'Timed out'),
        ]));
        expect(r.ready).toBe(false);
        expect(r.reasons).toEqual(['1 page could not be read.', 'price: not a money on 2 pages.', 'title: required, but empty on 1 page.']);
        expect(readiness(run([page('a', [['title', true]])])).reasons).toEqual(['Tested on 1 page; it needs 3.']);
    });
});

describe('readiness with a contract', () => {
    it('adds the contract\'s problems on the tested pages', async () => {
        const { contractFromSchema } = await import('./contract');
        const contract = contractFromSchema('{"type":"object","required":["title","brand"],"properties":{"title":{"type":"string"},"brand":{"type":"string"}}}', 'c', 'C');
        const spec = { kind: 'page' as const, steps: [{ kind: 'field' as const, field: { id: 'title', name: 'title', type: 'text' as const, read: 'text', ways: [], ops: [] } }] };
        const results = ['a', 'b', 'c'].map(u => page(u, [['title', true]]));
        expect(readiness(results, { spec, output: { contract } }).reasons).toEqual(['Contract: no field gives the required "brand".']);
        expect(readiness(results, { spec, output: {} }).ready).toBe(true);
    });
});
