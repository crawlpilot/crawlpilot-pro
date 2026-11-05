/**
 * A field's value checks (`recipe/valueChecks.ts`): what a found value must be beyond its type. Each check is a
 * row with its own settings and a sentence; "Add a check" offers a pattern, a range, a list of allowed values, a
 * length, or a comparison with another field on the page.
 */
import { Trash2 } from 'lucide-react';
import { IconButton, Select, Text, TextArea, TextField } from '../../sidepanel/ui';
import type { CompareOp, ValueCheck } from '../recipe/types';
import { COMPARE_OPS, describeCheck } from '../recipe/valueChecks';

type Kind = ValueCheck['kind'];
const ADD: { value: Kind | ''; label: string }[] = [
    { value: '', label: '+ Add a check' },
    { value: 'pattern', label: 'Matches a pattern' },
    { value: 'range', label: 'A number in a range' },
    { value: 'oneOf', label: 'One of a list' },
    { value: 'length', label: 'A length' },
    { value: 'compare', label: 'Compared with another field' },
];

const fresh = (kind: Kind, others: string[]): ValueCheck => {
    switch (kind) {
        case 'pattern': return { kind, pattern: '' };
        case 'range': return { kind, min: 0 };
        case 'oneOf': return { kind, values: [] };
        case 'length': return { kind, min: 1 };
        case 'compare': return { kind, op: 'lte', field: others[0] ?? '' };
    }
};

/** A number field where empty means "no bound". */
function Bound({ label, name, value, onChange }: { label: string; name: string; value?: number; onChange: (v: number | undefined) => void }) {
    return <TextField size="sm" type="number" className="w-24" label={label} aria-label={name} value={value === undefined ? '' : String(value)}
        onChange={e => onChange(e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))} />;
}

/** Sets a bound, dropping the key when empty so the digest stays as it was. */
const bound = <C extends { min?: number; max?: number }>(c: C, key: 'min' | 'max', v: number | undefined): C => {
    const next = { ...c };
    if (v === undefined) delete next[key]; else next[key] = v;
    return next;
};

function CheckRow({ check, n, others, onChange, onRemove }: { check: ValueCheck; n: number; others: string[]; onChange: (c: ValueCheck) => void; onRemove: () => void }) {
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line px-2.5 py-2" data-testid="pro-value-check">
            <div className="flex items-center gap-1.5">
                <Text size="caption" weight="semibold" className="min-w-0 flex-1" data-testid="pro-value-check-sentence">Must be {describeCheck(check)}</Text>
                <IconButton size="sm" label={`Remove check ${n}`} onClick={onRemove}><Trash2 /></IconButton>
            </div>
            {check.kind === 'pattern' && (
                <div className="flex items-end gap-1.5">
                    <Select size="sm" aria-label={`Check ${n} matches`} value={check.not ? 'not' : 'is'}
                        options={[{ value: 'is', label: 'Matches' }, { value: 'not', label: 'Does not match' }]}
                        onChange={v => { const { not: _, ...rest } = check; onChange(v === 'not' ? { ...rest, not: true } : rest); }} />
                    <TextField size="sm" className="flex-1" aria-label={`Check ${n} pattern`} placeholder="^LX-\d+$" value={check.pattern}
                        onChange={e => onChange({ ...check, pattern: e.target.value })} />
                </div>
            )}
            {(check.kind === 'range' || check.kind === 'length') && (
                <div className="flex items-end gap-1.5">
                    <Bound label="At least" name={`Check ${n} at least`} value={check.min} onChange={v => onChange(bound(check, 'min', v))} />
                    <Bound label="At most" name={`Check ${n} at most`} value={check.max} onChange={v => onChange(bound(check, 'max', v))} />
                    <Text size="caption" tone="faint" className="pb-2">{check.kind === 'length' ? 'characters, or items of a list' : 'the typed number'}</Text>
                </div>
            )}
            {check.kind === 'oneOf' && (
                <TextArea rows={2} label="Allowed values, one per line" aria-label={`Check ${n} allowed values`} value={check.values.join('\n')}
                    onChange={e => onChange({ ...check, values: e.target.value.split('\n') })} />
            )}
            {check.kind === 'compare' && (
                <div className="flex items-end gap-1.5">
                    <Select<CompareOp> size="sm" aria-label={`Check ${n} comparison`} value={check.op} options={COMPARE_OPS} onChange={op => onChange({ ...check, op })} />
                    <Select size="sm" className="flex-1" aria-label={`Check ${n} other field`} value={check.field}
                        options={[...(others.includes(check.field) ? [] : [{ value: check.field, label: check.field || '(choose a field)' }]), ...others.map(f => ({ value: f, label: f }))]}
                        onChange={field => onChange({ ...check, field })} />
                </div>
            )}
        </div>
    );
}

/** `others`: the recipe's other fields, by name, for comparisons. */
export function ValueChecks({ checks, others, onChange }: { checks: ValueCheck[]; others: string[]; onChange: (c: ValueCheck[]) => void }) {
    return (
        <div className="flex flex-col gap-2" data-testid="pro-value-checks">
            {checks.length === 0 && <Text size="caption" tone="faint">None: any value of the field's type is fine.</Text>}
            {checks.map((c, i) => (
                <CheckRow key={i} n={i + 1} check={c} others={others}
                    onChange={next => onChange(checks.map((x, j) => j === i ? next : x))} onRemove={() => onChange(checks.filter((_, j) => j !== i))} />
            ))}
            <Select<Kind | ''> size="sm" aria-label="Add a check" value="" options={ADD.map(a => a.value === 'compare' && !others.length ? { ...a, disabled: true } : a)}
                onChange={k => { if (k) onChange([...checks, fresh(k, others)]); }} />
        </div>
    );
}
