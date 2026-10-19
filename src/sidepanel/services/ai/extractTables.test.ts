import { describe, expect, it } from 'vitest';
import { parseSchemaInput } from '../../../shared/ai/schemaIntake';
import { outcomeDocument, outcomeTables } from './extractTables';
import type { ExtractOutcome, ExtractedValue } from './extractRun';

const v = (text: string, value: unknown = text, status: ExtractedValue['status'] = 'verified', source = 'b1'): ExtractedValue => ({ value, text, status, tier: 't2', source });

describe('an AI Extract outcome in the schema\'s shape', () => {
    const intake = parseSchemaInput(JSON.stringify({
        type: 'object',
        required: ['title', 'brand'],
        properties: {
            title: { type: 'string' },
            brand: { type: 'string' },
            stock: { enum: ['in_stock', 'out_of_stock'] },
            colors: { type: 'array', items: { type: 'string' } },
            size: { type: 'object', properties: { width: { type: 'number' } } },
            reviews: { type: 'array', items: { type: 'object', properties: { by: { type: 'string' }, stars: { type: 'number' } } } },
        },
    }));
    const outcome: ExtractOutcome = {
        url: 'https://shop.example/lamp',
        title: 'Lamp',
        single: {
            title: v('Desk Lamp', 'Desk Lamp', 'structured', 'Product.name'),
            brand: { value: null, text: '', status: 'empty', tier: 't2' },
            stock: v('In_stock'),
            colors: v('Black | White'),
            size__width: v('30 cm', 30, 'verified', 'b9'),
        },
        lists: { reviews: [{ by: v('Ann', 'Ann', 'verified', 'b20'), stars: v('4', 4, 'relocated', 'b21') }] },
        warnings: ['1 value the model gave is not on the page: shown as unverified.'],
        modelUsed: true,
    };

    it('JSON with sources by pointer, problems against the schema, and warnings', () => {
        const doc = outcomeDocument(outcome, intake);
        expect(doc.data).toEqual({ title: 'Desk Lamp', brand: null, stock: 'in_stock', colors: ['Black', 'White'], size: { width: 30 }, reviews: [{ by: 'Ann', stars: 4 }] });
        expect(doc.sources).toEqual({
            '/title': { status: 'structured', tier: 't2', source: 'Product.name' },
            '/stock': { status: 'verified', tier: 't2', source: 'b1' },
            '/colors': { status: 'verified', tier: 't2', source: 'b1' },
            '/size/width': { status: 'verified', tier: 't2', source: 'b9' },
            '/reviews/0/by': { status: 'verified', tier: 't2', source: 'b20' },
            '/reviews/0/stars': { status: 'relocated', tier: 't2', source: 'b21' },
        });
        expect(doc.problems).toEqual([{ pointer: '/brand', problem: 'required, not found' }]);
        expect(doc.warnings).toHaveLength(1);
    });

    it('tables name nested columns as people read them', () => {
        const [table] = outcomeTables(outcome, intake);
        expect(table.result.columns.map(c => c.name)).toContain('size.width');
    });
});
