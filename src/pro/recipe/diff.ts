/**
 * What changed between two versions (`docs/design/LLD.md` §5), as plain lines a person reads: fields
 * added, removed, renamed or changed (type, ways in order, cleanup), clicks, lists, pagination, settings
 * and pages, and whether the output consumers see changed.
 */
import { canonicalString } from './canonical';
import type { Click, Field, ListRecipeSpec, PageRecipeSpec, PageSource, SessionSetup, Version, Way, ValueCheck } from './types';
import type { PageRule } from '../../shared/types/ways';
import { describe } from './conditions';
import { describeCheck } from './valueChecks';
import { describeAction } from './actions';
import type { Column, ListTarget } from '../../shared/types/database';
import type { Condition } from '../../shared/types/ways';

export type ChangeKind = 'added' | 'removed' | 'renamed' | 'changed' | 'moved';

export interface Change {
    kind: ChangeKind;
    /** What the change is about: "field price", "click 2", "pagination". */
    subject: string;
    /** One line per part that changed ("type text → money"). Empty for added and removed. */
    details: string[];
}

export interface VersionDiff {
    from: number;
    to: number;
    changes: Change[];
    /** The names, types or required flags consumers see are different. */
    outputChanged: boolean;
}

const json = (v: unknown) => JSON.stringify(v ?? null);
/** Ways compared by what they read: a way's id and `addedIn` are identity, not a change. */
const waysJson = (v: unknown) => canonicalString(v ?? null);
/** A click or action step by what it does and to what, not by its id or name. */
const clickJson = ({ id: _id, name: _name, ...rest }: Click) => canonicalString(rest);

/** Page rules, by name: added, removed, their status or condition changed, and their order. */
function rulesChanges(a: PageRule[] = [], b: PageRule[] = [], prefix = ''): Change[] {
    const out: Change[] = [];
    const before = new Map(a.map(r => [r.name, r]));
    const after = new Map(b.map(r => [r.name, r]));
    for (const r of b) {
        const was = before.get(r.name);
        if (!was) { out.push({ kind: 'added', subject: `${prefix}page rule ${r.name}`, details: [`${r.status}: when ${describe(r.when)}`] }); continue; }
        const details = [
            ...(was.status !== r.status ? [`status ${was.status} → ${r.status}`] : []),
            ...(json(was.when) !== json(r.when) ? [`when ${describe(r.when)}`] : []),
        ];
        if (details.length) out.push({ kind: 'changed', subject: `${prefix}page rule ${r.name}`, details });
    }
    for (const r of a) if (!after.has(r.name)) out.push({ kind: 'removed', subject: `${prefix}page rule ${r.name}`, details: [] });
    const kept = a.map(r => r.name).filter(n => after.has(n));
    const order = b.map(r => r.name).filter(n => before.has(n));
    if (json(kept) !== json(order)) out.push({ kind: 'moved', subject: `${prefix}page rules`, details: [`order: ${order.join(', ')}`] });
    return out;
}

/** The session setup: its steps in order, by what they do, and its check. */
function setupChanges(a: SessionSetup | undefined, b: SessionSetup | undefined): Change[] {
    if (!a && !b) return [];
    if (!a) return [{ kind: 'added', subject: 'session setup', details: b!.steps.map(c => `${c.name}: ${describeAction(c)}`) }];
    if (!b) return [{ kind: 'removed', subject: 'session setup', details: [] }];
    const details = [
        ...(json(a.steps.map(clickJson)) !== json(b.steps.map(clickJson)) ? [`steps: ${b.steps.map(c => `${c.name} (${describeAction(c)})`).join(', ') || 'none'}`] : []),
        ...(json((a.dismiss ?? []).map(clickJson)) !== json((b.dismiss ?? []).map(clickJson)) ? [`dismiss: ${(b.dismiss ?? []).map(c => c.name).join(', ') || 'none'}`] : []),
        ...(a.check?.contains !== b.check?.contains ? [`check: contains ${a.check?.contains ?? '–'} → ${b.check?.contains ?? '–'}`] : []),
        ...(waysJson(a.check?.ways) !== waysJson(b.check?.ways) ? ['check: its element changed'] : []),
    ];
    return details.length ? [{ kind: 'changed', subject: 'session setup', details }] : [];
}

