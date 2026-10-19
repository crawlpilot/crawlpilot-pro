import { describe, it, expect } from 'vitest';
import { typedValue } from './parse';

describe('typedValue: price', () => {
    it.each([
        ['Now $629.00', '$629.00'],
        ['Typical: $47.99', '$47.99'],
        ['$199.00 – $299.00', '$199.00'],
        // A price per unit keeps its unit, however the site writes it.
        ['($2.86/oz)', '$2.86/oz'],
        ['$0.07/ea', '$0.07/ea'],
        ['£1.20 per kg', '£1.20/kg'],
        ['$3.49 / 100 g', '$3.49/100 g'],
        ['$0.42/fl oz', '$0.42/fl oz'],
        ['20,00 € / Stück', '20,00 €/Stück'],
    ])('%s → %s', (v, out) => expect(typedValue(v, 'price')).toBe(out));
});
