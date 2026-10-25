import { describe, expect, it } from 'vitest';
import { READY_MADE } from './readyMade';
import { bulkConfig, pageRunInput, pageSpec, specHash } from './spec';

describe('ready-made recipes', () => {
    it('are page specs with named fields and pages to start from', () => {
        expect(READY_MADE.map(r => r.site)).toEqual(['zara.com', 'uniqlo.com']);
        for (const r of READY_MADE) {
            expect(r.spec.kind).toBe('page');
            expect(r.spec.elements.every(e => e.name)).toBe(true);
            expect(r.pages.length).toBeGreaterThan(0);
        }
    });

    it('a run of one is the same recipe (same spec hash), not a copy', () => {
        for (const r of READY_MADE) {
            const { elements, settings } = pageRunInput(r.spec);
            expect(specHash(pageSpec(elements, bulkConfig(settings)))).toBe(specHash(r.spec));
        }
    });
});
