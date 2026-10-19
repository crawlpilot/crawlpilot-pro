import { describe, it, expect } from 'vitest';
import { csvText } from './csv';

describe('csvText', () => {
    it('quotes what needs quoting and keeps lists as JSON', () => {
        const cols = [{ id: 'a', name: 'Name' }, { id: 'b', name: 'Price, USD' }, { id: 'c', name: 'Images' }];
        const csv = csvText(cols, [{ a: 'Lamp "Pro"', b: '24.99', c: ['/a.jpg', '/b.jpg'] }, { a: 'Desk' }]);
        expect(csv).toBe('Name,"Price, USD",Images\n"Lamp ""Pro""",24.99,"[""/a.jpg"",""/b.jpg""]"\nDesk,,');
    });
});
