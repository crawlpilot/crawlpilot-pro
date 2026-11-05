/**
 * Ready to submit (`docs/design/LLD.md` §7.4): the version's spec passed a test on at least 3 sample
 * pages, every page was read, no field had a problem (required and empty, or not of its type), and the
 * output contract, if there is one, is met on those pages.
 * Each reason it is not ready is one line.
 */
import { expectations, pageOutcome } from '../runner/outcome';
import type { PageResult } from '../runner/testPage';
import { checkAgainstContract, contractReasons } from './contract';
import type { OutputSpec, ProSpec } from './types';

export const MIN_TEST_PAGES = 3;

export interface Readiness {
    ready: boolean;
    reasons: string[];
}

/**
 * `results`: the newest multi-page test of the spec, if there is one. `samples`: what each sample expects; one kept
 * to hit a page rule passes when that rule holds, and is not one of the pages read (it needs 3 others).
 */
export function readiness(results: PageResult[] | undefined, version?: { spec: ProSpec; output: OutputSpec }, samples?: { url: string; expectRule?: string }[]): Readiness {
    if (!results) return { ready: false, reasons: ['Not tested on sample pages yet.'] };
    const reasons: string[] = [];
    const expect = expectations(samples);
    const ruleNames = new Set(version?.spec.kind === 'page' ? (version.spec.rules ?? []).map(r => r.name) : []);
    for (const name of new Set(expect.values())) {
        if (version && !ruleNames.has(name)) reasons.push(`A sample should hit page rule "${name}", which the recipe no longer has.`);
    }
    const ruleSamples = results.filter(r => expect.has(r.url));
    for (const r of ruleSamples) {
        const o = pageOutcome(r, expect.get(r.url));
        if (!o.ok && ruleNames.has(expect.get(r.url)!)) reasons.push(`${shortUrl(r.url)}: ${o.title}.`);
    }
    results = results.filter(r => !expect.has(r.url));
    const pages = results.length;
    if (pages < MIN_TEST_PAGES) reasons.push(`Tested on ${pages} page${pages === 1 ? '' : 's'}; it needs ${MIN_TEST_PAGES}.`);
    const unread = results.filter(r => r.error).length;
    if (unread) reasons.push(`${unread} page${unread === 1 ? '' : 's'} could not be read.`);
    const ruled = new Map<string, number>();
    for (const r of results) if (r.rule) ruled.set(r.rule.name, (ruled.get(r.rule.name) ?? 0) + 1);
    for (const [name, n] of ruled) reasons.push(`Page rule "${name}" held on ${n} page${n === 1 ? '' : 's'}: not a page to read. If ${n === 1 ? 'it is' : 'they are'} kept to test the rule, mark ${n === 1 ? 'it' : 'them'} so.`);
    const mismatched = results.filter(r => r.mismatch).length;
    if (mismatched) reasons.push(`${mismatched} page${mismatched === 1 ? ' is' : 's are'} another product than ${mismatched === 1 ? 'its' : 'their'} URL names.`);
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
    if (version?.output.contract && version.spec.kind === 'page') {
        const fields = version.spec.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
        reasons.push(...contractReasons(checkAgainstContract(version.output.contract, fields, results, version.output.mapping, version.spec.transform)));
    }
    return { ready: reasons.length === 0, reasons };
}

const shortUrl = (url: string) => { try { const u = new URL(url); return u.host + u.pathname; } catch { return url; } };