export function wayLabel(w: Way): string {
    if (w.kind === 'selector') return w.selector;
    if (w.kind === 'markup') return w.source === 'meta' ? `meta ${w.key}` : `microdata${w.type ? ` ${w.type}` : ''} · ${w.key}`;
    const b = w.binding;
    const path = [...b.path.map(p => typeof p === 'object' ? `[${p.where}=${p.is}]` : String(p)), b.key].filter(Boolean).join('.');
    return `${b.kind === 'ld' ? `JSON-LD${b.type ? ` ${b.type}` : ''}` : b.label}${path ? ` · ${path}` : ''}`;
}

const OP_SIGN = { eq: '=', gt: '>', lt: '<', gte: '≥', lte: '≤', ne: '≠' } as const;
const IN_LABEL = { html: '', text: 'text ', url: 'url ', title: 'title ' } as const;

/** A condition in one line: `#captcha > 0`, `text /Sold out/i = 0`, joined with AND / OR; NOR as `NOT (… OR …)`. */
export function conditionLabel(c: Condition): string {
    switch (c.kind) {
        case 'css': return `${c.selector} ${OP_SIGN[c.op]} ${c.value}`;
        case 'regex': return `${IN_LABEL[c.in ?? 'html']}/${c.pattern}/${c.flags ?? ''} ${OP_SIGN[c.op]} ${c.value}`;
        case 'not': return `NOT (${conditionLabel(c.of)})`;
        default: {
            if (!c.of.length) return c.kind === 'all' ? 'always' : 'never';
            const parts = c.of.map(x => x.kind === 'all' || x.kind === 'any' ? `(${conditionLabel(x)})` : conditionLabel(x));
            return parts.join(c.kind === 'all' ? ' AND ' : ' OR ');
        }
    }
}

/** The ways that differ: added and removed, then "order" when the same ways moved. */
function waysDetails(a: Way[], b: Way[]): string[] {
    const as = a.map(wayLabel), bs = b.map(wayLabel);
    const out = [
        ...bs.filter(w => !as.includes(w)).map(w => `way added: ${w}`),
        ...as.filter(w => !bs.includes(w)).map(w => `way removed: ${w}`),
    ];
    const kept = as.filter(w => bs.includes(w));
    if (out.length === 0 && json(kept) !== json(bs.filter(w => as.includes(w)))) out.push('ways reordered');
    // Page data cleanup or shape lives inside the binding: same label, different binding. Ways with the same label
    // (one selector, two cleanups) pair up in order: the second with the second.
    const nth = (labels: string[], i: number) => labels.slice(0, i).filter(l => l === labels[i]).length;
    a.forEach((w, i) => {
        const k = nth(as, i);
        const j = bs.findIndex((l, jj) => l === as[i] && nth(bs, jj) === k);
        if (j >= 0 && waysJson(b[j]) !== waysJson(w)) out.push(`way changed: ${as[i]}`);
    });
    return out;
}

type Named = { name: string };

/**
 * Matches two lists of named things by name. A removed and an added one that share an identity are a
 * rename; identities are tried in order (an id first, then what it reads).
 */
function matchByName<T extends Named>(a: T[], b: T[], ...identities: ((t: T) => string | undefined)[]) {
    const removed = a.filter(x => !b.some(y => y.name === x.name));
    const added = b.filter(y => !a.some(x => x.name === y.name));
    const renamed: [T, T][] = [];
    for (const identity of identities) {
        for (const r of [...removed]) {
            const key = identity(r);
            const twin = key === undefined ? undefined : added.find(x => identity(x) === key);
            if (twin) { renamed.push([r, twin]); removed.splice(removed.indexOf(r), 1); added.splice(added.indexOf(twin), 1); }
        }
    }
    const both = a.flatMap(x => { const y = b.find(z => z.name === x.name); return y ? [[x, y] as [T, T]] : []; });
    return { removed, added, renamed, both };
}

function fieldDetails(x: Field, y: Field): string[] {
    return [
        ...(x.type !== y.type ? [`type ${x.type} → ${y.type}`] : []),
        ...(!!x.required !== !!y.required ? [y.required ? 'now required' : 'no longer required'] : []),
        ...(x.read !== y.read ? [`reads ${x.read} → ${y.read}`] : []),
        ...waysDetails(x.ways, y.ways),
        ...(json(x.ops) !== json(y.ops) ? [`cleanup ${x.ops.map(o => o.op).join(', ') || 'none'} → ${y.ops.map(o => o.op).join(', ') || 'none'}`] : []),
        ...(json(x.columns) !== json(y.columns) ? ['its columns changed'] : []),
        ...checksDetails(x.checks ?? [], y.checks ?? []),
    ];
}

