/**
 * The selector corpus: what picks on six listing pages and four product pages would store, pinned in
 * `report.json`. A change to selector generation shows up as a diff of that file; each phase of
 * `docs/plans/selector-reliability-plan.md` must move the summary forward, never back.
 * Update after an intended change with `npx vitest run src/test/corpus -u`.
 */
import { describe, expect, it } from 'vitest';
import { CORPUS } from './targets';
import { measurePage, measurePdp, summarize, summarizePdp } from './measure';
import type { PdpTarget } from './targets';
import PDP from './pdp-targets.json';

describe('selector corpus', () => {
    it('matches the pinned report', async () => {
        const pages: Record<string, ReturnType<typeof measurePage>> = {};
        for (const [name, targets] of Object.entries(CORPUS)) pages[name] = measurePage(targets);
        const products: Record<string, ReturnType<typeof measurePdp>> = {};
        for (const [name, targets] of Object.entries(PDP as Record<string, PdpTarget[]>)) products[name] = measurePdp(`corpus/pdp-${name}.html.gz`, targets);
        const summary = { lists: summarize(pages), products: summarizePdp(products) };
        await expect(JSON.stringify({ summary, pages, products }, null, 2) + '\n').toMatchFileSnapshot('./report.json');
    }, 120_000);
});
