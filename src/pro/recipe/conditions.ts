/**
 * Conditions as people build them (`docs/plans/pro-rules-assertions-plan.md`, R3): a test on the page (its visible
 * text, its HTML source, its URL, its title, or elements matching a selector) with a count ("is found", "at least
 * 2"), and groups of them: all of these (AND), any of these (OR), none of these (NOR). Plain text is kept as an
 * escaped, case-blind regex, so a rule written as text reads back as text. Each condition reads as a sentence.
 */
import type { Condition, CountOp, RegexIn } from '../../shared/types/ways';

export type Leaf = Extract<Condition, { kind: 'css' | 'regex' }>;
export type GroupMode = 'all' | 'any' | 'none';

const META = /[.*+?^${}()|[\]\\]/g;
export const escapeRegex = (s: string) => s.replace(META, '\\$&');

/** The text a pattern stands for when it is only escaped text, else null (a real regex). */
export function literalOf(pattern: string): string | null {
    const text = pattern.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
    return escapeRegex(text) === pattern ? text : null;
}

/** What a leaf tests, as the editor offers it. */
export type Target = RegexIn | 'css';
export const TARGETS: { value: Target; label: string }[] = [
    { value: 'text', label: 'The visible text' },
    { value: 'css', label: 'Elements matching' },
    { value: 'url', label: 'The URL' },
    { value: 'title', label: 'The page title' },
    { value: 'html', label: 'The HTML source' },
];
export const targetOf = (c: Leaf): Target => c.kind === 'css' ? 'css' : c.in ?? 'html';

/** A count as the editor offers it. `found` and `absent` need no number. */
export type CountChoice = 'found' | 'absent' | 'atLeast' | 'atMost' | 'exactly' | 'moreThan' | 'fewerThan' | 'not';
export const COUNTS: { value: CountChoice; label: string; number: boolean }[] = [
    { value: 'found', label: 'is found', number: false },
    { value: 'absent', label: 'is not found', number: false },
    { value: 'atLeast', label: 'at least', number: true },
    { value: 'atMost', label: 'at most', number: true },
    { value: 'exactly', label: 'exactly', number: true },
    { value: 'moreThan', label: 'more than', number: true },
    { value: 'fewerThan', label: 'fewer than', number: true },
    { value: 'not', label: 'not exactly', number: true },
];
const CHOICE_OP: Record<Exclude<CountChoice, 'found' | 'absent'>, CountOp> = { atLeast: 'gte', atMost: 'lte', exactly: 'eq', moreThan: 'gt', fewerThan: 'lt', not: 'ne' };

export function countOf(c: Leaf): { choice: CountChoice; n: number } {
    if ((c.op === 'gt' && c.value === 0) || (c.op === 'gte' && c.value === 1)) return { choice: 'found', n: 0 };
    if ((c.op === 'eq' || c.op === 'lte') && c.value === 0) return { choice: 'absent', n: 0 };
    if (c.op === 'lt' && c.value === 1) return { choice: 'absent', n: 0 };
    const choice = (Object.keys(CHOICE_OP) as (keyof typeof CHOICE_OP)[]).find(k => CHOICE_OP[k] === c.op) ?? 'atLeast';
    return { choice, n: c.value };
}

export function withCount(c: Leaf, choice: CountChoice, n: number): Leaf {
    if (choice === 'found') return { ...c, op: 'gt', value: 0 };
    if (choice === 'absent') return { ...c, op: 'eq', value: 0 };
    return { ...c, op: CHOICE_OP[choice], value: Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)) };
}

/** A new leaf: the visible text has something. */
export const newLeaf = (): Leaf => ({ kind: 'regex', in: 'text', pattern: '', flags: 'i', op: 'gt', value: 0 });

/** A leaf moved to another target, keeping its count and what it looks for where that still makes sense. */
export function withTarget(c: Leaf, target: Target): Leaf {
    const count = { op: c.op, value: c.value };
    if (target === 'css') return { kind: 'css', selector: c.kind === 'css' ? c.selector : '', ...count };
    const pattern = c.kind === 'regex' ? c.pattern : '';
    return { kind: 'regex', in: target, pattern, flags: c.kind === 'regex' ? c.flags ?? 'i' : 'i', ...count };
}