/** Value checks added and removed, by what they say. */
function checksDetails(a: ValueCheck[], b: ValueCheck[]): string[] {
    const as = a.map(describeCheck), bs = b.map(describeCheck);
    return [...bs.filter(c => !as.includes(c)).map(c => `check added: ${c}`), ...as.filter(c => !bs.includes(c)).map(c => `check removed: ${c}`)];
}

function pageChanges(a: PageRecipeSpec, b: PageRecipeSpec, prefix = ''): Change[] {
    const fieldsA = a.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
    const fieldsB = b.steps.flatMap(s => s.kind === 'field' ? [s.field] : []);
    // A field keeps its id across versions; one picked again keeps its ways.
    const m = matchByName(fieldsA, fieldsB, f => f.id, f => waysJson(f.ways));
    const changes: Change[] = [
        ...m.added.map(f => ({ kind: 'added' as const, subject: `${prefix}field ${f.name}`, details: [] })),
        ...m.removed.map(f => ({ kind: 'removed' as const, subject: `${prefix}field ${f.name}`, details: [] })),
        ...m.renamed.map(([x, y]) => ({ kind: 'renamed' as const, subject: `${prefix}field ${x.name} → ${y.name}`, details: fieldDetails(x, y) })),
    ];
    for (const [x, y] of m.both) {
        const details = fieldDetails(x, y);
        if (details.length) changes.push({ kind: 'changed', subject: `${prefix}field ${y.name}`, details });
    }
    const clicksA = a.steps.flatMap(s => s.kind === 'click' ? [clickJson(s.click)] : []);
    const clicksB = b.steps.flatMap(s => s.kind === 'click' ? [clickJson(s.click)] : []);
    clicksB.forEach((c, i) => { if (!clicksA.includes(c)) changes.push({ kind: 'added', subject: `${prefix}click ${i + 1}`, details: [] }); });
    clicksA.forEach((c, i) => { if (!clicksB.includes(c)) changes.push({ kind: 'removed', subject: `${prefix}click ${i + 1}`, details: [] }); });

    // The run order: the same steps (by name, clicks by ways) in another order.
    const order = (s: PageRecipeSpec) => s.steps.map(st => st.kind === 'field' ? `f:${st.field.name}` : `c:${clickJson(st.click)}`);
    const oa = order(a), ob = order(b);
    const common = (x: string[], y: string[]) => x.filter(k => y.includes(k));
    if (json(common(oa, ob)) !== json(common(ob, oa))) changes.push({ kind: 'moved', subject: `${prefix}steps`, details: ['the run order changed'] });

    changes.push(...rulesChanges(a.rules, b.rules, prefix));
    if (json(a.identity) !== json(b.identity)) {
        const say = (s: PageRecipeSpec) => s.identity ? `${s.identity.field} (${s.identity.url.length} URL pattern${s.identity.url.length === 1 ? '' : 's'})` : 'none';
        const from = say(a), to = say(b);
        changes.push({ kind: 'changed', subject: `${prefix}identity check`, details: [from === to ? 'its URL patterns changed' : `${from} → ${to}`] });
    }
    return changes;
}

