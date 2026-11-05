/**
 * A condition built from tests on the page and groups of them (`recipe/conditions.ts`): all of these (AND), any
 * of these (OR), none of these (NOR). Each test looks at the visible text, elements matching a selector, the URL,
 * the title or the HTML source, for plain text or a regex, with a count. The whole reads back as a sentence.
 * Used by page rules and by a way's "only when".
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, IconButton, Select, Text, TextField } from '../../sidepanel/ui';
import type { Condition } from '../../shared/types/ways';
import {
    conditionProblems, COUNTS, emptyGroups, countOf, describe, escapeRegex, fromGroup, groupOf, literalOf, newLeaf, TARGETS, targetOf,
    withCount, withTarget, type GroupMode, type Leaf, type Target,
} from '../recipe/conditions';

const MODES: { value: GroupMode; label: string }[] = [
    { value: 'all', label: 'All of these hold' },
    { value: 'any', label: 'Any of these holds' },
    { value: 'none', label: 'None of these holds' },
];

const isLeaf = (c: Condition): c is Leaf => c.kind === 'css' || c.kind === 'regex';

function LeafEditor({ leaf, onChange, onRemove, n }: { leaf: Leaf; onChange: (c: Leaf) => void; onRemove: () => void; n: string }) {
    const [regex, setRegex] = useState(leaf.kind === 'regex' && !!leaf.pattern && literalOf(leaf.pattern) === null);
    const target = targetOf(leaf);
    const count = countOf(leaf);
    const needsNumber = COUNTS.find(x => x.value === count.choice)!.number;
    const shown = leaf.kind === 'css' ? leaf.selector : regex ? leaf.pattern : literalOf(leaf.pattern) ?? leaf.pattern;
    const setWhat = (v: string) => onChange(leaf.kind === 'css' ? { ...leaf, selector: v }
        : regex ? { ...leaf, pattern: v } : { ...leaf, pattern: escapeRegex(v), flags: 'i' });
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line px-2.5 py-2" data-testid="pro-condition">
            <div className="flex items-end gap-1.5">
                <Select<Target> size="sm" className="flex-1" aria-label={`Condition ${n} looks at`} value={target} options={TARGETS}
                    onChange={t => onChange(withTarget(leaf, t))} />
                <IconButton size="sm" label={`Remove condition ${n}`} onClick={onRemove}><Trash2 /></IconButton>
            </div>
            <TextField size="sm" aria-label={`Condition ${n} looks for`} value={shown}
                placeholder={target === 'css' ? '#captcha, .out-of-stock' : regex ? 'Sold\\s+out' : target === 'url' ? '/search' : 'Page not found'}
                onChange={e => setWhat(e.target.value)} />
            <div className="flex flex-wrap items-center gap-1.5">
                <Select size="sm" aria-label={`Condition ${n} count`} value={count.choice} options={COUNTS.map(c => ({ value: c.value, label: c.label }))}
                    onChange={choice => onChange(withCount(leaf, choice, count.n || 1))} />
                {needsNumber && <TextField size="sm" type="number" className="w-20" aria-label={`Condition ${n} number`} value={String(count.n)}
                    onChange={e => onChange(withCount(leaf, count.choice, Number(e.target.value)))} />}
                {leaf.kind === 'regex' && <Checkbox label="Regex" checked={regex}
                    onChange={on => {
                        setRegex(on);
                        if (!on) onChange({ ...leaf, pattern: escapeRegex(literalOf(leaf.pattern) ?? leaf.pattern), flags: 'i' });
                    }} />}
            </div>
            {leaf.kind === 'regex' && leaf.in === 'html' && (
                <Text size="caption" tone="faint">The source counts scripts and attributes too; the visible text is what a visitor reads.</Text>
            )}
        </div>
    );
}

function GroupEditor({ value, onChange, onRemove, depth, path }: { value: Condition; onChange: (c: Condition) => void; onRemove?: () => void; depth: number; path: string }) {
    const { mode, items } = groupOf(value);
    const set = (m: GroupMode, list: Condition[]) => onChange(fromGroup(m, list));
    const replace = (i: number, c: Condition) => set(mode, items.map((x, j) => j === i ? c : x));
    const remove = (i: number) => set(mode, items.filter((_, j) => j !== i));
    return (
        <div className={depth ? 'flex flex-col gap-1.5 rounded-xl bg-ink/4 p-2' : 'flex flex-col gap-1.5'} data-testid="pro-condition-group">
            <div className="flex items-end gap-1.5">
                <Select<GroupMode> size="sm" className="flex-1" aria-label={depth ? `Group ${path} holds when` : 'Holds when'} value={mode} options={MODES}
                    onChange={m => set(m, items)} />
                {onRemove && <IconButton size="sm" label={`Remove group ${path}`} onClick={onRemove}><Trash2 /></IconButton>}
            </div>
            {items.map((c, i) => {
                const n = path ? `${path}.${i + 1}` : String(i + 1);
                return isLeaf(c)
                    ? <LeafEditor key={i} n={n} leaf={c} onChange={next => replace(i, next)} onRemove={() => remove(i)} />
                    : <GroupEditor key={i} path={n} depth={depth + 1} value={c} onChange={next => replace(i, next)} onRemove={() => remove(i)} />;
            })}
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => set(mode, [...items, newLeaf()])}>
                    {depth ? `Condition in group ${path}` : 'Condition'}
                </Button>
                {depth === 0 && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => set(mode, [...items, { kind: 'any', of: [newLeaf(), newLeaf()] }])}>Group</Button>}
            </div>
        </div>
    );
}

/** `where`: how problems name this condition ("Rule 404"). */
export function ConditionEditor({ value, onChange, where }: { value: Condition; onChange: (c: Condition) => void; where: string }) {
    const problems = conditionProblems(value, where);
    const empty = emptyGroups(value);
    return (
        <div className="flex flex-col gap-2" data-testid="pro-condition-editor">
            <Text size="caption" tone="muted" data-testid="pro-condition-sentence">Holds when {describe(value)}.</Text>
            <GroupEditor value={value} onChange={onChange} depth={0} path="" />
            {problems.map(p => <Text key={p} size="caption" tone="warning">{p}</Text>)}
            {empty.length > 0 && <Text size="caption" tone="warning" data-testid="pro-condition-empty">
                An empty group {empty.includes('never') ? 'never holds' : 'always holds'}: add a condition to it, or remove it.
            </Text>}
        </div>
    );
}