/** A group as the editor shows it: its mode and its items. A lone leaf is a group of one, "all". */
export function groupOf(c: Condition): { mode: GroupMode; items: Condition[] } {
    if (c.kind === 'all' || c.kind === 'any') return { mode: c.kind, items: c.of };
    if (c.kind === 'not') return { mode: 'none', items: c.of.kind === 'any' ? c.of.of : [c.of] };
    return { mode: 'all', items: [c] };
}

/** The condition a group makes; a group of one "all" or "any" is that item. */
export function fromGroup(mode: GroupMode, items: Condition[]): Condition {
    if (mode === 'none') return { kind: 'not', of: items.length === 1 ? items[0] : { kind: 'any', of: items } };
    return items.length === 1 ? items[0] : { kind: mode, of: items };
}

const isGroup = (c: Condition) => c.kind === 'all' || c.kind === 'any' || c.kind === 'not';

/** The condition as a sentence: `the visible text has "Sold out"`, `none of: …`. */
export function describe(c: Condition): string {
    if (isGroup(c)) {
        const { mode, items } = groupOf(c);
        if (!items.length) return mode === 'all' ? 'always' : mode === 'any' ? 'never' : 'always';
        if (items.length === 1 && mode !== 'none') return describe(items[0]);
        const word = mode === 'all' ? 'all of' : mode === 'any' ? 'any of' : 'none of';
        return `${word}: ${items.map(x => isGroup(x) && groupOf(x).items.length > 1 ? `(${describe(x)})` : describe(x)).join('; ')}`;
    }
    const leaf = c as Leaf;
    const { choice, n } = countOf(leaf);
    const what = leaf.kind === 'css' ? `"${leaf.selector}"`
        : (() => { const text = literalOf(leaf.pattern); return text !== null ? `"${text}"` : `/${leaf.pattern}/`; })();
    const where = leaf.kind === 'css' ? 'elements matching' : { text: 'the visible text has', html: 'the HTML source has', url: 'the URL has', title: 'the title has' }[leaf.in ?? 'html'];
    if (choice === 'found') return leaf.kind === 'css' ? `${what} is on the page` : `${where} ${what}`;
    if (choice === 'absent') return leaf.kind === 'css' ? `${what} is not on the page` : `${where.replace(' has', ' does not have')} ${what}`;
    const label = COUNTS.find(x => x.value === choice)!.label;
    return leaf.kind === 'css' ? `${label} ${n} ${what}` : `${where} ${what} ${label} ${n} time${n === 1 ? '' : 's'}`;
}

/** Groups with nothing in them, which always (all, none) or never (any) hold: worth a warning, not a refusal. */
export function emptyGroups(c: Condition): ('always' | 'never')[] {
    if (c.kind === 'all' || c.kind === 'any') return c.of.length ? c.of.flatMap(emptyGroups) : [c.kind === 'all' ? 'always' : 'never'];
    if (c.kind === 'not') return c.of.kind === 'any' && !c.of.of.length ? ['always'] : emptyGroups(c.of);
    return [];
}

/**
 * Whether the condition can never hold, whatever the page: an empty "any" (how an import keeps a condition it could
 * not carry over), or an "all" with such a part. A NOT is taken as able to hold.
 */
export function neverHolds(c: Condition): boolean {
    if (c.kind === 'any') return c.of.every(neverHolds);
    if (c.kind === 'all') return c.of.some(neverHolds);
    return false;
}

/** What a condition lacks: text or a selector to look for, a regex that compiles, items in a group. */
export function conditionProblems(c: Condition, where: string): string[] {
    // An empty group is allowed: "never" is how an import keeps a condition it could not carry over (`emptyGroups`).
    if (c.kind === 'all' || c.kind === 'any') return c.of.flatMap(x => conditionProblems(x, where));
    if (c.kind === 'not') return conditionProblems(c.of, where);
    if (c.kind === 'css') return c.selector.trim() ? [] : [`${where}: a condition has no selector.`];
    if (c.kind !== 'regex') return [];
    if (!c.pattern) return [`${where}: a condition has nothing to look for.`];
    try { new RegExp(c.pattern, (c.flags ?? '').replace(/[gy]/g, '')); return []; } catch { return [`${where}: /${c.pattern}/ is not a valid regex.`]; }
}
