/**
 * A field's (or a way's) cleanup steps, in order: the public text steps and Pro's own (`recipe/ops.ts`: text to list,
 * "Name: value" to object, list to text, a Lua script), each with its settings, tried on a typed value or, given
 * `value`, shown on the value the field read. Used by the field editor and by the save step after picking.
 */
import { useState } from 'react';
import { Chip, Select, Text, TextArea, TextField } from '../../sidepanel/ui';
import { applyProOps, NEW_OP, opSummary, PRO_OP_LABELS, type ProOp } from '../recipe/ops';

const show = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v);

/** The settings a step has, as small text boxes. */
function OpSettings({ op, onChange }: { op: ProOp; onChange: (op: ProOp) => void }) {
    const text = (label: string, value: string, set: (v: string) => ProOp) =>
        <TextField key={label} size="sm" className="flex-1" label={label} value={value} onChange={e => onChange(set(e.target.value))} />;
    switch (op.op) {
        case 'regex': return <div className="flex gap-2">{text('Pattern', op.pattern, pattern => ({ ...op, pattern }))}<TextField size="sm" className="w-16" label="Flags" value={op.flags ?? 'i'} onChange={e => onChange({ ...op, flags: e.target.value })} /></div>;
        case 'replace': return <div className="flex gap-2">{text('Find', op.find, find => ({ ...op, find }))}{text('With', op.with, w => ({ ...op, with: w }))}</div>;
        case 'split': return <div className="flex gap-2">{text('Separator', op.sep, sep => ({ ...op, sep }))}{text('Part #', String(op.index), i => ({ ...op, index: Number(i) || 0 }))}</div>;
        case 'prefix': case 'suffix': return <div className="flex gap-2">{text('Text', op.text, t => ({ ...op, text: t }))}</div>;
        case 'splitList': case 'toObject': return <div className="flex gap-2">{text(op.op === 'splitList' ? 'Split on' : 'Name and value split on', op.sep, sep => ({ ...op, sep }))}</div>;
        case 'join': return <div className="flex gap-2">{text('Joined with', op.sep, sep => ({ ...op, sep }))}</div>;
        case 'lua': return <TextArea label="Lua: the value is str, the first value returned is kept" rows={3} value={op.code} onChange={e => onChange({ ...op, code: e.target.value })} />;
        default: return null;
    }
}

/**
 * `value`: the value the field read (in the save step, what was just picked): shown cleaned as the steps change.
 */
export function Cleanup({ ops, onChange, value, title = 'Cleanup, in order', empty = 'None: the value is kept as found.' }: {
    ops: ProOp[]; onChange: (ops: ProOp[]) => void; value?: unknown; title?: string; empty?: string;
}) {
    const [sample, setSample] = useState('');
    const result = sample ? applyProOps(sample.replace(/\\n/g, '\n'), ops) : null;
    const read = value === undefined || value === null || value === '' ? undefined : applyProOps(value, ops);
    return (
        <div className="flex flex-col gap-2">
            <Text size="caption" weight="semibold" tone="muted">{title}</Text>
            {ops.length === 0 && <Text size="caption" tone="faint">{empty}</Text>}
            {ops.map((op, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <div><Chip tone="outline" onRemove={() => onChange(ops.filter((_, j) => j !== i))} removeLabel={`Remove ${PRO_OP_LABELS[op.op]}`}>{opSummary(op)}</Chip></div>
                    <OpSettings op={op} onChange={next => onChange(ops.map((o, j) => j === i ? next : o))} />
                </div>
            ))}
            <Select<ProOp['op'] | ''> size="sm" aria-label="Add a step" value=""
                options={[{ value: '', label: '+ Add a step' }, ...(Object.keys(NEW_OP) as ProOp['op'][]).map(k => ({ value: k, label: PRO_OP_LABELS[k] }))]}
                onChange={k => { if (k) onChange([...ops, NEW_OP[k]]); }} />
            {read !== undefined && ops.length > 0 && (
                <Text size="caption" mono className="break-all" data-testid="pro-cleaned-value">On the picked value → {show(read)}</Text>
            )}
            <TextField size="sm" label="Try on a value" hint="\n is a new line." value={sample} onChange={e => setSample(e.target.value)} placeholder="Fit: Relaxed\nLength: Regular" />
            {sample && <Text size="caption" mono className="break-all" data-testid="pro-try-result">→ {show(result)}</Text>}
        </div>
    );
}
