/**
 * An AI Extract run as a markdown evidence report (docs/plans/ai-extract-v2-plan.md §3.3): for each value,
 * where it goes in the JSON, its status, and the page block it came from, quoted as markdown, with the
 * hidden section it was read from. Values with no evidence are listed at the end with why. Anyone can
 * check every value against the page without CrawlPilot.
 */
import type { IntakeResult, SchemaField } from '../../../shared/ai/schemaIntake';
import { sourcesByPointer } from '../../../shared/ai/assemble';
import { revealSummary } from '../../../shared/types/reveal';
import type { ExtractOutcome, ExtractedValue, ValueStatus } from './extractRun';

const STATUS: Record<ValueStatus, string> = {
    structured: 'from the page\'s structured data',
    verified: 'verified on the page',
    relocated: 'found elsewhere on the page',
    unverified: 'not on the page: the model\'s answer could not be found',
    invalid: 'found, but not the field\'s type',
    empty: 'not found on the page',
    needs_model: 'needs the on-device model',
};

const FOUND: ValueStatus[] = ['structured', 'verified', 'relocated', 'invalid'];

const quote = (text: string) => text.split('\n').map(l => `> ${l}`).join('\n');
const shown = (v: ExtractedValue) => (typeof v.value === 'string' ? v.value : JSON.stringify(v.value));
/** Inline code that survives backticks in the value. */
const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``);

interface Entry { pointer: string; label: string; value: ExtractedValue }

/** Every value of the run by its JSON pointer (`/price`, `/products/3/title`), in schema order. */
function entries(outcome: ExtractOutcome, intake: Pick<IntakeResult, 'fields' | 'lists' | 'plan'>): Entry[] {
    const label = (f: SchemaField) => f.label || f.name;
    const tag = (fields: SchemaField[], values: Record<string, ExtractedValue>) =>
        Object.fromEntries(fields.filter(f => values[f.name]).map(f => [f.name, { label: label(f), value: values[f.name] }]));
    const single = tag(intake.fields, outcome.single);
    const lists = Object.fromEntries(intake.lists.map(l => [l.name, (outcome.lists[l.name] ?? []).map(item => tag(l.fields, item))]));
    if (intake.plan) return Object.entries(sourcesByPointer(intake.plan, single, lists)).map(([pointer, e]) => ({ pointer, ...e }));
    return [
        ...Object.entries(single).map(([k, e]) => ({ pointer: `/${k}`, ...e })),
        ...Object.entries(lists).flatMap(([name, items]) => items.flatMap((item, i) => Object.entries(item).map(([k, e]) => ({ pointer: `/${name}/${i}/${k}`, ...e })))),
    ];
}

function where(v: ExtractedValue, outcome: ExtractOutcome): string {
    if (!v.section) return '';
    const r = outcome.revealed;
    const how = r?.opened.includes(v.section) ? 'opened before reading'
        : r?.tabs.includes(v.section) ? 'tab opened before reading'
            : 'closed on the page, read without opening it';
    return `From the hidden section *${v.section}* (${how}).`;
}

export function evidenceReport(outcome: ExtractOutcome, intake: Pick<IntakeResult, 'fields' | 'lists' | 'plan'>, at = new Date()): string {
    const all = entries(outcome, intake);
    const found = all.filter(e => FOUND.includes(e.value.status));
    const missing = all.filter(e => !FOUND.includes(e.value.status));
    const out: string[] = [
        `# Evidence: ${outcome.title || outcome.url}`,
        '',
        `Page: <${outcome.url}>  `,
        `Extracted: ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${found.length} value${found.length !== 1 ? 's' : ''} found, ${missing.length} not`,
    ];
    const revealed = revealSummary(outcome.revealed);
    if (revealed) out.push('', `Hidden sections read: ${revealed}`);

    for (const e of found) {
        const v = e.value;
        out.push('', `## ${code(e.pointer)} ${e.label}`, '', `**${shown(v)}** · ${STATUS[v.status]}`);
        if (v.evidence) out.push('', quote(v.evidence));
        else if (v.tier === 't0' && v.source) out.push('', `Structured data: ${code(v.source)}`);
        const section = where(v, outcome);
        if (section) out.push('', section);
    }

    if (missing.length) {
        out.push('', '## Not found', '');
        for (const e of missing) {
            const said = e.value.status === 'unverified' && e.value.text ? ` (it said ${code(e.value.text)})` : '';
            out.push(`- ${code(e.pointer)} ${e.label}: ${STATUS[e.value.status]}${said}`);
        }
    }
    if (outcome.warnings.length) {
        out.push('', '## Warnings', '');
        for (const w of outcome.warnings) out.push(`- ${w}`);
    }
    return out.join('\n') + '\n';
}
