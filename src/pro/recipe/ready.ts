/**
 * Ready to submit (`docs/design/LLD.md` §7.4): the version's spec passed a test on at least 3 sample
 * pages, every page was read, and no field had a problem (required and empty, or not of its type).
 * Each reason it is not ready is one line.
 */
import type { PageResult } from '../runner/testPage';

export const MIN_TEST_PAGES = 3;

export interface Readiness {
    ready: boolean;
    reasons: string[];
}

/** `results`: the newest multi-page test of the spec, if there is one. */
export function readiness(results: PageResult[] | undefined): Readiness {
    if (!results) return { ready: false, reasons: ['Not tested on sample pages yet.'] };
    const reasons: string[] = [];
    const pages = results.length;
    if (pages < MIN_TEST_PAGES) reasons.push(`Tested on ${pages} page${pages === 1 ? '' : 's'}; it needs ${MIN_TEST_PAGES}.`);
    const unread = results.filter(r => r.error).length;
    if (unread) reasons.push(`${unread} page${unread === 1 ? '' : 's'} could not be read.`);
    const problems = new Map<string, Map<string, number>>();
    for (const r of results) for (const f of r.fields) {
        if (f.ok) continue;
        const byProblem = problems.get(f.name) ?? new Map<string, number>();
        byProblem.set(f.problem ?? 'problem', (byProblem.get(f.problem ?? 'problem') ?? 0) + 1);
        problems.set(f.name, byProblem);
    }
    for (const [name, byProblem] of problems) {
        for (const [problem, n] of byProblem) reasons.push(`${name}: ${problem} on ${n} page${n === 1 ? '' : 's'}.`);
    }
    return { ready: reasons.length === 0, reasons };
}