function listChanges(a: ListRecipeSpec, b: ListRecipeSpec): Change[] {
    const changes: Change[] = [];
    const n = Math.max(a.lists.length, b.lists.length);
    for (let i = 0; i < n; i++) {
        const x: ListTarget | undefined = a.lists[i], y: ListTarget | undefined = b.lists[i];
        const subject = `list ${i + 1}`;
        if (!x) { changes.push({ kind: 'added', subject, details: [] }); continue; }
        if (!y) { changes.push({ kind: 'removed', subject, details: [] }); continue; }
        const details = [
            ...(json(x.container) !== json(y.container) ? [`section ${x.container[0] ?? '–'} → ${y.container[0] ?? '–'}`] : []),
            ...(json(x.items) !== json(y.items) ? [`items ${x.items[0] ?? '–'} → ${y.items[0] ?? '–'}`] : []),
            ...(x.mode !== y.mode ? [`read as ${x.mode} → ${y.mode}`] : []),
        ];
        if (details.length) changes.push({ kind: 'changed', subject, details });
        const m = matchByName<Column>(x.fields, y.fields, c => c.id, c => c.selector);
        changes.push(
            ...m.added.map(c => ({ kind: 'added' as const, subject: `${subject} field ${c.name}`, details: [] })),
            ...m.removed.map(c => ({ kind: 'removed' as const, subject: `${subject} field ${c.name}`, details: [] })),
            ...m.renamed.map(([p, q]) => ({ kind: 'renamed' as const, subject: `${subject} field ${p.name} → ${q.name}`, details: [] })),
        );
        for (const [p, q] of m.both) {
            const d = [...(p.type !== q.type ? [`type ${p.type} → ${q.type}`] : []), ...(json(p) !== json(q) && p.type === q.type ? ['how it is read changed'] : [])];
            if (d.length) changes.push({ kind: 'changed', subject: `${subject} field ${q.name}`, details: d });
        }
    }
    const pd = [
        ...(a.pagination.mode !== b.pagination.mode ? [`mode ${a.pagination.mode} → ${b.pagination.mode}`] : []),
        ...(json(a.pagination.next) !== json(b.pagination.next) ? [`next ${a.pagination.next?.[0] ?? 'none'} → ${b.pagination.next?.[0] ?? 'none'}`] : []),
    ];
    if (pd.length) changes.push({ kind: 'changed', subject: 'pagination', details: pd });
    if (json(a.details) !== json(b.details)) {
        if (!a.details || !b.details) changes.push({ kind: b.details ? 'added' : 'removed', subject: 'item details', details: [] });
        else changes.push(...pageChanges(a.details.spec, b.details.spec, 'details '));
    }
    return changes;
}

function settingsChanges(a: Record<string, unknown>, b: Record<string, unknown>): Change[] {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const details = keys.filter(k => json(a[k]) !== json(b[k])).map(k => `${k} ${a[k] === undefined ? '–' : json(a[k])} → ${b[k] === undefined ? '–' : json(b[k])}`);
    return details.length ? [{ kind: 'changed', subject: 'settings', details }] : [];
}

function pagesChanges(a: PageSource, b: PageSource): Change[] {
    if (json(a) === json(b)) return [];
    if (a.kind === 'urls' && b.kind === 'urls') {
        const added = b.urls.filter(u => !a.urls.includes(u)).length, removed = a.urls.filter(u => !b.urls.includes(u)).length;
        return [{ kind: 'changed', subject: 'pages', details: [`${added} added, ${removed} removed (${b.urls.length} now)`] }];
    }
    const say = (p: PageSource) => p.kind === 'urls' ? `${p.urls.length} pages` : p.kind === 'start' ? p.url : `sitemap ${p.sitemap}`;
    return [{ kind: 'changed', subject: 'pages', details: [`${say(a)} → ${say(b)}`] }];
}

function outputChanges(a: Version['output'], b: Version['output']): Change[] {
    const details = [
        ...(json(a.contract) !== json(b.contract) ? [`contract ${a.contract?.label ?? 'none'} → ${b.contract?.label ?? 'none'}`] : []),
        ...(json(a.mapping) !== json(b.mapping) ? ['contract mapping changed'] : []),
    ];
    return details.length ? [{ kind: 'changed', subject: 'output', details }] : [];
}

export function diffVersions(a: Version, b: Version): VersionDiff {
    const spec: Change[] = a.spec.kind !== b.spec.kind ? [{ kind: 'changed', subject: 'kind', details: [`${a.spec.kind} → ${b.spec.kind}`] }]
        : a.spec.kind === 'page' ? pageChanges(a.spec, b.spec as PageRecipeSpec)
        : listChanges(a.spec, b.spec as ListRecipeSpec);
    spec.unshift(...setupChanges(a.spec.setup, b.spec.setup), ...(a.spec.kind === 'list' && b.spec.kind === 'list' ? rulesChanges(a.spec.rules, b.spec.rules) : []));
    return {
        from: a.version,
        to: b.version,
        changes: [...spec, ...settingsChanges(a.settings, b.settings), ...pagesChanges(a.pages, b.pages),
            ...outputChanges(a.output, b.output)],
        outputChanged: a.outputDigest !== b.outputDigest,
    };
}
