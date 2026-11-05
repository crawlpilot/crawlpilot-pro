/**
 * What a page's result says, in one place (`docs/plans/pro-rules-assertions-plan.md`, R1–R2): read (its fields
 * checked), a page rule that held (the page is a 404, out of stock, a captcha: nothing was read), another product
 * than its URL names, or a page that could not be read. A sample can expect a rule (`Sample.expectRule`): an error
 * page kept to test the rules passes when that rule holds, and fails when it doesn't.
 */
import type { RuleStatus } from '../../shared/types/ways';
import type { PageResult } from './readPage';

export const RULE_STATUS_LABELS: Record<RuleStatus, string> = { not_found: 'Not found', unavailable: 'Unavailable', blocked: 'Blocked', error: 'Error page' };

export type OutcomeKind = 'read' | 'rule' | 'mismatch' | 'error' | 'missed-rule';

export interface PageOutcome {
    kind: OutcomeKind;
    /** As it should be: read with every field ok, or the rule the sample expects. */
    ok: boolean;
    title: string;
    detail?: string;
}

/** `expectRule`: the rule the page should hit, when it is a sample kept for that. */
export function pageOutcome(r: PageResult, expectRule?: string): PageOutcome {
    if (r.error) return { kind: 'error', ok: false, title: 'Could not be read', detail: r.error };
    if (r.rule) {
        const title = `Page rule "${r.rule.name}" held: ${RULE_STATUS_LABELS[r.rule.status]}`;
        if (expectRule === r.rule.name) return { kind: 'rule', ok: true, title, detail: 'As this sample expects. No field was read.' };
        return {
            kind: 'rule', ok: false, title,
            detail: expectRule ? `This sample should hit "${expectRule}". No field was read.` : 'No field was read: the recipe says this is not a page to read.',
        };
    }
    if (expectRule) {
        return { kind: 'missed-rule', ok: false, title: `Page rule "${expectRule}" did not hold`, detail: 'This sample is kept to hit that rule, but the page was read as a page.' };
    }
    if (r.mismatch) {
        return { kind: 'mismatch', ok: false, title: 'Another product', detail: `The URL names ${r.mismatch.expected}; the page has ${r.mismatch.found}.` };
    }
    const bad = r.fields.filter(f => !f.ok).length;
    const found = r.fields.filter(f => f.filled).length;
    return {
        kind: 'read', ok: bad === 0, title: `${found} of ${r.fields.length} fields found`,
        ...(bad ? { detail: `${bad} with a problem.` } : {}),
    };
}

/** Each result's expected rule, from the samples by URL. */
export const expectations = (samples: { url: string; expectRule?: string }[] = []) =>
    new Map(samples.flatMap(s => s.expectRule ? [[s.url, s.expectRule] as const] : []));
