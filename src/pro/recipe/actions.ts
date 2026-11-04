/**
 * Action steps and session setup (`docs/plans/pro-data-collection-plan.md`, C1): which steps Pro's step
 * runner runs, the variables a recipe needs, and a page recipe cut into what is read and what is done.
 * - A plain click (no `do`, not optional) is the public extractor's, as before; every other action is Pro's.
 * - Variables are written `{name}` in a step's value or the setup check, and filled from a job's context.
 */
import type { Click, PageRecipeSpec, ProSpec, SessionSetup, Step } from './types';

/** True when Pro's step runner runs it; false for a plain click the extractor runs. */
export function isProAction(c: Click): boolean {
    return (c.do !== undefined && c.do !== 'click') || !!c.optional;
}

const VAR = /\{([a-zA-Z_][\w-]*)\}/g;

/** The variables in a text, in order, once each. */
export function variablesIn(text: string | undefined): string[] {
    return text ? [...new Set([...text.matchAll(VAR)].map(m => m[1]))] : [];
}

function clicksOf(spec: ProSpec): Click[] {
    const steps = (s: Step[]) => s.flatMap(st => st.kind === 'click' ? [st.click] : []);
    const page = spec.kind === 'page' ? steps(spec.steps) : spec.details ? steps(spec.details.spec.steps) : [];
    return [...(spec.setup?.steps ?? []), ...(spec.setup?.dismiss ?? []), ...page];
}

/** Every variable the recipe needs a value for. */
export function variablesOf(spec: ProSpec): string[] {
    return [...new Set([...clicksOf(spec).flatMap(c => variablesIn(c.value)), ...variablesIn(spec.setup?.check?.contains)])];
}

export class MissingVariable extends Error {
    constructor(readonly name: string) {
        super(`No value for {${name}}: the job's context must set "${name}".`);
    }
}

/** The text with its variables filled; a variable without a value throws `MissingVariable`. */
export function fillVariables(text: string, context: Record<string, string> = {}): string {
    return text.replace(VAR, (_, name: string) => {
        const v = context[name];
        if (v === undefined || v === '') throw new MissingVariable(name);
        return v;
    });
}

/** The variables the recipe needs and the context doesn't give. */
export function missingVariables(spec: ProSpec, context: Record<string, string> = {}): string[] {
    return variablesOf(spec).filter(v => context[v] === undefined || context[v] === '');
}

/** A page recipe as runs of steps the extractor reads, and Pro's actions between them. */
export type Segment = { kind: 'read'; spec: PageRecipeSpec } | { kind: 'act'; click: Click };

export function segments(spec: PageRecipeSpec): Segment[] {
    const out: Segment[] = [];
    let run: Step[] = [];
    const flush = () => { if (run.length) out.push({ kind: 'read', spec: { kind: 'page', steps: run } }); run = []; };
    for (const step of spec.steps) {
        if (step.kind === 'click' && isProAction(step.click)) { flush(); out.push({ kind: 'act', click: step.click }); }
        else run.push(step);
    }
    flush();
    return out;
}

/** True when the page recipe has steps only Pro's runner can run. */
export function hasProActions(spec: PageRecipeSpec): boolean {
    return spec.steps.some(s => s.kind === 'click' && isProAction(s.click));
}

/** A step in a few words: "type {zip}", "choose Delivery", "click (optional)". */
export function describeAction(c: Click): string {
    const what = c.do ?? 'click';
    const value = c.value !== undefined ? ` ${c.value}` : c.index !== undefined ? ` #${c.index + 1}` : '';
    const extra = [c.enter ? 'then Enter' : '', c.gone ? 'to go away' : '', c.optional ? '(optional)' : ''].filter(Boolean).join(' ');
    return `${what}${value}${extra ? ` ${extra}` : ''}`;
}

/** The setup's steps and check, as owners of ways (for way ids, usage and clean-up). */
export function setupOwners(setup: SessionSetup | undefined): { key: string; name: string; ways: Click['ways'] }[] {
    if (!setup) return [];
    return [
        ...setup.steps.map(c => ({ key: `setup:${c.id}`, name: `setup: ${c.name}`, ways: c.ways })),
        ...(setup.dismiss ?? []).map(c => ({ key: `dismiss:${c.id}`, name: `dismiss: ${c.name}`, ways: c.ways })),
        ...(setup.check ? [{ key: 'setup:check', name: 'setup: check', ways: setup.check.ways }] : []),
    ];
}
