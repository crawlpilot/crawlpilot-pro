/**
 * The selector corpus: what picks on six real and synthetic pages would store, pinned in
 * `report.json`. A change to selector generation shows up as a diff of that file; each phase of
 * `docs/plans/selector-reliability-plan.md` must move the summary forward, never back.
 * Update after an intended change with `npx vitest run src/test/corpus -u`.
 */
import { describe, expect, it } from 'vitest';
import { CORPUS } from './targets';
import { measurePage, summarize } from './measure';

describe('selector corpus', () => {
    it('matches the pinned report', async () => {
        const pages: Record<string, ReturnType<typeof measurePage>> = {};
        for (const [name, targets] of Object.entries(CORPUS)) pages[name] = measurePage(targets);
        await expect(JSON.stringify({ summary: summarize(pages), pages }, null, 2) + '\n').toMatchFileSnapshot('./report.json');
    }, 120_000);
});
